import { writeText } from '../src/lib/fs.js';
import { completeViaCli } from '../src/lib/claude-cli.js';
import { loadPosts } from '../src/lib/performance/store.js';
import { median, percentileAmong, permutationPValue } from '../src/lib/performance/stats.js';
import { zonedParts } from '../src/lib/performance/time.js';
import type { PublishedPost, TweetStats } from '../src/types/performance.js';

// Views keep climbing for a few days, so younger posts would read as losers
const MIN_AGE_DAYS = 7;
const SHORT_POST_MAX_CHARS = 280;
const PERMUTATIONS = 2000;
const SIGNIFICANCE_LEVEL = 0.05;
const SAMPLE_SIZES = { website: 25, personal: 15 };

interface ScoredPost {
  post: PublishedPost;
  stats: TweetStats & { views: number };
  month: string;
  hour: number;
  // 0-100 rank against posts from the same month, since reach swings by era
  monthPercentile: number;
  externalReplies: number;
  features: Record<string, boolean>;
}

interface FeatureResult {
  name: string;
  withCount: number;
  withoutCount: number;
  withMedian: number;
  withoutMedian: number;
  pValue: number;
}

type Complete = (systemPrompt: string, userPrompt: string) => Promise<string>;

function extractFeatures(post: PublishedPost, hour: number): Record<string, boolean> {
  const { text } = post;
  return {
    website: /\bwebsites?\b/i.test(text),
    short: text.length <= SHORT_POST_MAX_CHARS,
    selfReply: post.threadReplies.length > 0,
    // Four letters minimum so acronyms like AI or CTA don't count as emphasis
    capsEmphasis: /\b[A-Z]{4,}\b/.test(text),
    axiomMode: /\baxiom\b|\bdefinition\b/i.test(text),
    morningSlot: hour < 12,
    eveningSlot: hour >= 18,
  };
}

function scorePosts(posts: PublishedPost[], now: Date): ScoredPost[] {
  const cutoff = now.getTime() - MIN_AGE_DAYS * 86400000;
  const eligible = posts.flatMap((post) => {
    const latest = post.snapshots.latest?.stats;
    if (post.isMissingOnX || !latest || latest.views === null) return [];
    if (new Date(post.publishedAt).getTime() > cutoff) return [];
    const { month, hour } = zonedParts(post.publishedAt);
    const stats = { ...latest, views: latest.views };
    // fxtwitter counts the self-reply as a reply, which isn't engagement
    const externalReplies = Math.max(0, stats.replies - Math.min(1, post.threadReplies.length));
    return [{ post, stats, month, hour, externalReplies, features: extractFeatures(post, hour) }];
  });

  const byMonth = new Map<string, typeof eligible>();
  for (const p of eligible) byMonth.set(p.month, [...(byMonth.get(p.month) ?? []), p]);

  return eligible.map((p) => {
    const peers = (byMonth.get(p.month) ?? []).map((q) => q.stats.views);
    return { ...p, monthPercentile: percentileAmong(p.stats.views, peers) };
  });
}

function testFeature(posts: ScoredPost[], name: string): FeatureResult {
  const scores = posts.map((p) => p.monthPercentile);
  const labels = posts.map((p) => p.features[name] ?? false);
  const withScores = scores.filter((_, i) => labels[i]);
  const withoutScores = scores.filter((_, i) => !labels[i]);
  return {
    name,
    withCount: withScores.length,
    withoutCount: withoutScores.length,
    withMedian: median(withScores),
    withoutMedian: median(withoutScores),
    pValue: permutationPValue(scores, labels, PERMUTATIONS),
  };
}

