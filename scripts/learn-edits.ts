import fs from 'node:fs';
import { loadEnv } from '../src/lib/env.js';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { writeText } from '../src/lib/fs.js';
import { CHANGELOG_PATH, EDIT_PROMPT_PATH, EDIT_STATE_PATH, EDITS_PATH, loadJson, saveJson } from '../src/lib/performance/store.js';
import type { EditLearnState, EditPair, EditRule, EditsFile } from '../src/types/performance.js';

loadEnv();

// --cli goes through the local claude cli (subscription) for testing, ci uses the api
const isCliMode = process.argv.includes('--cli');
// --force relearns even when no new reviews came in
const isForce = process.argv.includes('--force');
const API_MODEL = 'claude-sonnet-5-5';
const CLI_MODEL = 'sonnet';
// Fewer edits than this is anecdote, not a pattern
const MIN_REVIEWED = 10;
// Relearn only once enough new reviews piled up, so the rules don't churn nightly
const MIN_NEW_DECIDED = 5;
const MAX_EDITED_PAIRS = 60;
const MAX_DELETED = 20;
const MAX_KEPT = 10;
const MAX_RULES = 10;
const EXAMPLE_COUNT = 3;
// Near-identical pairs make weak examples: the change is a word or a comma
const EXAMPLE_MAX_SIMILARITY = 0.95;

