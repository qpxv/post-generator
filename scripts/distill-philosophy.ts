import path from 'node:path';
import fs from 'node:fs';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { listFiles, readText, writeText } from '../src/lib/fs.js';
import { runPool } from '../src/lib/pool.js';
import { notesDir, philosophyPath, transcriptDir } from '../src/lib/transcripts.js';

// Local tooling: every call goes through the claude cli (subscription usage).
// Per-video notes are mechanical extraction, so sonnet keeps 100+ calls fast.
// The merge is where judgment matters, so it gets opus.
const MAP_MODEL = 'sonnet';
const REDUCE_MODEL = 'opus';
const MAP_CONCURRENCY = 4;

type Complete = (system: string, user: string, model: string) => Promise<string>;

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

const BUYER_MAP_SYSTEM = `you read the transcript of one youtube video by a web designer and extract notes for a later step that merges notes from 100+ of his videos into one document describing his philosophy.

the reader of the final document is ben, who builds websites for business owners and writes about why websites win or lose customers. the designer in these videos mostly talks TO other web designers. extract everything, but label each point so the merge step can filter it.

write markdown with these sections, skipping any that are empty:

## principles
each belief he holds about what makes a website work or fail, or about how buyers think. for each one: the claim in one sentence, then the reasoning he gives for why it is true, then the most concrete example he uses (a real website, a client story, a number, a before and after). tag each with [buyer-facing] if it is about why a website wins or loses customers, or [designer-business] if it is about running a web design business (pricing, finding clients, process, tools)

## how visitors judge a website
specific claims about what a visitor notices, decides, or feels on a page and what causes it

## what clients believe and object to
things business owners say, believe, or push back on, as close to how he quotes them as possible, plus how he answers each one

## tactics
specific, concrete tips (a layout pattern, a copy rule, a spacing rule, a section order) with the reason they work

## memorable phrasings
short lines or framings he uses that capture an idea well, quoted exactly

rules:
- keep every example concrete. a note that says "good design builds trust" without the specific thing that causes it is useless, skip it or find the specific thing in the transcript
- never invent anything that is not in the transcript
- do not summarize the video's structure ("first he talks about...")
- no em dashes
- output only the markdown, no preamble`;

const BUYER_REDUCE_SYSTEM = `you merge per-video notes from 100+ youtube videos by one web designer into a single document that captures his philosophy. a ghostwriting model will read this document every night to ground x posts for ben, who builds websites for business owners. ben's audience is business owners deciding whether their website is costing them customers, not other web designers.

audience filter:
- keep everything about why a website wins or loses customers, how visitors judge a page, design and copy decisions and the reasons behind them
- drop material that only matters to someone running a web design business: tools, software tutorials, how to find clients, how to price your own services, freelancing workflow
- exception: what clients believe and object to is kept, because those are real buyer beliefs ben's audience holds

write markdown with exactly these sections, starting directly with the first one:

## core principles
the beliefs that recur across many videos, ranked by how many videos they appear in (most first). for each: a short bold title, the claim stated plainly, the reasoning behind it, one concrete example from the notes, and "(appears in N videos)". merge near-duplicates into one principle instead of listing variants. aim for 15 to 30 principles

## how buyers judge a website
the psychology: what a visitor notices first, what they decide and how fast, what signals cause them to trust or leave. concrete causes only

## what clients believe and object to
each belief or objection as the client would say it, followed by the reasoning that answers it

## tactics
specific, concrete tips with the reason each one works, grouped under short subheadings (layout, copy, typography, imagery, proof, conversion, or whatever groups emerge). drop anything vague

rules:
- write in plain language in your own words, except for the memorable phrasings you choose to keep, which are quoted and marked as his
- every point must point at something specific and observable. cut anything that only names a conclusion (feels premium, builds trust, looks professional) without the cause
- never invent anything that is not in the notes
- no em dashes
- output only the markdown, no preamble`;

