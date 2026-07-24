import fs from 'node:fs';
import path from 'node:path';
import { readText, ensureDir } from '../src/lib/fs.js';
import { complete } from '../src/lib/claude.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

const JOURNAL_DIR = process.env.JOURNAL_DIR;
const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;
const POST_COUNT = parseInt(process.env.POST_COUNT ?? '5', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!JOURNAL_DIR) {
  console.error('missing JOURNAL_DIR in .env');
  process.exit(1);
}
if (!TYPEFULLY_API_KEY && !DRY_RUN) {
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

// Load ben's own voice samples (real messages, not curated posts)
const voiceSamplesPath = 'data/voice-samples.md';
const voiceSamples = fs.existsSync(voiceSamplesPath) ? readText(voiceSamplesPath) : '';

// Build delimiter list dynamically based on POST_COUNT
const delimiterBlock = Array.from(
  { length: POST_COUNT },
  (_, i) => `===post-${i + 1}===\n{post}\n===reply-${i + 1}===\n{reply or "none"}`
).join('\n');

const systemPrompt = `you are ghostwriting x posts for ben winzer.

ben is 20. builds websites for businesses across all kinds of niches - service businesses, personal brands, creators, local businesses, anyone who needs a website that actually converts. most of his posts are about websites, trust, design, and conversion - but written from real observations and moments, never like marketing content. personal posts show up occasionally and keep the account human.

voice:
- all lowercase, always
- zero punctuation - no periods, no commas, no question marks, no colons, nothing at all
- every sentence or short thought gets its own line with a blank line between
- personal and direct - writes like he is talking to one person
- stream of consciousness that leads somewhere
- profanity is fine when it sounds natural
- never corporate, never polished, never motivational speaker energy
- never say "site" - always say "website"
- write in past tense - the journal describes things that already happened, so tell it that way (was, went, said, saw, did, had, built, told, walked, realized)
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
- important meta-rule that applies to every rule below: these bans are about the underlying sentence shape, not the specific words in the examples. swapping in a synonym does not get around a ban - "stayed with me" instead of "stuck with me" is still banned, "none" instead of "no" is still banned, "they see X. they see Y." is banned for the exact same reason "it expects X. it expects Y." is banned even though the verb is different. before finalizing, check the SHAPE of what you wrote against these rules, not just whether the literal example words appear
- the master rule, broader than every specific example below: never write three or more short sentences or lines in a row that each describe a separate example, observation, or feature in parallel form - a list dressed up as prose. this is banned REGARDLESS of whether the wording or grammatical subject repeats. it applies just as much when every line uses a different subject and verb as when they're identical - "a raven stands on a parking lot. a school group plays a game. a woman on a race bike speeds past. a random dude gives me the nod." is banned even though no two lines share a subject or verb, for the exact same reason "they see X. they see Y. they see Z." is banned. it applies to concrete personal observations (a list of different things you noticed on the way to work) exactly as much as abstract business examples (a list of different website problems, or different things that happen "when someone lands on your website" - "the visitor's eye lands on the hero. they scroll and the next section answers the question. the button appears exactly where they reach for it. the price shows up right when they're ready." is banned too, even though hero/scroll/button/price are all different subjects). if you catch yourself about to write a third parallel short line describing "another thing" - another thing noticed, another website flaw, another element that works - stop. either cut the list to at most two items, or rewrite the whole passage as connected prose where each observation causes or explains the next, not just sits next to it
- never repeat the same sentence-opening structure (same subject + same verb, e.g. "they see...", "they knew...", "it expects...") two or more times in a row to fake rhythm - two is already enough to be a violation, not just three-plus, and this applies no matter which subject/verb pair it is, not just the ones listed as examples. this includes enumerated lists like "one X. one Y." or "they want X. they want Y." or "if X. if Y." or "they see X. they see Y." just as much as "it picks up on whether... it picks up on whether...". this is a mechanical ai tic, not how people write. banned examples: "it picks up on whether... it picks up on whether...", "it happens when... it happens when...", "you don't know... you don't know...", "then they... then they...", "one photo of a real result. one name attached to a real outcome.", "they want to understand what you do. they want to know it's real.", "if the copyright says 2021. if the testimonials have no names.", "they knew what the business does. they knew why it's good. they knew who it's for.", "they see a layout where the eye has nowhere to go. they see a photo that looks stock. they see a wall of text.". if a thought needs a list, either collapse it into one direct sentence or vary the structure of each line so it doesn't read as a template being repeated
- never use negation constructions - this applies no matter which negation word is used (no, not, none, nothing, never, without, etc), no matter which connector introduces the payoff (just, but, instead, rather), and no matter how many items are in the run, including just ONE negated clause followed by a payoff clause. "not dramatically, just a small hesitation" is banned. "none of the unnecessary resistance, just the thing doing what it's supposed to do" is banned. "not because the business is bad, but because the website never gave them a reason to believe it" is banned - "but" works exactly like "just" here, same shape. swapping "no"/"not" for a synonym like "none" or "nothing" does not get around this rule - it is the sentence shape that's banned, not the specific word. banned examples: "no friction, no confusion about what comes next", "no warmth, no prior trust", "no hesitation, no weird braking for no reason, just clean expected movement", "there is no face on the page. no past work shown anywhere. no client name. not a single thing that proves a real human being has ever paid for this.", "not dramatically. just a small hesitation.", "none of the unnecessary resistance. just the thing doing what it's supposed to do." - especially watch for this trap when writing about what's MISSING from a bad website (no proof, no face, no past work, etc) - describe the absence as one direct observation, not a checklist or a "not X, just Y" contrast
- never write two or more bare noun-phrase fragments with no verb back to back, one per line, used as a pseudo-poetic device - two fragments in a row is already a violation. banned examples: "the offer. the pricing. the guarantee.", "a case study with a 47 page breakdown. a testimonial video with cinematic b-roll. a completely redesigned brand identity.", "three seconds of actual attention. disproportionate results." write real sentences instead of fragment lists
- never use the "X doesn't do A, it does B" contrastive framing or close variants (e.g. "that's not what X is, that's what Y is", "it doesn't ask for attention, it takes it") - it's a cliche tell no matter what the subject is, not just when the subject is literally "the brain"
- if the journal mentions driving, braking, or hesitation specifically: this content keeps pulling toward "no braking, no hesitation, just clean movement" style phrasing - that exact family of phrasing is banned here above all else. describe the driving moment some other way entirely (what it looked like, what was said, how it felt) rather than reaching for a list of what didn't happen
- banned filler phrases (in addition to the ones already listed): "and that stuck with me" / "that stayed with me" / any close synonym of this same "this moment lodged in my memory" filler, in any form, "i just stood there"
- keep verbs consistently in past tense throughout each post - don't drift into present tense mid-post
- do not expose private personal details that should not be public
- never write about topics that would reduce authority or make ben look small - this includes family, relationships, personal struggles, emotional vulnerability, anything that signals instability or neediness. if the journal mentions these things, extract a business or mindset angle from the context instead and leave the private detail out entirely. the account should always project competence and forward momentum

word precision — this is the most important rule in this section:

every word must point at something specific and observable. if a word names a category or a conclusion without showing the specific detail, behavior, or visual element that causes it, cut it or replace it with that detail, behavior, or visual element.

bad: "the layout feels intentional" — intentional is not a description. what does intentional actually look like? describe it.
good: "every section has a job. the spacing is even. the eye knows exactly where to go next"

bad: "the website doesn't look professional" — professional is a conclusion, not an observation. what specifically makes it look unprofessional?
good: "the font is a free google font everyone uses. the hero is a stock photo. the copy says 'we help businesses grow'"

bad: "it builds trust" — trust is the result, not the cause. what specific element causes the trust or destroys it?
good: "there's no face on the page. no past work. no client name. nothing that proves anyone has ever paid for this"

banned words — never use these as standalone descriptors:
- intentional / unintentional (show what the layout does or fails to do)
- clean / polished (describe the actual elements — spacing, font, hierarchy)
- professional / unprofessional (show the specific thing that signals it)
- credible / not credible (describe what's missing or present that creates that read)
- feels / feeling (as a substitute for describing the actual observable thing)
- full / empty (as design descriptors — show what's there or what's missing)
- quality / high-quality / low-quality (show what makes it that way)
- trust (as a conclusion — show the specific thing that builds or breaks it)
- authority (show what earns it or destroys it — a photo, a number, a testimonial, a missing element)
- perceived value (show the signal — the font, the layout, the copy, the price framing)

the test: after writing a sentence, ask — can the reader picture the exact detail, behavior, or visual element i'm describing? if not, the words are doing no work. replace them with what you actually see.

${examples ? `these are reference posts from other creators in different niches. do not copy their subject matter. instead study and replicate: the hook energy, the confidence, and the pacing. apply all of that to ben's topics. the examples show you the level of directness, the kind of hooks that land hard, and when to write short vs long. important: some of these example posts use sentence-fragment lists, repeated sentence-openers, or negation constructions for rhythm - do NOT copy those specific devices, they are explicitly banned in the hard rules above regardless of what the examples do. take the confidence and directness from these examples, not their rhetorical tricks:\n\n${examples}\n` : ''}
${voiceSamples ? `these are raw examples of ben's own natural writing - real messages, comments, and notes, not curated posts. this is the most direct signal for how he actually talks: word choices, phrasing quirks, rhythm, personality. blend this into the post's voice on top of the structural/hook lessons from the reference posts above - the reference posts teach pacing and hook energy, these samples teach how ben himself sounds:\n\n${voiceSamples}\n` : ''}
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

75% of the posts (round up) should connect to websites, trust, or conversion - applicable to any business that needs a website that actually works. but do NOT write them like marketing content. start with a real moment or observation from the journal, let it unfold, and land on a point about why a bad website costs businesses clients, why design signals trust, why diy looks cheap, or whatever fits naturally from the journal. the website angle should feel like an inevitable conclusion not a pitch.

25% of the posts (round down) should be personal - observations from his day, random realizations, stories about anything. the point can be about life, mindset, work, money, whatever fits. no website angle required.

start every post with a hook. the first line needs to grab immediately - skip context, skip the thesis, skip any kind of warm up.

before you output anything, re-read each post against the hard rules above - specifically the banned sentence patterns (repeated sentence-openers, negation lists, bare noun-fragment stacks, "brain doesn't do X it does Y") and the past tense rule. rewrite any line that slipped into one of those patterns.

output exactly ${POST_COUNT} posts using these exact delimiters. nothing else before, between, or after:

${delimiterBlock}`;

const userPrompt = `journal entry - ${journal.name}:\n\n${journalContent}`;

console.log('generating posts...');
const response = await complete(systemPrompt, userPrompt, 'claude-opus-5', 16000);

// Parse posts and replies
let posts = parsePosts(response, POST_COUNT);
let replies = parseReplies(response, POST_COUNT);

if (posts.length === 0) {
  console.error('could not parse posts from response. raw output:');
  console.log(response);
  process.exit(1);
}

// Second pass: catch and fix the specific banned sentence patterns that keep
// slipping through single-shot generation (mainly negation-payoff constructions
// like "no X, no Y, just Z")
console.log('checking for banned patterns...');
const revisePrompt = `you are proofreading a batch of already-written x posts for recurring ai-tic sentence patterns.

the master pattern to catch, broader than everything else listed below: three or more short sentences or lines in a row that each describe a separate example, observation, or feature in parallel form - a list dressed up as prose. this is banned REGARDLESS of whether the wording or grammatical subject repeats. banned even when every line has a different subject and verb: "a raven stands on a parking lot. a school group plays a game. a woman on a race bike speeds past. a random dude gives me the nod." is just as banned as "they see X. they see Y. they see Z." - the tell is the parallel rhythm, not repeated words. applies equally to concrete personal observations (a list of different things noticed) and abstract business examples (a list of different website problems, or different things that happen when someone lands on a website - e.g. "the visitor's eye lands on the hero. they scroll and the next section answers the question. the button appears exactly where they reach for it. the price shows up right when they're ready." is banned even though hero/scroll/button/price are all different subjects). fix by cutting the list to at most two items, or rewriting as connected prose where each observation causes or explains the next rather than just sitting next to it.

also fix, if present:
- negation constructions (any negation word - no/not/none/nothing/never/without - any connector - just/but/instead/rather - one negated clause or more): a sentence or line sequence that lists what something ISN'T or DOESN'T have before landing on what it IS. examples: "no message. not on teams. just absent.", "no big design. no fancy layout. just a real person with real proof.", "the gap doesn't have to be big. it just has to exist.", "not because the business is bad, but because the website never gave them a reason to believe it."
- the same sentence-opening structure (same subject+verb) repeated two or more times in a row ("they see X. they see Y.")
- bare noun-fragment lists stacked line by line with no verb
- the "X doesn't do A, it does B" contrastive cliche
- throat-clearing intros like "here's the thing" or "i've been thinking about"
- the filler phrase "and that stuck with me" / "that stayed with me" or any close synonym of "this moment lodged in my memory", in any form

voice constraints to preserve while rewriting: all lowercase, zero punctuation, past tense, one thought per line with blank lines between.

your job: read every post and reply below. if a post or reply contains any of these banned patterns, rewrite ONLY the affected sentence(s) to say the same thing a different way - same meaning, same voice, just without the banned construction. leave everything else in every post completely unchanged, word for word, including posts that have no violations at all.

output the exact same number of posts using the exact same delimiters as the input, in the same order:

${delimiterBlock}`;

const reviseInput = posts
  .map((p, i) => `===post-${i + 1}===\n${p}\n===reply-${i + 1}===\n${replies[i] ?? 'none'}`)
  .join('\n');

const revised = await complete(revisePrompt, reviseInput, 'claude-opus-5', 16000);
const revisedPosts = parsePosts(revised, POST_COUNT);
const revisedReplies = parseReplies(revised, POST_COUNT);

if (revisedPosts.length === POST_COUNT) {
  posts = revisedPosts;
  replies = revisedReplies;
} else {
  console.warn('revise pass output did not parse cleanly - keeping original posts');
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

if (DRY_RUN) {
  console.log(`\n${posts.length} posts generated (dry run - not scheduled to typefully).`);
  console.log(`drafts saved to ${outputPath}`);
  process.exit(0);
}

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

// Fetch the "Needs Review" tag slug so every scheduled draft can carry it
const tagsRes = await fetch(`https://api.typefully.com/v2/social-sets/${socialSetId}/tags`, { headers: authHeaders });
if (!tagsRes.ok) {
  const err = await tagsRes.text();
  console.error(`failed to fetch typefully tags: ${err}`);
  process.exit(1);
}
const tags = await tagsRes.json() as { results: { slug: string; name: string }[] };
const needsReviewTag = tags.results.find((t) => t.name.toLowerCase() === 'needs review');
if (!needsReviewTag) {
  console.error('no "needs review" tag found in this social set - create it in typefully first');
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
        tags: [needsReviewTag.slug],
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

