import { loadEnv } from '../src/lib/env.js';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { loadPosts, savePosts } from '../src/lib/performance/store.js';
import { CATEGORY_VALUES, TAG_DIMENSIONS, TAG_DIMENSION_NAMES, parsePostTags, tagValues } from '../src/lib/performance/tags.js';
import type { PostTags } from '../src/lib/performance/tags.js';
import type { PublishedPost } from '../src/types/performance.js';

loadEnv();

// --cli tags through the local claude cli (subscription, used for the one-off
// history pass). Without it the haiku api call runs, which is what ci uses.
const isCliMode = process.argv.includes('--cli');
const BATCH_SIZE = isCliMode ? 60 : 20;
const CLI_CONCURRENCY = 3;
const CLI_MODEL = 'haiku';
// --limit N tags only the first N untagged posts, for checking output by eye
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

type Classify = (system: string, user: string, schema: Record<string, unknown>) => Promise<string>;

function buildSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    id: { type: 'string' },
    category: { type: 'string', enum: Object.keys(CATEGORY_VALUES) },
  };
  for (const dimension of TAG_DIMENSION_NAMES) properties[dimension] = { type: 'string', enum: tagValues(dimension) };
  return {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
      },
    },
    required: ['posts'],
    additionalProperties: false,
  };
}

function buildSystemPrompt(): string {
  const describe = (values: Record<string, { description: string } | string>): string =>
    Object.entries(values)
      .map(([value, info]) => `  - ${value}: ${typeof info === 'string' ? info : info.description}`)
      .join('\n');
  const dimensions = TAG_DIMENSION_NAMES
    .map((dimension) => `${dimension}:\n${describe(TAG_DIMENSIONS[dimension])}`)
    .join('\n\n');

  return `you tag x posts written by ben winzer, who builds websites for businesses. for every post, pick exactly one value per field from the allowed lists. judge the post as a whole: the hook is how the first line or two open, the moment is the main material the post is built from, the landing is how it ends.

category:
${describe(CATEGORY_VALUES)}

${dimensions}

return one entry per post, using the post's id exactly as given.`;
}

function buildUserPrompt(batch: PublishedPost[]): string {
  return batch.map((p) => `=== id ${p.draftId} ===\n${p.text}`).join('\n\n');
}

async function classifyViaCli(system: string, user: string, schema: Record<string, unknown>): Promise<string> {
  // The cli has no structured outputs, so the schema goes in the prompt
  const jsonInstruction = `\n\nrespond with only a json object matching this schema, no prose and no code fence:\n${JSON.stringify(schema)}`;
  return await completeViaCli(system + jsonInstruction, user, CLI_MODEL);
}

async function classifyViaApi(system: string, user: string, schema: Record<string, unknown>): Promise<string> {
  // Imported lazily so --cli runs never need an ANTHROPIC_API_KEY
  const { completeJson } = await import('../src/lib/claude.js');
  return await completeJson(system, user, schema);
}

function parseBatch(raw: string, batch: PublishedPost[]): Map<number, PostTags> {
  const parsed = JSON.parse(raw) as { posts?: unknown[] };
  const byId = new Map<number, PostTags>();
  const batchIds = new Set(batch.map((p) => p.draftId));
  for (const entry of parsed.posts ?? []) {
    const id = Number((entry as { id?: unknown }).id);
    const tags = parsePostTags(entry);
    if (batchIds.has(id) && tags) byId.set(id, tags);
  }
  return byId;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) await worker(items[next++]);
  }));
}

const classify: Classify = isCliMode ? classifyViaCli : classifyViaApi;
const posts = loadPosts();
const untagged = [...posts.values()].filter((p) => !p.tags && !p.isMissingOnX && p.text.trim() !== '').slice(0, limit);
const batches = Array.from({ length: Math.ceil(untagged.length / BATCH_SIZE) }, (_, i) =>
  untagged.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
);
console.log(`${untagged.length} untagged posts in ${batches.length} batches (${isCliMode ? 'claude cli' : 'haiku api'})`);

const system = buildSystemPrompt();
const schema = buildSchema();
let tagged = 0;
let failedBatches = 0;
await runPool(batches, isCliMode ? CLI_CONCURRENCY : 1, async (batch) => {
  try {
    const result = parseBatch(await classify(system, buildUserPrompt(batch), schema), batch);
    for (const [id, tags] of result) {
      const post = posts.get(id);
      if (post) post.tags = tags;
    }
    tagged += result.size;
    // Posts the model skipped or mislabeled stay untagged and retry next run
    if (result.size < batch.length) console.warn(`batch: ${batch.length - result.size} posts came back invalid`);
  } catch (err) {
    failedBatches++;
    console.error(`batch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  savePosts(posts);
  console.log(`  ${tagged}/${untagged.length} tagged`);
});

console.log(`\ndone. ${tagged} tagged, ${failedBatches} batches failed (rerun to retry)`);
