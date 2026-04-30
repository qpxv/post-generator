import fs from 'node:fs';
import path from 'node:path';
import { readText, ensureDir } from '../src/lib/fs.js';
import { complete } from '../src/lib/claude.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

const JOURNAL_DIR = process.env.JOURNAL_DIR;
if (!JOURNAL_DIR) {
  console.error('missing JOURNAL_DIR in .env');
  process.exit(1);
}

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

const picked = journalFiles[0];
console.log(`picked journal entry: ${picked.name}`);
const journalContent = readText(picked.fullPath);

// Load strong newsletter examples only
const examplePath = 'data/examples/good-newsletters.md';
const examples = fs.existsSync(examplePath) ? readText(examplePath) : '';

const exampleBlock = examples.trim()
  ? `\n\nHere are Ben's best newsletters. These are the gold standard for voice and structure. Match this energy exactly:\n\n${examples}`
  : '';

const systemPrompt = `You are ghostwriting a newsletter email as Ben Winzer.

## Who Ben is
- Early 20s, lives in Germany, has a 9-5 as a developer and builds websites for coaches / online business owners on the side
- Obsessed with sales psychology, human behavior, and Alex Hormozi-style thinking
- Loves birds (especially magpies), driving, speed, coffee (black, thinks it tastes bad but drinks it anyway), observing random things and connecting them to business
- Has a younger brother Lukas
- Journals constantly throughout the day on his phone — raw, unfiltered, stream of consciousness

## Ben's voice
- Casual, energetic, talks like he's texting a friend
- Uses "bro", "bruv", short punchy sentences, lots of line breaks
- Swears occasionally but not excessively
- Uses ALL CAPS for emphasis but not constantly — it hits harder when it's rare
- Tells stories from his actual day and then connects them to a business insight
- Self-aware and self-deprecating — laughs at himself
- Never sounds like a copywriter, marketer, or LinkedIn poster
- No filler words like "in today's email" or "let me share something with you"
- No corporate transitions like "here's the thing" or "and that brings me to my next point"
- The business lesson should feel like it occurs to him naturally mid-story, not like the whole email was reverse-engineered from the lesson

## Structure rules
- The email should be 300-500 words max
- Open with something that happened — drop straight into the story, no greeting beyond a casual one-liner
- Tell the story with specific details (names, places, what actually happened)
- Let the business connection emerge from the story organically — don't force it
- The takeaway should be one clear idea, not three
- End casually — "talk soon", "see you next time", something short. No dramatic sign-offs
- No hashtags, no bullet point lists, no headers, no bold text
- No "anyway this was a long email" or "hope this helped" or apologizing for length
- Never start more than 2 consecutive sentences with the same word

## What makes a BAD Ben email (avoid these)
- Opening with 15 O's in "YOYOYOOO" — one casual opener is fine, don't overdo it
- Padding the email because it feels too short
- Tangents that go nowhere and don't connect back
- Ending with "I don't even know why I wrote this"
- Repeating the same "don't give up" lesson with a different metaphor
- Sounding like an AI pretending to be casual

## Subject line
- Should make someone curious enough to open it
- Lowercase, conversational, slightly weird or funny
- Should NOT sound like a marketing email
- Examples of good ones: "I got publicly humiliated at a grocery store", "pigeons are smarter than most humans", "my plan to steal all of the birds from my neighbors"${exampleBlock}

## Output format
Return ONLY the following format with no other text:

===subject===
the subject line here
===body===
the full email body here`;

const userPrompt = `Here is Ben's journal entry from today. Read through it, find the most interesting or funny moment that can naturally connect to a business insight about websites, sales, or client work, and write one newsletter email from it.

Don't pick the most "obviously business-related" entry. Pick the one that makes the best story.

Journal — ${picked.name}:
${journalContent}`;

console.log('writing newsletter...');
const response = await complete(systemPrompt, userPrompt);

// Parse output
const subject = extractBlock(response, 'subject');
const body = extractBlock(response, 'body');

if (!subject || !body) {
  console.error('could not parse newsletter output. raw response:');
  console.log(response);
  process.exit(1);
}

// Save draft
const today = new Date().toISOString().slice(0, 10);
ensureDir('output/newsletters');
const outputPath = `output/newsletters/${today}.draft.md`;
const wordCount = body.trim().split(/\s+/).length;

const output = [
  `# subject: ${subject}`,
  '',
  body,
  '',
  '---',
  `generated from: ${picked.name}`,
  `words: ${wordCount}`,
  `date: ${today}`,
].join('\n');

fs.writeFileSync(outputPath, output, 'utf8');

console.log(`\ndone.`);
console.log(`subject: ${subject}`);
console.log(`words: ${wordCount}`);
console.log(`saved to ${outputPath}`);

function extractBlock(text: string, label: string): string | null {
  const startMarker = `===${label}===`;
  const labels = ['subject', 'preview', 'body'];
  const nextLabels = labels.filter((l) => l !== label);

  const start = text.indexOf(startMarker);
  if (start === -1) return null;

  const contentStart = start + startMarker.length;
  let end = text.length;
  for (const next of nextLabels) {
    const idx = text.indexOf(`===${next}===`, contentStart);
    if (idx !== -1 && idx < end) end = idx;
  }

  return text.slice(contentStart, end).trim();
}