const DESIGN_MAP_SYSTEM = `you read the transcript of one youtube video by a web designer and extract notes on his design craft, for a later step that merges notes from 100+ of his videos into a design playbook. the playbook is read by a designer (and a model) building premium marketing websites, so what matters is anything that changes how a page gets designed.

write markdown with these sections, skipping any that are empty:

## design principles
each belief he holds about how to design a page well. for each: the claim in one sentence, the reasoning he gives, and the most concrete example he uses (a named website, a before and after, a specific section he points at)

## layout patterns
every section or page composition he describes or shows: give it a short name, describe its structure precisely (columns, what sits where, proportions, how it changes on mobile), what it is good for, and the example site if he names one

## typography
fonts he names, pairings, sizes, scales, weights, line height, letter spacing, line length, and the reason behind each

## color
palettes, ratios, how many colors, which roles they play, contrast, dark versus light, and the reasons

## imagery
how he picks, crops, treats, and places photos, illustrations, video, and 3d

## motion and interaction
animations, hover states, scroll effects, micro interactions: what they are, when they help, when they hurt, and any timing or easing he mentions

## styles
any design style he names (for example brutalism, minimal, editorial): what visually defines it, who it suits, and examples

## mobile
anything specific to phones and tablets

## checks
tests or reviews he runs on a design before calling it done

## exact values
every concrete number he gives (px, ratios, percentages, counts) with what it applies to

rules:
- be precise and concrete. "use good spacing" is useless, "16px inside a group, 32px between groups" is the kind of note this step exists for
- leave out sales, pricing, finding clients, and business advice
- leave out click by click software instructions (which menu in figma or framer), but keep the design decision the tutorial is making
- never invent anything that is not in the transcript
- no em dashes
- output only the markdown, no preamble`;

const DESIGN_REDUCE_SYSTEM = `you merge per-video design notes from 100+ youtube videos by one web designer into a single design playbook. the reader is a designer, or a model acting as one, about to design a premium marketing website for a client. it should make their next design decision better: which layout, which type scale, which palette structure, which motion, and why.

write markdown with exactly these sections, starting directly with the first one:

## design principles
the beliefs that recur across many videos, ranked by how many videos they appear in (most first). for each: a short bold title, the claim, the reasoning, one concrete example, and "(appears in N videos)". merge near-duplicates. aim for 15 to 30

## layout patterns
a catalog of named, reusable section and page compositions. for each: the name in bold, its structure precisely enough to build from (columns, what sits where, proportions, mobile behavior), what it is best for, and an example site if one was named. group under subheadings (heroes, feature sections, proof and testimonials, galleries and portfolios, calls to action, footers, whole-page structures, or whatever groups emerge). this is the most valuable section, be thorough

## typography
the rules and values: typeface choice and pairing, scale, weights, line height, letter spacing, line length, and named fonts he recommends with what each suits

## color
palette structure, ratios, roles, contrast, dark and light modes, and how to derive variations

## imagery
choosing, treating, cropping, and placing photos, video, illustration, and 3d

## motion and interaction
what to animate, what not to, timing, and the line between adding to a page and distracting from it

## styles
each style he names: what visually defines it, who it suits, and an example

## mobile
how layouts, type, and interaction change on smaller screens

## review checklist
the tests to run on a finished page before calling it done, as a checklist

rules:
- write in plain language in your own words. keep his memorable phrasings where they capture an idea well, quoted and marked as his
- every point must be concrete enough to act on. cut anything that only names a quality (clean, premium, modern) without saying what produces it
- keep exact values wherever the notes have them
- where his advice differs between videos, give the version he repeats most and note the exception
- leave out sales, pricing, business advice, and buyer psychology that is not a design decision
- never invent anything that is not in the notes
- no em dashes
- output only the markdown, no preamble`;

interface Focus {
  mapSystem: string;
  reduceSystem: string;
  notesFolder: string;
  title: string;
  // null when the output has no home in this repo and --out is required
  defaultOut: ((slug: string) => string) | null;
}

// buyer feeds post generation here, design feeds the website builder in
// another repo, so it has no default path in this one
const FOCUSES = {
  buyer: { mapSystem: BUYER_MAP_SYSTEM, reduceSystem: BUYER_REDUCE_SYSTEM, notesFolder: 'notes', title: 'philosophy', defaultOut: philosophyPath },
  design: { mapSystem: DESIGN_MAP_SYSTEM, reduceSystem: DESIGN_REDUCE_SYSTEM, notesFolder: 'notes-design', title: 'design playbook', defaultOut: null },
} as const satisfies Record<string, Focus>;
type FocusName = keyof typeof FOCUSES;

