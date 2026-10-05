import fs from 'node:fs';
import { writeText } from '../src/lib/fs.js';
import { CHANGELOG_PATH, GUIDANCE_PATH, LEARNED_PROMPT_PATH, loadJson, loadPosts, saveJson } from '../src/lib/performance/store.js';
import { median, percentileAmong, permutationPValue, seededRandom } from '../src/lib/performance/stats.js';
import { TAG_DIMENSION_NAMES, tagValue, tagValues } from '../src/lib/performance/tags.js';
import type { Category, TagDimension } from '../src/lib/performance/tags.js';
import { zonedParts } from '../src/lib/performance/time.js';
import type { Guidance, LearnedRule, PublishedPost, RuleDirection } from '../src/types/performance.js';

const HOUR_MS = 3600000;
const SHORT_POST_MAX_CHARS = 280;
// A reply means someone stopped to engage, worth far more than a passive view
const REPLY_WEIGHT = 20;

// Rule gate. Strict on purpose: at ~80 views a post most gaps are luck, and a
// wrong rule in the prompt costs more than a missing one.
const RULE_WINDOW_POSTS = 270;
const RULE_MIN_AGE_HOURS = 7 * 24;
const RULE_MIN_GROUP = 30;
const RULE_MIN_EFFECT = 8;
const RULE_ACTIVATE_P = 0.01;
// Hysteresis: an active rule survives until it is clearly gone, so it doesn't flip daily
const RULE_KEEP_P = 0.05;
const MAX_ACTIVE_RULES = 6;
const PERMUTATIONS = 5000;

const WINNER_WINDOW_DAYS = 30;
const WINNER_MIN_AGE_HOURS = 48;
const WINNER_MIN_H48_PEERS = 20;
const WINNERS_PER_CATEGORY: Record<Category, number> = { website: 4, personal: 2 };

const SHORT_RULE_ID = 'all:length=short';
const SHORT_RULE_TEXT: Record<RuleDirection, string> = {
  avoid: 'short posts do worse than long ones on this account, build every post through several beats',
  prefer: 'short posts do better than long ones on this account, lean into them',
};
const SHORT_POSTS_WHEN_AVOIDED = { min: 0, max: 1 };

interface ScoredPost {
  post: PublishedPost;
  category: Category;
  month: string;
  monthPercentile: number;
}

interface Candidate {
  id: string;
  population: ScoredPost[];
  hasFeature: (p: ScoredPost) => boolean;
  text: (direction: RuleDirection) => string;
}

interface Evaluation {
  candidate: Candidate;
  direction: RuleDirection;
  effect: number;
  pValue: number;
  nWith: number;
  nWithout: number;
  isConsistent: boolean;
}

function ageHours(post: PublishedPost, now: number): number {
  return (now - new Date(post.publishedAt).getTime()) / HOUR_MS;
}

function categoryOf(post: PublishedPost): Category {
  return post.tags?.category ?? (/\bwebsites?\b/i.test(post.text) ? 'website' : 'personal');
}

// Views plus weighted outside replies. The self-reply under website posts is
// counted by x as a reply, so it is subtracted.
function engagementScore(stats: { views: number | null; replies: number }, post: PublishedPost): number | null {
  if (stats.views === null) return null;
  const externalReplies = Math.max(0, stats.replies - Math.min(1, post.threadReplies.length));
  return stats.views + REPLY_WEIGHT * externalReplies;
}

// Rank each post against its own month, so reach swings between eras cancel out
function scoreWithinMonth(posts: PublishedPost[], pickStats: (p: PublishedPost) => { views: number | null; replies: number } | undefined): ScoredPost[] {
  const withScores = posts.flatMap((post) => {
    const stats = pickStats(post);
    const score = stats ? engagementScore(stats, post) : null;
    return score === null ? [] : [{ post, score, month: zonedParts(post.publishedAt).month }];
  });
  const byMonth = new Map<string, number[]>();
  for (const p of withScores) byMonth.set(p.month, [...(byMonth.get(p.month) ?? []), p.score]);
  return withScores.map((p) => ({
    post: p.post,
    category: categoryOf(p.post),
    month: p.month,
    monthPercentile: percentileAmong(p.score, byMonth.get(p.month) ?? []),
  }));
}

