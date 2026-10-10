import fs from 'node:fs';
import path from 'node:path';
import { readText, ensureDir } from '../src/lib/fs.js';
import { complete } from '../src/lib/claude.js';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { loadEnv } from '../src/lib/env.js';
import { loadPhilosophy, rotatingWindow } from '../src/lib/philosophy.js';
import { EDIT_PROMPT_PATH, GUIDANCE_PATH, LEARNED_PROMPT_PATH, LEDGER_PATH, loadJson, saveJson } from '../src/lib/performance/store.js';
import type { Guidance, Ledger } from '../src/types/performance.js';

loadEnv();

// --cli routes both model calls through the local claude cli (subscription,
// not api credits) and --dry-run skips typefully, so a batch can be tested
// locally without spending anything or touching the queue
const isCliMode = process.argv.includes('--cli');
const isDryRun = process.argv.includes('--dry-run');
const generate = (system: string, user: string): Promise<string> =>
  isCliMode ? completeViaCli(system, user) : complete(system, user);

const JOURNAL_DIR = process.env.JOURNAL_DIR;
const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;

if (!JOURNAL_DIR) {
  console.error('missing JOURNAL_DIR in .env');
  process.exit(1);
}
if (!TYPEFULLY_API_KEY && !isDryRun) {
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

// A thin journal day can't support a full batch without the posts repeating
// each other, so the batch size follows how much actually happened.
// Each export line starts with "[dd.MM.yy, h:mm a]", so counting those
// stamps counts entries even when an entry body spans several lines.
// Tiers widen as they go up because high-count days pad with filler entries,
// so distinct postable moments grow slower than the raw entry count.
const POST_COUNT_TIERS = [
  { minEntries: 180, postCount: 12 },
  { minEntries: 100, postCount: 9 },
  { minEntries: 40, postCount: 6 },
];
const MIN_POST_COUNT = 4;
const journalEntryCount = (journalContent.match(/^\[\d{2}\.\d{2}\.\d{2}, /gm) ?? []).length;
const POST_COUNT = POST_COUNT_TIERS.find((t) => journalEntryCount >= t.minEntries)?.postCount
  ?? MIN_POST_COUNT;
console.log(`${journalEntryCount} journal entries, generating ${POST_COUNT} posts`);

// Written nightly by scripts/learn.ts from how past posts performed
const guidance = loadJson<Guidance | null>(GUIDANCE_PATH, null);
const learnedPrompt = fs.existsSync(LEARNED_PROMPT_PATH) ? readText(LEARNED_PROMPT_PATH).trim() : '';
// Written by scripts/learn-edits.ts from what ben changes in review
const editPrompt = fs.existsSync(EDIT_PROMPT_PATH) ? readText(EDIT_PROMPT_PATH).trim() : '';

// Scale the batch mix off POST_COUNT so it keeps the same ratio at any size
// (6 posts: 1-2 short, 1 axiom. 12 posts: 2-4 short, 2 axiom), unless the
// learner has proven short posts lose and capped them
const learnedShortPosts = guidance?.shortPosts ?? null;
const SHORT_POST_MIN = learnedShortPosts?.min ?? Math.max(1, Math.ceil(POST_COUNT / 6));
const SHORT_POST_MAX = learnedShortPosts?.max ?? Math.max(SHORT_POST_MIN, Math.ceil(POST_COUNT / 3));
// The last posts of each batch ignore the learned block and try angles the
// data hasn't proven yet. Without this the system only copies past winners
// and the account narrows into one style.
const EXPLORE_POST_COUNT = learnedPrompt ? (POST_COUNT >= 9 ? 2 : 1) : 0;
const exploreIndexes = Array.from({ length: EXPLORE_POST_COUNT }, (_, i) => POST_COUNT - EXPLORE_POST_COUNT + i);
const AXIOM_POST_COUNT = Math.max(1, Math.round(POST_COUNT / 6));
const WEBSITE_POST_SHARE = 0.6;
const WEBSITE_POST_COUNT = Math.round(POST_COUNT * WEBSITE_POST_SHARE);
const PERSONAL_POST_COUNT = POST_COUNT - WEBSITE_POST_COUNT;

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

// Load ben's axioms and definitions - his own worldview, used to ground posts in real logic
const axiomsPath = 'axioms.md';
const axioms = fs.existsSync(axiomsPath) ? readText(axiomsPath) : '';

const definitionsPath = 'definitions.md';
const definitions = fs.existsSync(definitionsPath) ? readText(definitionsPath) : '';

// Rotate which axiom and which definitions get featured each day. Without this,
// the model has no memory of prior batches and keeps reaching for the same
// "obvious" picks (axiom 2/3, definition of trust/discipline) every single run.
// Seeding the pick off the calendar date makes the featured axiom/definitions
// deterministic per day (safe to re-run the same day) but different day to day,
// so coverage rotates through the full list instead of collapsing onto a few.
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
  return Math.floor(diff / 86400000);
}

const seed = dayOfYear(new Date());

// axioms.md entries are separated by blank lines, each starting "axiom N (name)"
const axiomBlocks = axioms
  .split(/\n\s*\n/)
  .map((b) => b.trim())
  .filter((b) => /^axiom \d+/i.test(b));

// One featured axiom per axiom-mode post, so a second axiom post doesn't fall back to a familiar one
const featuredAxioms = Array.from(
  { length: Math.min(AXIOM_POST_COUNT, axiomBlocks.length) },
  (_, i) => axiomBlocks[(seed + i) % axiomBlocks.length],
);

// definitions.md is one "term: meaning" per line
const definitionLines = definitions
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const DEFINITIONS_WINDOW = 6;
const featuredDefinitions = definitionLines.length > 0
  ? Array.from(
    { length: Math.min(DEFINITIONS_WINDOW, definitionLines.length) },
    (_, i) => definitionLines[(seed + i) % definitionLines.length],
  )
  : [];

// Distilled from creators ben learns from (npm run distill). Website posts land
// their point on one of these instead of a lesson the model makes up, and a
// rotating subset keeps the batch from reaching for the same principle nightly
const philosophy = loadPhilosophy();
const hasPhilosophy = philosophy.principles.length > 0;
const featuredPrinciples = rotatingWindow(philosophy.principles, seed, WEBSITE_POST_COUNT + 2);
const featuredObjections = rotatingWindow(philosophy.objections, seed, Math.ceil(WEBSITE_POST_COUNT / 2));
const featuredTactics = rotatingWindow(philosophy.tactics, seed, 6);

// How value posts are built, studied from a creator's posts (npm run
// study-format). Kept out of data/examples on purpose: everything there is fed
// to every post, and personal posts must not pick up this format.
const VALUE_FORMAT_PATH = 'data/formats/value-posts.md';
const valueFormat = fs.existsSync(VALUE_FORMAT_PATH) ? readText(VALUE_FORMAT_PATH).trim() : '';
const hasValueFormat = valueFormat !== '';

const philosophyBlock = hasPhilosophy ? `where the website point comes from:

ben has studied web design and how buyers judge websites in depth, and below is the body of principles he holds. ${hasValueFormat
    ? "every website post teaches exactly one of today's featured principles, client beliefs or tactics below, in depth, developed with that item's reasoning. pick the one today's journal gives you the best way into. use a different one for each website post."
    : "every website post must land its point on exactly one of today's featured principles or client beliefs below, and develop it with that item's reasoning. the journal moment still opens the post and carries it. the principle is what the moment turns into, so pick the one the moment genuinely leads to. use a different one for each website post."}

faithfulness rules, never break these:
- state the idea as ben's own conviction in his voice. never name or mention where it came from
- the examples, stories, clients and projects below belong to someone else. never retell them as something ben did or saw. ben's only first-hand material is the journal
- never use any number, statistic, percentage or study from this section. they are secondhand and unchecked. numbers may only come from the journal
- never copy a quoted phrasing word for word. say it the way ben would

how buyers judge a website (background, always true):
${philosophy.buyerJudgment.map((b) => `- ${b}`).join('\n')}

today's featured principles:

${featuredPrinciples.map((p) => p.text).join('\n\n')}

${featuredObjections.length > 0 ? `today's featured client beliefs and objections (a post can open its turn on what a buyer believes, then take it apart):\n\n${featuredObjections.map((o) => `- ${o.text}`).join('\n')}\n\n` : ''}${featuredTactics.length > 0 ? `concrete details a website point can name (a post may use one to make its point specific):\n${featuredTactics.map((t) => `- ${t}`).join('\n')}\n\n` : ''}for every post, after the reply, output what it is built on: the principle or client belief's bold title copied exactly as it appears above, or for a tactic "tactic: " plus its first six words. output "none" for personal posts.
` : '';

const valueFormatBlock = hasValueFormat ? `website posts are value posts:

every website post is a value post that teaches something a business owner can use, the kind of post people save and come back to. build each one on a skeleton from the format guide below and develop every point the way the guide describes: claim, mechanism, consequence, concrete example. vary the skeleton and hook type across the batch. value posts are always long.

a value post may open on a moment from the journal when that moment leads straight into the lesson, because first-hand detail is what makes ben credible. when the journal has nothing that fits, open on a claim or on what a buyer believes instead. never force a journal moment in.

format exceptions for value posts only (these override the hard rules above, for value posts and nothing else):
- numbered points (1) or #1 - ITEM or STEP 1), hyphen lists, and section labels in CAPS are allowed. a colon is allowed directly after a CAPS section label and nowhere else
- a real list is allowed, so the master rule against lists dressed up as prose does not apply to it. the explanation under each point is still connected prose
- inside every sentence, every other rule still holds: all lowercase outside CAPS labels and emphasis, no other punctuation, no em dashes, no negation payoffs, no repeated sentence openers, word precision, past tense for anything that happened (present tense for how things work), and the faithfulness rules
- short open-loop lines before a payoff ("here's why", "let me explain", "for example") are allowed inside the post, never as the opening line
- the guide shows numbers in hooks. ben's numbers may only come from the journal. a hook without a real number uses a different hook type
- no sign-off with a name and no dm or keyword call to action in the post. the reply carries the invitation
- where the guide and ben's review edits below disagree, his edits win. that means ending on the last concrete beat instead of a closer that restates the lesson

the format guide (studied from another creator's posts, so take only the construction, never his topics or his wording):

${valueFormat}
` : '';

// Build delimiter list dynamically based on POST_COUNT
const delimiterBlock = Array.from(
  { length: POST_COUNT },
  (_, i) => `===post-${i + 1}===\n{post}\n===reply-${i + 1}===\n{reply or "none"}${hasPhilosophy ? `\n===source-${i + 1}===\n{principle title or "none"}` : ''}`
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
- the master rule, broader than every specific example below: never write three or more short sentences or lines in a row that each describe a separate example, observation, or feature in parallel form - a list dressed up as prose. this is banned REGARDLESS of whether the wording or grammatical subject repeats. it applies just as much when every line uses a different subject and verb as when they're identical - "a raven stands on a parking lot. a school group plays a game. a woman on a race bike speeds past. a random dude gives me the nod." is banned even though no two lines share a subject or verb, for the exact same reason "they see X. they see Y. they see Z." is banned. it applies to concrete personal observations (a list of different things you noticed on the way to work) exactly as much as abstract business examples (a list of different website problems, or different things that happen "when someone lands on your website" - "the visitor's eye lands on the hero. they scroll and the next section answers the question. the button appears exactly where they reach for it. the price shows up right when they're ready." is banned too, even though hero/scroll/button/price are all different subjects). if you catch yourself about to write a third parallel short line describing "another thing" - another thing noticed, another website flaw, another element that works - stop and rewrite the whole passage as connected prose where each observation causes, explains, or builds on the next, not just sits next to it. do NOT fix this by deleting content down to one or two items - that makes the post shorter and thinner, which is not the goal. keep all the detail and all the examples, just connect them with reasoning instead of listing them. a post can and should still be long after this fix, just not listy
- never repeat the same sentence-opening structure (same subject + same verb, e.g. "they see...", "they knew...", "it expects...") two or more times in a row to fake rhythm - two is already enough to be a violation, not just three-plus, and this applies no matter which subject/verb pair it is, not just the ones listed as examples. this includes enumerated lists like "one X. one Y." or "they want X. they want Y." or "if X. if Y." or "they see X. they see Y." just as much as "it picks up on whether... it picks up on whether...". this is a mechanical ai tic, not how people write. banned examples: "it picks up on whether... it picks up on whether...", "it happens when... it happens when...", "you don't know... you don't know...", "then they... then they...", "one photo of a real result. one name attached to a real outcome.", "they want to understand what you do. they want to know it's real.", "if the copyright says 2021. if the testimonials have no names.", "they knew what the business does. they knew why it's good. they knew who it's for.", "they see a layout where the eye has nowhere to go. they see a photo that looks stock. they see a wall of text.". if a thought needs a list, either collapse it into one direct sentence or vary the structure of each line so it doesn't read as a template being repeated
- never use negation constructions - this applies no matter which negation word is used (no, not, none, nothing, never, without, etc), no matter which connector introduces the payoff (just, but, instead, rather), and no matter how many items are in the run, including just ONE negated clause followed by a payoff clause. "not dramatically, just a small hesitation" is banned. "none of the unnecessary resistance, just the thing doing what it's supposed to do" is banned. "not because the business is bad, but because the website never gave them a reason to believe it" is banned - "but" works exactly like "just" here, same shape. swapping "no"/"not" for a synonym like "none" or "nothing" does not get around this rule - it is the sentence shape that's banned, not the specific word. banned examples: "no friction, no confusion about what comes next", "no warmth, no prior trust", "no hesitation, no weird braking for no reason, just clean expected movement", "there is no face on the page. no past work shown anywhere. no client name. not a single thing that proves a real human being has ever paid for this.", "not dramatically. just a small hesitation.", "none of the unnecessary resistance. just the thing doing what it's supposed to do." - especially watch for this trap when writing about what's MISSING from a bad website (no proof, no face, no past work, etc) - describe the absence as one direct observation, not a checklist or a "not X, just Y" contrast
- never write two or more bare noun-phrase fragments with no verb back to back, one per line, used as a pseudo-poetic device - two fragments in a row is already a violation. banned examples: "the offer. the pricing. the guarantee.", "a case study with a 47 page breakdown. a testimonial video with cinematic b-roll. a completely redesigned brand identity.", "three seconds of actual attention. disproportionate results." write real sentences instead of fragment lists
- never use the "X doesn't do A, it does B" contrastive framing or close variants (e.g. "that's not what X is, that's what Y is", "it doesn't ask for attention, it takes it") - it's a cliche tell no matter what the subject is, not just when the subject is literally "the brain"
- if the journal mentions driving, braking, or hesitation specifically: this content keeps pulling toward "no braking, no hesitation, just clean movement" style phrasing - that exact family of phrasing is banned here above all else. describe the driving moment some other way entirely (what it looked like, what was said, how it felt) rather than reaching for a list of what didn't happen
- banned filler phrases (in addition to the ones already listed): "and that stuck with me" / "that stayed with me" / any close synonym of this same "this moment lodged in my memory" filler, in any form, "i just stood there"
- keep verbs consistently in past tense throughout each post - don't drift into present tense mid-post
- do not expose private personal details that should not be public
- never name coworkers, friends or anyone else from the journal. refer to them by role instead (a coworker, a friend, my brother, a client). the journal uses real first names, never carry them into a post
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

ben's worldview - axioms and definitions:

over the past few days ben has been building his own set of axioms (rules he considers true in every case, no exceptions) and precise definitions for the words he uses most. this is a real part of how he thinks right now, and it should show up in the posts - not as philosophy for its own sake, but as the actual logic underneath the business point.

${axioms ? `ben's axioms:\n\n${axioms}\n` : ''}
${definitions ? `ben's definitions - use these exact meanings whenever a post touches one of these words, instead of the vague everyday meaning:\n\n${definitions}\n` : ''}
how to use this:
- when a post's point rests on a concept like trust, standard, respect, certainty, judgment, or another word defined above, reach for the precise definition instead of the vague conventional one. let the definition do the work of proving the point, not just decorate it
- aim for about ${AXIOM_POST_COUNT} of the ${POST_COUNT} posts per batch to run fully in axiom mode: state a definition, name the axiom, walk the logical chain (a person has X, a stranger has no access to X until Y, therefore Z), and land on a conclusion that has to be true, not one that just sounds good. the rest of the posts should stay in ben's normal observational, journal-rooted voice - do not force this structure onto every post
- an axiom-mode post does NOT need to land on websites, trust, conversion, or any business point - ben genuinely geeks out on this stuff as philosophy in its own right, so let the logical chain conclude wherever it actually leads (about emotion, judgment, identity, behavior, other people, whatever the axiom is actually about). only bend it toward the website/business angle if the journal entry makes that connection natural - never force it. count an axiom-mode post as one of the personal posts for the website/personal split when it doesn't land on a business point, so it doesn't eat into the website-post quota
- an axiom-mode post can close with a falsifiability challenge - daring the reader to find the one exception, then pointing out there isn't one. use this closer sparingly, it loses power if every post ends this way
${featuredAxioms.length > 0 ? `- this batch has been running the same one or two axioms and definitions over and over (mostly asymmetric access, and trust/discipline), and that repetition is a real problem - it makes the account look like it only has one idea. today's axiom-mode posts MUST each build their logical chain around one of these specific axioms instead of defaulting back to a familiar one. use a different one for each axiom-mode post, never the same axiom twice in a batch:\n\n${featuredAxioms.join('\n\n')}\n\ndo not swap in a different axiom today unless the journal makes these genuinely impossible to connect to - reach for the connection before giving up on it` : ''}
${featuredDefinitions.length > 0 ? `- likewise, spread the definitions out. when a post needs a precise definition today, pull from this rotating set before defaulting to trust or discipline again:\n\n${featuredDefinitions.map((d) => `- ${d}`).join('\n')}\n\nonly reach outside this set (or back to trust/discipline) if the journal entry genuinely doesn't connect to any of them - don't force a fit, but don't default back to the same two words out of habit either` : ''}
- when a post runs in axiom mode, colons are allowed directly after the words "axiom" or "definition" to label what follows (e.g. "definition of standard:", "axiom 3, asymmetric access:"), and quotation marks are allowed around a claim being tested (e.g. "trusted by thousands"). every other punctuation rule above still applies inside these posts - no periods, no commas, no question marks, no other colons

${philosophyBlock}
${valueFormatBlock}
${examples ? `these are reference posts from other creators in different niches. do not copy their subject matter. instead study and replicate: the hook energy, the confidence, and the pacing. apply all of that to ben's topics. the examples show you the level of directness, the kind of hooks that land hard, and when to write short vs long. important: some of these example posts use sentence-fragment lists, repeated sentence-openers, or negation constructions for rhythm - do NOT copy those specific devices, they are explicitly banned in the hard rules above regardless of what the examples do. take the confidence and directness from these examples, not their rhetorical tricks:\n\n${examples}\n` : ''}
${voiceSamples ? `these are raw examples of ben's own natural writing - real messages, comments, and notes, not curated posts. this is the most direct signal for how he actually talks: word choices, phrasing quirks, rhythm, personality. blend this into the post's voice on top of the structural/hook lessons from the reference posts above - the reference posts teach pacing and hook energy, these samples teach how ben himself sounds:\n\n${voiceSamples}\n` : ''}
${learnedPrompt ? `${hasValueFormat ? 'the best performing posts below were written before website posts switched to the value format. take their hook energy and voice from them, never their story-then-lesson shape for a website post.\n\n' : ''}${learnedPrompt}\n\n${exploreIndexes.length > 0 ? `exploration: ${exploreIndexes.map((i) => `post ${i + 1}`).join(' and ')} ${exploreIndexes.length > 1 ? 'are exploration posts' : 'is an exploration post'}. for ${exploreIndexes.length > 1 ? 'these' : 'this one'}, ignore the learned rules and the best-post examples above and try a hook style and a kind of moment they do not recommend. every other rule in this prompt still applies.\n\n` : ''}` : ''}${editPrompt ? `${editPrompt}\n\n` : ''}replies: every website-focused post (the ${WEBSITE_POST_COUNT}) must have a reply. personal posts (the ${PERSONAL_POST_COUNT}) must output "none" for the reply.

the reply is a second tweet that threads directly under the main post. rules:
- max 2 lines
- all lowercase, zero punctuation - same voice rules as the main post
- it should feel like a natural follow-through from the post, not a pitch
- it must reference the specific angle of the post - never generic
- it is an invitation to reach out, not a sales message
- never start with "if you want" or "click here" or "book a call"
- never sound like a marketer wrote it

${replyExamples ? `these are example replies to use as reference for energy and length. study the tone - direct, short, personal, never salesy:\n\n${replyExamples}\n` : ''}
post length: mix short and long posts. for every ${POST_COUNT} posts, write at least ${SHORT_POST_MIN} and at most ${SHORT_POST_MAX} as short posts. a short post is a maximum of 280 characters total including all spaces and line breaks - count carefully and do not exceed this. short posts should hit harder than long ones because they have no room to build. every word has to earn its place. the rest of the posts must be long - this is not optional. a long post builds through several beats: the moment from the journal, what it actually looked or felt like with real detail, the turn into the website/business point, and then that point developed with a specific example or two, not just stated once and dropped. aim for something in the range of 10-18 short lines, not 5-6. if a long post feels like it wrapped up after one paragraph, it's too short - go back and develop the idea further, add the next layer of the thought, don't just restate the hook.${hasValueFormat ? ' those beats describe a long personal post. website posts are value posts, always long, and built the way the format guide describes, so the short posts all come from the personal share.' : ''}

hooks: every post must open with a hook that makes someone stop scrolling. no slow builds. no context-setting. the first line is everything. look at how the example posts open and match that energy. specific > vague. concrete > abstract. story > statement when possible.

your job: read the journal and write exactly ${POST_COUNT} posts with this split:

${hasValueFormat
  ? `${WEBSITE_POST_COUNT} of the ${POST_COUNT} posts are value posts about websites, trust, or conversion, for any business that needs a website that actually works. each teaches one featured item in depth on a skeleton from the format guide, written for a business owner deciding whether their website is costing them customers. never marketing copy and never a pitch: the value is the teaching itself.`
  : `${WEBSITE_POST_COUNT} of the ${POST_COUNT} posts should connect to websites, trust, or conversion - applicable to any business that needs a website that actually works. but do NOT write them like marketing content. start with a real moment or observation from the journal, let it unfold, and land on a point about why a bad website costs businesses clients, why design signals trust, why diy looks cheap, or whatever fits naturally from the journal. the website angle should feel like an inevitable conclusion not a pitch.`}

${PERSONAL_POST_COUNT} of the ${POST_COUNT} posts should be personal - observations from his day, random realizations, stories about anything. the point can be about life, mindset, work, money, whatever fits. no website angle required.

start every post with a hook. the first line needs to grab immediately - skip context, skip the thesis, skip any kind of warm up.

before you output anything, re-read each post against the hard rules above - specifically the banned sentence patterns (repeated sentence-openers, negation lists, bare noun-fragment stacks, "brain doesn't do X it does Y") and the past tense rule. rewrite any line that slipped into one of those patterns.

output exactly ${POST_COUNT} posts using these exact delimiters. nothing else before, between, or after:

${delimiterBlock}`;

const userPrompt = `journal entry - ${journal.name}:\n\n${journalContent}`;

console.log('generating posts...');
const response = await generate(systemPrompt, userPrompt);

// Parse posts, replies and the principle each post landed on
let posts = parsePosts(response, POST_COUNT);
let replies = parseReplies(response, POST_COUNT);
let sources = parseSources(response, POST_COUNT);

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

the master pattern to catch, broader than everything else listed below: three or more short sentences or lines in a row that each describe a separate example, observation, or feature in parallel form - a list dressed up as prose. this is banned REGARDLESS of whether the wording or grammatical subject repeats. banned even when every line has a different subject and verb: "a raven stands on a parking lot. a school group plays a game. a woman on a race bike speeds past. a random dude gives me the nod." is just as banned as "they see X. they see Y. they see Z." - the tell is the parallel rhythm, not repeated words. applies equally to concrete personal observations (a list of different things noticed) and abstract business examples (a list of different website problems, or different things that happen when someone lands on a website - e.g. "the visitor's eye lands on the hero. they scroll and the next section answers the question. the button appears exactly where they reach for it. the price shows up right when they're ready." is banned even though hero/scroll/button/price are all different subjects). fix by rewriting as connected prose where each observation causes or explains the next rather than just sitting next to it - keep all the content and all the examples, do not shorten the post by deleting items down to one or two.

also fix, if present:
- negation constructions (any negation word - no/not/none/nothing/never/without - any connector - just/but/instead/rather - one negated clause or more): a sentence or line sequence that lists what something ISN'T or DOESN'T have before landing on what it IS. examples: "no message. not on teams. just absent.", "no big design. no fancy layout. just a real person with real proof.", "the gap doesn't have to be big. it just has to exist.", "not because the business is bad, but because the website never gave them a reason to believe it."
- the same sentence-opening structure (same subject+verb) repeated two or more times in a row ("they see X. they see Y.")
- bare noun-fragment lists stacked line by line with no verb
- the "X doesn't do A, it does B" contrastive cliche
- throat-clearing intros like "here's the thing" or "i've been thinking about"
- the filler phrase "and that stuck with me" / "that stayed with me" or any close synonym of "this moment lodged in my memory", in any form
- a real person's name (a coworker, a friend, anyone from ben's day). replace it with their role (a coworker, a friend, a client) and keep the rest of the sentence
- any number, statistic, percentage or study stated as fact that is not a plain detail from ben's own day (a price he paid, a count he saw). rewrite the sentence to make the same point without the figure

if a post runs in axiom mode (it states a definition or names an axiom and builds a logical chain toward a conclusion): check that every "therefore" or conclusion actually follows necessarily from the stated definition/axiom, not just that it sounds like it does. if a step is really just an assertion dressed up as a deduction, rewrite that step so the logic actually holds - don't delete the axiom/definition structure to fix it. the colons after the words "axiom" and "definition", and quotation marks around a claim being tested, are allowed in these posts and should not be stripped as punctuation violations.

voice constraints to preserve while rewriting: all lowercase, zero punctuation (except the axiom-mode exceptions above), past tense, one thought per line with blank lines between.

${hasValueFormat ? 'value posts: a post whose source line is not "none" is a value post. its numbered points, hyphen lists, CAPS section labels and the colon right after a CAPS label are its intended structure. never turn them back into prose and never strip that colon. still fix the banned patterns inside its sentences.\n\n' : ''}your job: read every post and reply below.${hasPhilosophy ? ' copy every source line through exactly as it is, never edit it.' : ''} if a post or reply contains any of these banned patterns, rewrite ONLY the affected sentence(s) to say the same thing a different way - same meaning, same voice, just without the banned construction. leave everything else in every post completely unchanged, word for word, including posts that have no violations at all.

output the exact same number of posts using the exact same delimiters as the input, in the same order:

${delimiterBlock}`;

const reviseInput = posts
  .map((p, i) => `===post-${i + 1}===\n${p}\n===reply-${i + 1}===\n${replies[i] ?? 'none'}${hasPhilosophy ? `\n===source-${i + 1}===\n${sources[i] ?? 'none'}` : ''}`)
  .join('\n');

const revised = await generate(revisePrompt, reviseInput);
const revisedPosts = parsePosts(revised, POST_COUNT);
const revisedReplies = parseReplies(revised, POST_COUNT);
const revisedSources = parseSources(revised, POST_COUNT);

if (revisedPosts.length === POST_COUNT) {
  posts = revisedPosts;
  replies = revisedReplies;
  // The revise pass only copies sources through, so a dropped line keeps the original
  sources = revisedSources.map((src, i) => src ?? sources[i] ?? null);
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
    const exploreLabel = exploreIndexes.includes(i) ? ' (explore)' : '';
    const source = sources[i];
    const sourceLine = source ? `\n\n**principle:** ${source}` : '';
    return `## post ${i + 1}${exploreLabel}\n\n${p}${replyLine}${sourceLine}`;
  })
  .join('\n\n---\n\n');
fs.writeFileSync(outputPath, outputContent, 'utf8');

if (isDryRun) {
  console.log(`\n${posts.length} posts generated (dry run, nothing scheduled). drafts saved to ${outputPath}`);
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
const ledger = loadJson<Ledger>(LEDGER_PATH, {});

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

    // The draft id links this post to its stats once it publishes, which is
    // how exploration posts get measured against the rest
    const created = await res.json() as { id?: number };
    if (created.id !== undefined) {
      ledger[String(created.id)] = {
        generatedAt: new Date().toISOString(),
        isExplore: exploreIndexes.includes(i),
        originalText: post,
        originalReply: reply ?? null,
        philosophySource: sources[i] ?? null,
      };
    }
    console.log(`post ${i + 1}: added to queue`);
    scheduled++;
  } catch (err) {
    console.error(`post ${i + 1}: error -`, err);
  }
}

saveJson(LEDGER_PATH, ledger);
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

// The text after `marker` up to whichever of `endMarkers` comes first, or null
// for a missing section or a literal "none"
function parseSection(text: string, marker: string, endMarkers: string[]): string | null {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const contentStart = start + marker.length;
  const ends = endMarkers.map((m) => text.indexOf(m, contentStart)).filter((e) => e !== -1);
  const val = text.slice(contentStart, ends.length > 0 ? Math.min(...ends) : text.length).trim();
  return val === 'none' || val === '' ? null : val;
}

function parseReplies(text: string, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) =>
    parseSection(text, `===reply-${i + 1}===`, [`===source-${i + 1}===`, `===post-${i + 2}===`]));
}

function parseSources(text: string, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) =>
    parseSection(text, `===source-${i + 1}===`, [`===post-${i + 2}===`]));
}

