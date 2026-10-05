import fs from 'node:fs';
import { readText, writeText } from '../src/lib/fs.js';
import { loadEnv } from '../src/lib/env.js';
import type { BackfillFile, PublishedPost, StatsLookup, TweetStats } from '../src/types/performance.js';

loadEnv();

const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;
if (!TYPEFULLY_API_KEY) {
  console.error('missing TYPEFULLY_API_KEY in .env');
  process.exit(1);
}

const BACKFILL_PATH = 'data/performance/backfill.json';
const TYPEFULLY_BASE = 'https://api.typefully.com/v2';
const TYPEFULLY_PAGE_SIZE = 50;
// fxtwitter is unofficial and unauthenticated, so stay gentle with it
const FXTWITTER_CONCURRENCY = 3;
const TYPEFULLY_CONCURRENCY = 4;
const SAVE_EVERY = 50;
// Pass --refresh to re-fetch stats for posts that already have them
const shouldRefreshStats = process.argv.includes('--refresh');

const authHeaders = { Authorization: `Bearer ${TYPEFULLY_API_KEY}` };

interface DraftListItem {
  id: number;
  status: string;
  created_at: string;
  published_at: string | null;
  tags: string[];
  x_published_url: string | null;
}

interface DraftDetail {
  platforms: { x?: { posts: { text: string }[] } };
}

interface FxTweet {
  views: number | null;
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json() as T;
}

async function fetchSocialSetId(): Promise<number> {
  const sets = await getJson<{ results: { id: number }[] }>(`${TYPEFULLY_BASE}/social-sets`, authHeaders);
  const id = sets.results[0]?.id;
  if (id === undefined) throw new Error('no social set found in typefully');
  return id;
}

async function fetchPublishedDrafts(socialSetId: number): Promise<DraftListItem[]> {
  const drafts: DraftListItem[] = [];
  let url: string | null = `${TYPEFULLY_BASE}/social-sets/${socialSetId}/drafts?status=published&limit=${TYPEFULLY_PAGE_SIZE}`;
  while (url) {
    const page: { results: DraftListItem[]; next: string | null } = await getJson(url, authHeaders);
    drafts.push(...page.results);
    url = page.next;
  }
  return drafts;
}

function tweetIdFromUrl(url: string): string | null {
  return url.match(/\/status\/(\d+)/)?.[1] ?? null;
}

async function fetchThread(socialSetId: number, draftId: number): Promise<string[]> {
  const detail = await getJson<DraftDetail>(`${TYPEFULLY_BASE}/social-sets/${socialSetId}/drafts/${draftId}`, authHeaders);
  return detail.platforms.x?.posts.map((p) => p.text) ?? [];
}

async function fetchStats(tweetId: string): Promise<StatsLookup> {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`);
  // A deleted or protected tweet comes back as an html page, not json
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  if (res.status === 404 || !isJson) return { status: 'missing', fetchedAt };
  if (!res.ok) throw new Error(`fxtwitter ${tweetId} failed with ${res.status}`);

  const body = await res.json() as { tweet?: FxTweet };
  if (!body.tweet) return { status: 'missing', fetchedAt };
  const { views, likes, replies, retweets, quotes, bookmarks } = body.tweet;
  const stats: TweetStats = { views, likes, replies, retweets, quotes, bookmarks };
  return { status: 'ok', stats, fetchedAt };
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

function loadExisting(): Map<number, PublishedPost> {
  if (!fs.existsSync(BACKFILL_PATH)) return new Map();
  const file = JSON.parse(readText(BACKFILL_PATH)) as BackfillFile;
  return new Map(file.posts.map((p) => [p.draftId, p]));
}

function save(posts: Map<number, PublishedPost>): void {
  const sorted = [...posts.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const file: BackfillFile = { updatedAt: new Date().toISOString(), posts: sorted };
  writeText(BACKFILL_PATH, JSON.stringify(file, null, 2) + '\n');
}

const socialSetId = await fetchSocialSetId();
console.log('listing published drafts...');
const drafts = await fetchPublishedDrafts(socialSetId);
console.log(`${drafts.length} published drafts in typefully`);

const posts = loadExisting();

// Typefully text and thread never change after publishing, so fetch them once
const newDrafts = drafts.filter((d) => !posts.has(d.id));
console.log(`fetching text for ${newDrafts.length} new drafts...`);
let skippedWithoutTweet = 0;
await runPool(newDrafts, TYPEFULLY_CONCURRENCY, async (draft) => {
  const tweetId = draft.x_published_url ? tweetIdFromUrl(draft.x_published_url) : null;
  if (!draft.x_published_url || !tweetId || !draft.published_at) {
    skippedWithoutTweet++;
    return;
  }
  try {
    const [text = '', ...threadReplies] = await fetchThread(socialSetId, draft.id);
    posts.set(draft.id, {
      draftId: draft.id,
      tweetId,
      url: draft.x_published_url,
      createdAt: draft.created_at,
      publishedAt: draft.published_at,
      tags: draft.tags,
      text,
      threadReplies,
      lookup: null,
    });
  } catch (err) {
    console.error(`draft ${draft.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
});
save(posts);
if (skippedWithoutTweet > 0) console.log(`${skippedWithoutTweet} drafts skipped (no x url)`);

const needsStats = [...posts.values()].filter((p) => shouldRefreshStats || p.lookup === null);
console.log(`fetching stats for ${needsStats.length} posts from fxtwitter...`);
let done = 0;
let failed = 0;
await runPool(needsStats, FXTWITTER_CONCURRENCY, async (post) => {
  try {
    post.lookup = await fetchStats(post.tweetId);
  } catch (err) {
    // Leave lookup as it was so the next run retries this post
    failed++;
    console.error(`tweet ${post.tweetId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  done++;
  if (done % SAVE_EVERY === 0) {
    save(posts);
    console.log(`  ${done}/${needsStats.length}`);
  }
});
save(posts);

const all = [...posts.values()];
const okCount = all.filter((p) => p.lookup?.status === 'ok').length;
const missingCount = all.filter((p) => p.lookup?.status === 'missing').length;
console.log(`\ndone. ${okCount} with stats, ${missingCount} missing on x, ${failed} failed (rerun to retry)`);
console.log(`saved to ${BACKFILL_PATH}`);