function buildCandidates(window: ScoredPost[]): Candidate[] {
  const candidates: Candidate[] = [{
    id: SHORT_RULE_ID,
    population: window,
    hasFeature: (p) => p.post.text.length <= SHORT_POST_MAX_CHARS,
    text: (direction) => SHORT_RULE_TEXT[direction],
  }];
  const tagged = window.filter((p) => p.post.tags);
  for (const category of ['website', 'personal'] as const) {
    const population = tagged.filter((p) => p.category === category);
    for (const dimension of TAG_DIMENSION_NAMES) {
      for (const value of tagValues(dimension)) {
        const info = tagValue(dimension, value);
        if (!info || info.prefer === '') continue;
        candidates.push({
          id: `${category}:${dimension}=${value}`,
          population,
          hasFeature: (p) => p.post.tags?.[dimension as TagDimension] === value,
          text: (direction) => info[direction],
        });
      }
    }
  }
  return candidates;
}

function medianGap(group: ScoredPost[], hasFeature: (p: ScoredPost) => boolean): number {
  const withScores = group.filter(hasFeature).map((p) => p.monthPercentile);
  const withoutScores = group.filter((p) => !hasFeature(p)).map((p) => p.monthPercentile);
  if (withScores.length === 0 || withoutScores.length === 0) return 0;
  return median(withScores) - median(withoutScores);
}

function evaluate(candidate: Candidate, random: () => number): Evaluation {
  const { population, hasFeature } = candidate;
  const labels = population.map(hasFeature);
  const nWith = labels.filter(Boolean).length;
  const effect = medianGap(population, hasFeature);
  const direction: RuleDirection = effect >= 0 ? 'prefer' : 'avoid';
  const isTestable = nWith >= RULE_MIN_GROUP && population.length - nWith >= RULE_MIN_GROUP;
  const pValue = isTestable
    ? permutationPValue(population.map((p) => p.monthPercentile), labels, PERMUTATIONS, random)
    : 1;
  // A real pattern should point the same way in the older and the newer half
  const half = Math.floor(population.length / 2);
  const isConsistent = [population.slice(0, half), population.slice(half)]
    .every((part) => Math.sign(medianGap(part, hasFeature)) === Math.sign(effect) && effect !== 0);
  return { candidate, direction, effect, pValue, nWith, nWithout: population.length - nWith, isConsistent };
}

function selectRules(evaluations: Evaluation[], previous: LearnedRule[], today: string): LearnedRule[] {
  const previousById = new Map(previous.map((r) => [r.id, r]));
  const passing = evaluations.filter((e) => {
    const prior = previousById.get(e.candidate.id);
    const isLarge = Math.abs(e.effect) >= RULE_MIN_EFFECT;
    if (prior && prior.direction === e.direction) return e.pValue < RULE_KEEP_P && e.isConsistent;
    return isLarge && e.pValue < RULE_ACTIVATE_P && e.isConsistent;
  });
  return passing
    .sort((a, b) => a.pValue - b.pValue)
    .slice(0, MAX_ACTIVE_RULES)
    .map((e) => {
      const prior = previousById.get(e.candidate.id);
      return {
        id: e.candidate.id,
        direction: e.direction,
        text: e.candidate.text(e.direction),
        effect: Math.round(e.effect * 10) / 10,
        pValue: Math.round(e.pValue * 10000) / 10000,
        nWith: e.nWith,
        activeSince: prior && prior.direction === e.direction ? prior.activeSince : today,
      };
    });
}

function pickWinners(posts: PublishedPost[], now: number): ScoredPost[] {
  const recent = posts.filter((p) => {
    const age = ageHours(p, now);
    return !p.isMissingOnX && age >= WINNER_MIN_AGE_HOURS && age < WINNER_WINDOW_DAYS * 24;
  });
  const withH48 = recent.filter((p) => p.snapshots.h48);
  // Same-age comparison once enough 48h snapshots exist, otherwise fall back
  // to latest stats ranked within the month until the collector catches up
  const scored = withH48.length >= WINNER_MIN_H48_PEERS
    ? scoreWithinMonth(withH48, (p) => p.snapshots.h48?.stats)
    : scoreWithinMonth(recent, (p) => p.snapshots.latest?.stats);
  return (['website', 'personal'] as const).flatMap((category) =>
    scored
      .filter((p) => p.category === category)
      .sort((a, b) => b.monthPercentile - a.monthPercentile)
      .slice(0, WINNERS_PER_CATEGORY[category])
  );
}

