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
    .filter((f) => f.endsWith('.md') && !f.includes('README') && !f.includes('replies'))
    .map((f) => readText(path.join(exampleDir, f)))
  : [];
const examples = exampleFiles.join('\n\n---\n\n');

// Load reply examples
const replyExamplesPath = 'data/examples/good-replies.md';
const replyExamples = fs.existsSync(replyExamplesPath) ? readText(replyExamplesPath) : '';

// Build delimiter list dynamically based on POST_COUNT
const delimiterBlock = Array.from(
  { length: POST_COUNT },
  (_, i) => `===post-${i + 1}===\n{post}\n===reply-${i + 1}===\n{reply or "none"}`
).join('\n');

const systemPrompt = `you are ghostwriting x posts for ben winzer.

ben is 20. builds websites for coaches and online business owners. most of his posts are about websites, trust, design, and conversion - but written from real observations and moments, never like marketing content. personal posts show up occasionally and keep the account human.

voice:
- all lowercase, always
- zero punctuation - no periods, no commas, no question marks, no colons, nothing at all
- every sentence or short thought gets its own line with a blank line between
- personal and direct - writes like he is talking to one person
- stream of consciousness that leads somewhere
- profanity is fine when it sounds natural
- never corporate, never polished, never motivational speaker energy
- never say "site" - always say "website"
- unapologetic - does not qualify opinions before stating them
- confident and declarative - states things as fact not as possibility
- does not second-guess himself mid-post
- the tone has evolved - ben is not the same person he was six months ago. the voice is more certain now. do not write like the older softer posts
- occasionally use full caps on a single word or short phrase for emphasis - the leader effect. use it sparingly so it lands hard when it does. example: "your website is COSTING you clients" or "nobody CARES about your logo". never caps a whole sentence. one caps moment per post maximum, and only when it genuinely adds punch

hard rules - never break these:
- no emojis
- no hashtags
- no em dashes
- no hype language
- no overused phrases: "game-changer", "the best part", "at the end of the day", "unlock potential"
- no filler transitions: "in addition", "furthermore", "in conclusion", "that said"
- no throat-clearing intros like "i've been thinking about" or "here's the thing"
- no hedging qualifiers: "i think", "i guess", "kind of", "sort of", "maybe", "i feel like", "i'm not sure but"
- never soften a take before making it - state it directly
- do not expose private personal details that should not be public
- never write about topics that would reduce authority or make ben look small - this includes family, relationships, personal struggles, emotional vulnerability, anything that signals instability or neediness. if the journal mentions these things, extract a business or mindset angle from the context instead and leave the private detail out entirely. the account should always project competence and forward momentum

${examples ? `these are reference posts from other creators in different niches. do not copy their subject matter. instead study and replicate: the hook energy, the rhythm, the structure, the confidence, and the pacing. apply all of that to ben's topics. the examples show you the level of directness, the kind of hooks that land hard, and when to write short vs long. if a post does not feel as sharp and confident as these examples then rewrite it until it does:\n\n${examples}\n` : ''}
replies: every website-focused post (the 75%) must have a reply. personal posts (the 25%) must output "none" for the reply.

the reply is a second tweet that threads directly under the main post. rules:
- max 2 lines
- all lowercase, zero punctuation - same voice rules as the main post
- it should feel like a natural follow-through from the post, not a pitch
- it must reference the specific angle of the post - never generic
- it is an invitation to reach out, not a sales message
- never start with "if you want" or "click here" or "book a call"
- never sound like a marketer wrote it

${replyExamples ? `these are example replies to use as reference for energy and length. study the tone - direct, short, personal, never salesy:\n\n${replyExamples}\n` : ''}
post length: mix short and long posts. for every ${POST_COUNT} posts, write at least 1 and at most 2 as short posts. a short post is a maximum of 280 characters total including all spaces and line breaks - count carefully and do not exceed this. short posts should hit harder than long ones because they have no room to build. every word has to earn its place. the rest of the posts can be long - multiple paragraphs, stream of consciousness, builds to a point.

hooks: every post must open with a hook that makes someone stop scrolling. no slow builds. no context-setting. the first line is everything. look at how the example posts open and match that energy. specific > vague. concrete > abstract. story > statement when possible.

your job: read the journal and write exactly ${POST_COUNT} posts with this split:

75% of the posts (round up) should connect to websites, trust, or conversion for coaches and online business owners. but do NOT write them like marketing content. start with a real moment or observation from the journal, let it unfold, and land on a point about why a bad website costs coaches clients, why design signals trust, why diy looks cheap, or whatever fits naturally from the journal. the website angle should feel like an inevitable conclusion not a pitch.

25% of the posts (round down) should be personal - observations from his day, random realizations, stories about anything. the point can be about life, mindset, work, money, whatever fits. no website angle required.

start every post with a hook - not with context, not with a thesis, not with a warm up. the hook is the first line and it needs to grab.

output exactly ${POST_COUNT} posts using these exact delimiters. nothing else before, between, or after:

${delimiterBlock}`;

const userPrompt = `journal entry - ${journal.name}:\n\n${journalContent}`;

console.log('generating posts...');
const response = await complete(systemPrompt, userPrompt);

// Parse posts and replies
const posts = parsePosts(response, POST_COUNT);
const replies = parseReplies(response, POST_COUNT);

if (posts.length === 0) {
  console.error('could not parse posts from response. raw output:');
  console.log(response);
  process.exit(1);
}

// Save drafts to output
const today = new Date().toISOString().slice(0, 10);
ensureDir('output/drafts');
const outputPath = `output/drafts/${today}.daily.md`;
const outputContent = posts
  .map((p, i) => {
    const reply = replies[i];
    const replyLine = reply ? `\n\n**reply:** ${reply}` : '';
    return `## post ${i + 1}\n\n${p}${replyLine}`;
  })
  .join('\n\n---\n\n');
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
  const reply = replies[i];
  const postsPayload = reply
    ? [{ text: post }, { text: reply }]
    : [{ text: post }];

  try {
    const res = await fetch(`https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        platforms: {
          x: {
            enabled: true,
            posts: postsPayload,
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
  return Array.from({ length: count }, (_, i) => {
    const start = text.indexOf(`===post-${i + 1}===`);
    if (start === -1) return '';
    const contentStart = start + `===post-${i + 1}===`.length;
    const nextPost = text.indexOf(`===reply-${i + 1}===`, contentStart);
    const end = nextPost !== -1 ? nextPost : text.length;
    return text.slice(contentStart, end).trim();
  }).filter(Boolean);
}

function parseReplies(text: string, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) => {
    const marker = `===reply-${i + 1}===`;
    const start = text.indexOf(marker);
    if (start === -1) return null;
    const contentStart = start + marker.length;
    const nextPost = text.indexOf(`===post-${i + 2}===`, contentStart);
    const end = nextPost !== -1 ? nextPost : text.length;
    const val = text.slice(contentStart, end).trim();
    return val === 'none' || val === '' ? null : val;
  });
}