const SCHEMA = {
  type: 'object',
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rule: { type: 'string' }, evidence: { type: 'string' } },
        required: ['rule', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['rules'],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const SYSTEM_PROMPT = `you study how ben edits drafts of his x posts before they publish. a model writes the drafts, ben reviews every one: he keeps it as written, edits it, or deletes it. your job is to find the edits he makes again and again and turn them into rules the model can follow, so his next drafts need no fixing.

rules for the rules:
- concrete and checkable. name the exact kind of line, word, phrase, or structure he cuts, adds, or swaps, and what he puts in its place. "cuts the closing line when it restates the hook" is a rule. "makes it punchier" is not
- only patterns that show up in at least 3 different pairs. a one-off change is not a rule
- ignore fact corrections (a wrong name, number, place, or detail only ben could know). those fix content, not style
- for deleted drafts, say what they share that the published ones don't, if anything clear stands out
- don't contradict what he leaves untouched: if the kept drafts do something, it is fine
- at most ${MAX_RULES} rules, most frequent first. write each rule as an instruction to the writer, lowercase
- evidence: how many pairs show it, plus one short quote of a before and after

respond with json only.`;

function newestFirst(pairs: EditPair[]): EditPair[] {
  return [...pairs].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

function formatThread(text: string, reply: string | null): string {
  return reply ? `${text}\n[reply under it]\n${reply}` : text;
}

function buildUserPrompt(pairs: EditPair[]): string {
  const of = (outcome: EditPair['outcome']): EditPair[] => newestFirst(pairs.filter((p) => p.outcome === outcome));
  const edited = of('edited').slice(0, MAX_EDITED_PAIRS);
  const deleted = of('deleted').slice(0, MAX_DELETED);
  const kept = of('kept').slice(0, MAX_KEPT);
  const sections = [
    `review totals: ${of('kept').length} kept as written, ${of('edited').length} edited, ${of('deleted').length} deleted`,
    `## edited (${edited.length})\n\n${edited.map((p, i) => `### pair ${i + 1}\n--- draft\n${formatThread(p.original, p.originalReply)}\n--- published\n${formatThread(p.published ?? '', p.publishedReply)}`).join('\n\n')}`,
  ];
  if (deleted.length > 0) sections.push(`## deleted (${deleted.length})\n\n${deleted.map((p, i) => `### deleted ${i + 1}\n${formatThread(p.original, p.originalReply)}`).join('\n\n')}`);
  if (kept.length > 0) sections.push(`## kept as written (${kept.length})\n\n${kept.map((p, i) => `### kept ${i + 1}\n${formatThread(p.original, p.originalReply)}`).join('\n\n')}`);
  return sections.join('\n\n');
}

async function generateRules(userPrompt: string): Promise<string> {
  if (isCliMode) {
    const jsonInstruction = `\n\nrespond with only a json object matching this schema, no prose and no code fence:\n${JSON.stringify(SCHEMA)}`;
    return await completeViaCli(SYSTEM_PROMPT + jsonInstruction, userPrompt, CLI_MODEL);
  }
  // Imported lazily so --cli runs never need an ANTHROPIC_API_KEY
  const { completeJson } = await import('../src/lib/claude.js');
  return await completeJson(SYSTEM_PROMPT, userPrompt, SCHEMA, API_MODEL);
}

function parseRules(raw: string): EditRule[] {
  const parsed = JSON.parse(raw) as { rules?: unknown };
  if (!Array.isArray(parsed.rules)) throw new Error('model reply has no rules array');
  return parsed.rules.flatMap((entry: unknown): EditRule[] => {
    const { rule, evidence } = (entry ?? {}) as { rule?: unknown; evidence?: unknown };
    if (typeof rule !== 'string' || rule.trim() === '') return [];
    return [{ rule: rule.trim(), evidence: typeof evidence === 'string' ? evidence.trim() : '' }];
  }).slice(0, MAX_RULES);
}

function pickExamples(pairs: EditPair[]): EditPair[] {
  const edited = newestFirst(pairs.filter((p) => p.outcome === 'edited'));
  const clear = edited.filter((p) => p.similarity < EXAMPLE_MAX_SIMILARITY);
  return (clear.length >= EXAMPLE_COUNT ? clear : edited).slice(0, EXAMPLE_COUNT);
}

// Rendered by code so the model can only fill the rule list, never reshape the prompt
function renderPrompt(rules: EditRule[], pairs: EditPair[]): string {
  const count = (outcome: EditPair['outcome']): number => pairs.filter((p) => p.outcome === outcome).length;
  const examples = pickExamples(pairs).map((p) =>
    `draft:\n${formatThread(p.original, p.originalReply)}\n\nwhat ben published:\n${formatThread(p.published ?? '', p.publishedReply)}`
  );
  return `how ben edits drafts in review: he has reviewed ${pairs.length} drafts so far, kept ${count('kept')} as written, edited ${count('edited')} and deleted ${count('deleted')}. these are the changes he makes over and over. write every post (exploration posts included) the way he would leave it, so he has nothing to fix:

${rules.map((r) => `- ${r.rule}`).join('\n')}

recent edits of his, the draft first and then the version he published. follow the direction of his changes, don't copy these posts:

${examples.join('\n\n---\n\n')}
`;
}

function logChanges(rules: EditRule[], reviewed: number, today: string): void {
  const existing = fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf8') : '# learned prompt changelog\n\n';
  const lines = [`- ${today}: edit rules relearned from ${reviewed} reviewed drafts`, ...rules.map((r) => `  - ${r.rule} (${r.evidence})`)];
  writeText(CHANGELOG_PATH, existing + lines.join('\n') + '\n');
}

const pairs = Object.values(loadJson<EditsFile>(EDITS_PATH, {}));
const reviewed = pairs.filter((p) => p.outcome !== 'kept').length;
const state = loadJson<EditLearnState | null>(EDIT_STATE_PATH, null);
const newDecided = pairs.length - (state?.decidedCount ?? 0);

if (reviewed < MIN_REVIEWED) {
  console.log(`only ${reviewed} edited or deleted drafts, need ${MIN_REVIEWED} before learning`);
  process.exit(0);
}
if (state && newDecided < MIN_NEW_DECIDED && !isForce) {
  console.log(`${newDecided} new reviews since ${state.learnedAt.slice(0, 10)}, waiting for ${MIN_NEW_DECIDED}`);
  process.exit(0);
}

console.log(`learning from ${pairs.length} reviewed drafts (${isCliMode ? 'claude cli' : API_MODEL})...`);
// A failed call or an empty reply throws before anything is written, so the
// last edits.md stays in the prompt
const rules = parseRules(await generateRules(buildUserPrompt(pairs)));
if (rules.length === 0) throw new Error('model returned no usable rules, keeping the previous ones');

const now = new Date().toISOString();
writeText(EDIT_PROMPT_PATH, renderPrompt(rules, pairs));
saveJson(EDIT_STATE_PATH, { learnedAt: now, decidedCount: pairs.length, rules } satisfies EditLearnState);
logChanges(rules, pairs.length, now.slice(0, 10));

for (const r of rules) console.log(`- ${r.rule}\n    ${r.evidence}`);
console.log(`\n${rules.length} rules saved to ${EDIT_PROMPT_PATH}`);
