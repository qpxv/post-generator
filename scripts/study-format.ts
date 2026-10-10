import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { readText, writeText } from '../src/lib/fs.js';

// Local tooling: one opus call through the claude cli (subscription usage).
// A creator's whole post export fits in a single prompt, so there is no
// map/reduce step like distill has.
const MODEL = 'opus';

type Complete = (system: string, user: string, model: string) => Promise<string>;

const SYSTEM = `you study a batch of x posts by one creator and write a format guide: how his value posts are built, so a ghostwriting model can build posts the same way on a completely different topic.

the posts were pasted from x by hand. separators are inconsistent and some x interface text (names, handles, dates, stray symbols) is mixed in. ignore all of that and work out where posts start and end from the content.

the ghostwriter writes for ben, who builds websites for business owners. the creator's topics (twitter growth, ghostwriting, sales, whatever they are) do not matter at all. only the construction does. never tell the reader what to write about, only how to build it.

write markdown with these sections, starting directly with the first one:

## what makes these posts work
3 to 6 sentences on the underlying mechanics: why a reader stops, keeps reading, saves, and trusts the writer

## hooks
each hook type he uses: what it does, a fill-in template, and when to use it. include how numbers and specificity show up in the first line

## skeletons
the post structures he reuses (for example a ranked breakdown, a mistake and its fix, "i did x and here is what happened", a contrarian claim defended point by point). for each: when to use it, then the skeleton line by line as a template with placeholders

## developing a point
how one point gets built: the claim, the mechanism behind it, the consequence, a concrete example. how deep he goes and what he never skips

## structure and typography
how he uses numbered points, section labels in caps, hyphen lists, single-line paragraphs, white space and emphasis, and how long the posts run

## transitions and closers
how he moves between parts, and every way he ends a post, each as a template

## what to avoid
habits of his that would not carry over to someone else's voice, or that only work because of his specific audience

rules:
- describe patterns as templates with placeholders, not as copies of his posts. quote at most 6 short lines of his in the whole guide, each under 15 words
- every point must be concrete enough to build a post from
- no em dashes
- output only the markdown, no preamble`;

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

// Shells leave a ~ after "--in=" unexpanded
function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

async function studyFormat(complete: Complete, posts: string): Promise<string> {
  return (await complete(SYSTEM, `posts:\n\n${posts}`, MODEL)).trim();
}

const inArg = argValue('in');
const outArg = argValue('out');
if (!inArg || !outArg) {
  console.error('usage: npm run study-format -- --in=<posts file> --out=<guide path>');
  process.exit(1);
}
const inPath = expandHome(inArg);
if (!fs.existsSync(inPath)) {
  console.error(`no file at ${inPath}`);
  process.exit(1);
}

const posts = readText(inPath);
console.log(`studying ${posts.split(/\s+/).length} words of posts with ${MODEL}...`);
const guide = await studyFormat(completeViaCli, posts);
writeText(outArg, `# value post format\n\n${guide}\n`);
console.log(`done. wrote ${outArg}`);