function renderPrompt(rules: LearnedRule[], winners: ScoredPost[]): string {
  const sections: string[] = [];
  const ruleLines = (category: string): string[] =>
    rules.filter((r) => r.id.startsWith(`${category}:`)).map((r) => `- ${r.text}`);
  const groups = [
    { label: 'all posts', lines: ruleLines('all') },
    { label: 'website posts', lines: ruleLines('website') },
    { label: 'personal posts', lines: ruleLines('personal') },
  ].filter((g) => g.lines.length > 0);

  if (groups.length > 0) {
    sections.push(`what the data says about ben's own posts. these were learned automatically from how his past posts performed and passed a statistical test, so follow them unless a post is marked as an exploration post:\n\n${groups.map((g) => `${g.label}:\n${g.lines.join('\n')}`).join('\n\n')}`);
  }
  if (winners.length > 0) {
    const blocks = winners.map((w) => `--- ${w.category} post ---\n${w.post.text}`).join('\n\n');
    sections.push(`ben's best performing posts from the last ${WINNER_WINDOW_DAYS} days. study what they do: how the first line opens, how the moment is built, how the point lands. never reuse their moment, their topic, or their wording:\n\n${blocks}`);
  }
  return sections.join('\n\n') + (sections.length > 0 ? '\n' : '');
}

function changelogLines(previous: LearnedRule[], next: LearnedRule[], today: string): string[] {
  const key = (r: LearnedRule): string => `${r.id}/${r.direction}`;
  const before = new Set(previous.map(key));
  const after = new Set(next.map(key));
  const describe = (r: LearnedRule): string => `"${r.text}" (${r.id}, effect ${r.effect}, p ${r.pValue}, n ${r.nWith})`;
  return [
    ...next.filter((r) => !before.has(key(r))).map((r) => `- ${today}: added ${describe(r)}`),
    ...previous.filter((r) => !after.has(key(r))).map((r) => `- ${today}: removed ${describe(r)}`),
  ];
}

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const posts = [...loadPosts().values()].filter((p) => !p.isMissingOnX);
const previous = loadJson<Guidance | null>(GUIDANCE_PATH, null);

const window = scoreWithinMonth(
  posts.filter((p) => ageHours(p, now) >= RULE_MIN_AGE_HOURS),
  (p) => p.snapshots.d7?.stats ?? p.snapshots.latest?.stats,
).sort((a, b) => a.post.publishedAt.localeCompare(b.post.publishedAt)).slice(-RULE_WINDOW_POSTS);

// Seeded off the window so a rerun on unchanged data gives identical p-values
const random = seededRandom(window.length * 7919 + (window.at(-1)?.post.draftId ?? 0));
const evaluations = buildCandidates(window).map((c) => evaluate(c, random));
const rules = selectRules(evaluations, previous?.rules ?? [], today);
const shortRule = rules.find((r) => r.id === SHORT_RULE_ID && r.direction === 'avoid');
const winners = pickWinners(posts, now);

const guidance: Guidance = {
  updatedAt: new Date(now).toISOString(),
  windowPosts: window.length,
  rules,
  shortPosts: shortRule ? SHORT_POSTS_WHEN_AVOIDED : null,
  winnerDraftIds: winners.map((w) => w.post.draftId),
};
saveJson(GUIDANCE_PATH, guidance);
writeText(LEARNED_PROMPT_PATH, renderPrompt(rules, winners));

const changes = changelogLines(previous?.rules ?? [], rules, today);
if (changes.length > 0) {
  const existing = fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf8') : '# learned prompt changelog\n\n';
  writeText(CHANGELOG_PATH, existing + changes.join('\n') + '\n');
}

const closest = [...evaluations].sort((a, b) => a.pValue - b.pValue).slice(0, 8);
console.log(`window: ${window.length} posts (${window.filter((p) => p.post.tags).length} tagged)`);
console.log('closest candidates:');
for (const e of closest) {
  console.log(`  ${e.candidate.id} ${e.direction} effect ${e.effect.toFixed(1)} p ${e.pValue.toFixed(4)} n ${e.nWith}/${e.nWithout} ${e.isConsistent ? 'consistent' : 'inconsistent'}`);
}
console.log(`${rules.length} active rules, ${winners.length} winners, short posts ${guidance.shortPosts ? `${guidance.shortPosts.min}-${guidance.shortPosts.max}` : 'default'}`);
for (const line of changes) console.log(line);