function isFocusName(value: string): value is FocusName {
  return value in FOCUSES;
}

function buildMapUser(transcript: string): string {
  return `transcript:\n\n${transcript}`;
}

function buildReduceUser(notes: { title: string; body: string }[]): string {
  return notes.map((n) => `=== video: ${n.title} ===\n${n.body}`).join('\n\n');
}

function transcriptTitle(transcript: string): string {
  return transcript.match(/^title: (.*)$/m)?.[1] ?? 'unknown';
}

async function extractNotes(complete: Complete, focus: Focus, transcript: string): Promise<string> {
  return (await complete(focus.mapSystem, buildMapUser(transcript), MAP_MODEL)).trim();
}

async function mergeNotes(complete: Complete, focus: Focus, notes: { title: string; body: string }[]): Promise<string> {
  return (await complete(focus.reduceSystem, buildReduceUser(notes), REDUCE_MODEL)).trim();
}

const slug = argValue('slug');
if (!slug) {
  console.error('usage: npm run distill -- --slug=<folder name> [--focus=buyer|design] [--out=<path>] [--limit=N]');
  process.exit(1);
}
const focusName = argValue('focus') ?? 'buyer';
if (!isFocusName(focusName)) {
  console.error(`unknown --focus=${focusName}, expected one of: ${Object.keys(FOCUSES).join(', ')}`);
  process.exit(1);
}
const focus: Focus = FOCUSES[focusName];
const outPath = argValue('out') ?? focus.defaultOut?.(slug);
if (!outPath) {
  console.error(`--focus=${focusName} has no default output, pass --out=<path>`);
  process.exit(1);
}
const focusNotesDir = notesDir(slug, focus.notesFolder);
// --limit N writes notes for N videos and skips the merge, for checking the
// note quality by eye before spending 100+ calls
const limitArg = argValue('limit');
const limit = limitArg ? Number(limitArg) : Infinity;

const transcripts = listFiles(transcriptDir(slug)).filter((f) => f.endsWith('.txt'));
if (transcripts.length === 0) {
  console.error(`no transcripts in ${transcriptDir(slug)}, run npm run transcripts first`);
  process.exit(1);
}

const notePath = (transcriptPath: string): string =>
  path.join(focusNotesDir, `${path.basename(transcriptPath, '.txt')}.md`);
// Notes are cached so a rerun only pays for videos added since
const pending = transcripts.filter((t) => !fs.existsSync(notePath(t))).slice(0, limit);
console.log(`${focusName} focus: ${transcripts.length} transcripts, ${pending.length} need notes`);

let done = 0;
let failed = 0;
await runPool(pending, MAP_CONCURRENCY, async (transcriptPath) => {
  const transcript = readText(transcriptPath);
  try {
    writeText(notePath(transcriptPath), `${await extractNotes(completeViaCli, focus, transcript)}\n`);
    done++;
    console.log(`  [${done}/${pending.length}] ${transcriptTitle(transcript)}`);
  } catch (err) {
    failed++;
    console.error(`  failed: ${transcriptTitle(transcript)} - ${err instanceof Error ? err.message : String(err)}`);
  }
});

if (Number.isFinite(limit)) {
  console.log(`\n--limit set: wrote ${done} notes to ${focusNotesDir}, skipping the merge`);
  process.exit(0);
}
if (failed > 0) {
  console.error(`\n${failed} videos failed, rerun to retry them before merging`);
  process.exit(1);
}

const notes = transcripts.map((t) => ({ title: transcriptTitle(readText(t)), body: readText(notePath(t)) }));
console.log(`\nmerging ${notes.length} notes with ${REDUCE_MODEL}...`);
const merged = await mergeNotes(completeViaCli, focus, notes);
// Heading comes from the slug so the prompt stays reusable for another creator
writeText(outPath, `# ${slug.replace(/-/g, ' ')}: ${focus.title}\n\n${merged}\n`);
console.log(`done. wrote ${outPath}`);
