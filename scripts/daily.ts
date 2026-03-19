import fs from 'node:fs';
import path from 'node:path';
import { readText, ensureDir } from '../src/lib/fs.js';
import { complete } from '../src/lib/claude.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

const JOURNAL_DIR = process.env.JOURNAL_DIR;
const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;
const POST_COUNT = parseInt(process.env.POST_COUNT ?? '5', 10);

if (!JOURNAL_DIR) {
  console.error('missing JOURNAL_DIR in .env');
  process.exit(1);
}
if (!TYPEFULLY_API_KEY) {
  console.error('missing TYPEFULLY_API_KEY in .env');
  process.exit(1);
}

// Find the newest file in the journal folder
const journalFiles = fs
  .readdirSync(JOURNAL_DIR)
  .filter((f) => !f.startsWith('.'))
  .map((f) => ({
    name: f,
    fullPath: path.join(JOURNAL_DIR, f),
    mtime: fs.statSync(path.join(JOURNAL_DIR, f)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (journalFiles.length === 0) {
  console.error(`no files found in ${JOURNAL_DIR}`);
  process.exit(1);
}

const journal = journalFiles[0];
console.log(`reading: ${journal.name}`);
const journalContent = readText(journal.fullPath);

// Load example posts if any
const exampleDir = 'data/examples';
const exampleFiles = fs.existsSync(exampleDir)
  ? fs
    .readdirSync(exampleDir)
    .filter((f) => f.endsWith('.md') && !f.includes('README'))
    .map((f) => readText(path.join(exampleDir, f)))
  : [];
const examples = exampleFiles.join('\n\n---\n\n');

// Build delimiter list dynamically based on POST_COUNT
const delimiterBlock = Array.from(
  { length: POST_COUNT },
  (_, i) => `===post-${i + 1}===\n{post}`
).join('\n');

const systemPrompt = `you are ghostwriting x posts for ben winzer.

ben is 20 something. builds websites for coaches and online business owners. but most of his posts are not about websites. they are personal observations from his day that turn into a point about life, mindset, work, or business. the website stuff shows up when it fits naturally. not every post needs to be about work.

voice:
- all lowercase, always
- zero punctuation - no periods, no commas, no question marks, no colons, nothing at all
- every sentence or short thought gets its own line with a blank line between
- personal and direct - writes like he is talking to one person
- stream of consciousness that leads somewhere
- profanity is fine when it sounds natural
- never corporate, never polished, never motivational speaker energy
- never say "site" - always say "website"

hard rules - never break these:
- no emojis
- no hashtags
- no em dashes
- no hype language
- no overused phrases: "game-changer", "the best part", "at the end of the day", "unlock potential"
- no filler transitions: "in addition", "furthermore", "in conclusion", "that said"
- no throat-clearing intros like "i've been thinking about" or "here's the thing"
- do not expose private personal details that should not be public

${examples ? `these are real posts written by ben. this is the most important thing in this prompt. match the length, the rhythm, the structure, and the energy of these exactly. most of them are long. do not write short posts. do not clean them up. if the draft does not look and feel exactly like these then rewrite it until it does:\n\n${examples}\n` : ''}
your job: read the journal and write exactly ${POST_COUNT} posts. split them evenly:

half of the posts (round down) should be personal - observations from his day, random realizations, stories about anything. same style as the examples. the point can be about life, mindset, work, whatever fits.

the other half should connect to websites, trust, or conversion for coaches and online business owners. but do NOT write them like marketing content. write them exactly like the personal posts - start with a real moment or observation from the journal, let it unfold, and land on a point about why a bad website costs coaches clients, or why design signals trust, or why diy looks cheap, or whatever fits naturally. the website angle should feel like a natural conclusion not a pitch.

start every post the way ben naturally starts - with what he was doing or noticing. not with a thesis. not with a lesson. the lesson comes at the end.

output exactly ${POST_COUNT} posts using these exact delimiters. nothing else before, between, or after:

${delimiterBlock}`;

const userPrompt = `journal entry - ${journal.name}:\n\n${journalContent}`;

console.log('generating posts...');
const response = await complete(systemPrompt, userPrompt);

// Parse posts
const posts = parsePosts(response, POST_COUNT);

if (posts.length === 0) {
  console.error('could not parse posts from response. raw output:');
  console.log(response);
  process.exit(1);
}

// Save drafts to output
const today = new Date().toISOString().slice(0, 10);
ensureDir('output/drafts');
const outputPath = `output/drafts/${today}.daily.md`;
const outputContent = posts.map((p, i) => `## post ${i + 1}\n\n${p}`).join('\n\n---\n\n');
fs.writeFileSync(outputPath, outputContent, 'utf8');

console.log(`\n${posts.length} posts generated. scheduling to typefully...\n`);

// Fetch social set ID
const authHeaders = {
  'Authorization': `Bearer ${TYPEFULLY_API_KEY}`,
  'Content-Type': 'application/json',
};

const socialSetsRes = await fetch('https://api.typefully.com/v2/social-sets', { headers: authHeaders });
if (!socialSetsRes.ok) {
  const err = await socialSetsRes.text();
  console.error(`typefully auth failed: ${err}`);
  process.exit(1);
}
const socialSets = await socialSetsRes.json() as { results: { id: string }[] };
const socialSetId = socialSets.results[0]?.id;
if (!socialSetId) {
  console.error('no social set found in typefully. connect an account first.');
  process.exit(1);
}

// Schedule to Typefully
let scheduled = 0;

for (const [i, post] of posts.entries()) {
  try {
    const res = await fetch(`https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        platforms: {
          x: {
            enabled: true,
            posts: [{ text: post }],
          },
        },
        publish_at: 'next-free-slot',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`post ${i + 1}: failed - ${err}`);
      continue;
    }

    console.log(`post ${i + 1}: added to queue`);
    scheduled++;
  } catch (err) {
    console.error(`post ${i + 1}: error -`, err);
  }
}

console.log(`\ndone. ${scheduled}/${posts.length} posts in typefully.`);
console.log(`drafts saved to ${outputPath}`);

// Parse Claude's delimited output
function parsePosts(text: string, count: number): string[] {
  const pattern = /===post-\d+===/g;
  const parts = text.split(pattern);
  return parts
    .slice(1, count + 1)
    .map((p) => p.trim())
    .filter(Boolean);
}