function featureTable(results: FeatureResult[]): string {
  const rows = results.map((r) => {
    const verdict = r.pValue < SIGNIFICANCE_LEVEL ? 'real' : 'noise';
    return `| ${r.name} | ${r.withCount} | ${r.withMedian.toFixed(0)} | ${r.withoutCount} | ${r.withoutMedian.toFixed(0)} | ${r.pValue.toFixed(3)} | ${verdict} |`;
  });
  return [
    '| feature | n with | median pct with | n without | median pct without | p | verdict |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function monthTable(posts: ScoredPost[]): string {
  const months = [...new Set(posts.map((p) => p.month))].sort();
  const rows = months.map((m) => {
    const ps = posts.filter((p) => p.month === m);
    const views = ps.map((p) => p.stats.views);
    const withReply = ps.filter((p) => p.externalReplies > 0).length;
    return `| ${m} | ${ps.length} | ${median(views)} | ${Math.max(...views)} | ${Math.round((withReply / ps.length) * 100)}% |`;
  });
  return ['| month | posts | median views | max views | posts with an outside reply |', '|---|---|---|---|---|', ...rows].join('\n');
}

function formatSample(label: string, posts: ScoredPost[]): string {
  const blocks = posts.map((p) =>
    `### ${p.month} | pct ${p.monthPercentile.toFixed(0)} | ${p.stats.views} views | ${p.stats.likes} likes | ${p.externalReplies} replies | ${p.stats.bookmarks} bookmarks\n\n${p.post.text}`
  );
  return `## ${label}\n\n${blocks.join('\n\n')}`;
}

function pickExtremes(posts: ScoredPost[], size: number): { top: ScoredPost[]; bottom: ScoredPost[] } {
  const sorted = [...posts].sort((a, b) => b.monthPercentile - a.monthPercentile);
  return { top: sorted.slice(0, size), bottom: sorted.slice(-size).reverse() };
}

function buildAnalysisPrompt(posts: ScoredPost[], features: FeatureResult[], months: string): { system: string; user: string } {
  const website = pickExtremes(posts.filter((p) => p.features.website), SAMPLE_SIZES.website);
  const personal = pickExtremes(posts.filter((p) => !p.features.website), SAMPLE_SIZES.personal);

  const system = `you analyze x post performance for ben winzer, a 20 year old who builds websites for businesses and posts daily on x to attract clients. his posts are generated from his journal by an ai pipeline and reviewed by him before publishing.

the account is small (around 630 followers, median post well under 200 views), so treat every pattern with suspicion. you get:
- per-month reach numbers
- a feature table where each post is ranked 0-100 against posts from the same month (to cancel out reach swings between eras), with a permutation test p-value per feature. p < 0.05 means the gap is unlikely to be chance
- the top and bottom performing website posts and personal posts by that monthly percentile, with full text

the website/personal split is fixed at 60/40 by ben and is not up for change. only judge what works inside each category.

your job is to answer: is there a learnable signal here, and if so what is it?

write the report in markdown with these sections:
1. verdict: one short paragraph. is there enough signal to justify building an automatic feedback loop (daily stats collection plus weekly prompt insights)? be blunt
2. what the numbers say: interpret the feature table and the month table. call anything with p >= 0.05 noise and do not build conclusions on it
3. website posts: what the top ones do that the bottom ones don't. point at concrete things in the text (the opening line, the type of moment, the length of the build-up, how the website point lands). quote short fragments as evidence
4. personal posts: same as above
5. what to change in the generation prompt: at most 5 concrete instructions, each tied to evidence above. skip this section if the evidence is too weak
6. caveats: confounds you can see (topic of the month, timing, the account changing over time)

rules: no em dashes anywhere, use colons, parentheses or periods instead. no hype. if the honest answer is that it's mostly noise, say so.`;

  const user = [
    '# reach by month',
    months,
    '# feature tests (monthly percentile, higher is better)',
    featureTable(features),
    formatSample('top website posts', website.top),
    formatSample('bottom website posts', website.bottom),
    formatSample('top personal posts', personal.top),
    formatSample('bottom personal posts', personal.bottom),
  ].join('\n\n');

  return { system, user };
}

async function analyze(posts: ScoredPost[], complete: Complete): Promise<string> {
  const features = Object.keys(posts[0]?.features ?? {}).map((name) => testFeature(posts, name));
  const months = monthTable(posts);
  const { system, user } = buildAnalysisPrompt(posts, features, months);
  const insights = await complete(system, user);

  return [
    `# post performance analysis (${new Date().toISOString().slice(0, 10)})`,
    `${posts.length} posts older than ${MIN_AGE_DAYS} days. percentiles rank each post against its own month. p-values from ${PERMUTATIONS} label shuffles.`,
    '## reach by month',
    months,
    '## feature tests',
    featureTable(features),
    '---',
    insights,
  ].join('\n\n') + '\n';
}

const posts = [...loadPosts().values()];
if (posts.length === 0) {
  console.error('no posts collected yet, run npm run collect first');
  process.exit(1);
}
const scored = scorePosts(posts, new Date());
console.log(`${scored.length} posts eligible, asking claude for the analysis...`);

const report = await analyze(scored, completeViaCli);
const outputPath = `data/performance/analysis-${new Date().toISOString().slice(0, 10)}.md`;
writeText(outputPath, report);
console.log(`report saved to ${outputPath}`);
