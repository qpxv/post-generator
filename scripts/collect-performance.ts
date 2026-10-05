import { loadEnv } from '../src/lib/env.js';
import { fetchDraftThread, fetchPublishedDrafts, fetchSocialSetId, tweetIdFromUrl } from '../src/lib/performance/typefully.js';
import { fetchTweet } from '../src/lib/performance/fxtwitter.js';
import { loadPosts, recordFollowers, savePosts, POSTS_PATH } from '../src/lib/performance/store.js';
import type { PostSnapshots, PublishedPost } from '../src/types/performance.js';

loadEnv();

const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;
if (!TYPEFULLY_API_KEY) {
  console.error('missing TYPEFULLY_API_KEY in .env');
  process.exit(1);
}

// fxtwitter is unofficial and unauthenticated, so stay gentle with it
const FXTWITTER_CONCURRENCY = 3;
const TYPEFULLY_CONCURRENCY = 4;
const SAVE_EVERY = 50;
const HOUR_MS = 3600000;
// The nightly run lands anywhere inside a window, and the window is wide
// enough that one missed run still catches the snapshot on the next night
const H48_WINDOW_HOURS: [number, number] = [48, 96];
const D7_WINDOW_HOURS: [number, number] = [168, 216];
// Older posts barely move, so only refresh their latest stats on --refresh-all
const LATEST_REFRESH_MAX_AGE_HOURS = 30 * 24;
const isRefreshAll = process.argv.includes('--refresh-all');

type SnapshotKey = keyof PostSnapshots;

function dueSnapshots(post: PublishedPost, now: number): SnapshotKey[] {
  if (post.isMissingOnX && !isRefreshAll) return [];
  const age = (now - new Date(post.publishedAt).getTime()) / HOUR_MS;
  const inWindow = ([from, to]: [number, number]): boolean => age >= from && age < to;
  const due: SnapshotKey[] = [];
  if (!post.snapshots.h48 && inWindow(H48_WINDOW_HOURS)) due.push('h48');
  if (!post.snapshots.d7 && inWindow(D7_WINDOW_HOURS)) due.push('d7');
  if (isRefreshAll || !post.snapshots.latest || age < LATEST_REFRESH_MAX_AGE_HOURS) due.push('latest');
  return due;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const socialSetId = await fetchSocialSetId(TYPEFULLY_API_KEY);
const drafts = await fetchPublishedDrafts(TYPEFULLY_API_KEY, socialSetId);
const posts = loadPosts();

// Text and thread never change after publishing, so fetch them once per draft
const newDrafts = drafts.filter((d) => !posts.has(d.id));
console.log(`${drafts.length} published drafts, ${newDrafts.length} new`);
await runPool(newDrafts, TYPEFULLY_CONCURRENCY, async (draft) => {
  const tweetId = tweetIdFromUrl(draft.xUrl);
  if (!tweetId) return;
  try {
    const { texts: [text = '', ...threadReplies], hasMedia } = await fetchDraftThread(TYPEFULLY_API_KEY, socialSetId, draft.id);
    posts.set(draft.id, {
      draftId: draft.id,
      tweetId,
      url: draft.xUrl,
      createdAt: draft.createdAt,
      publishedAt: draft.publishedAt,
      typefullyTags: draft.typefullyTags,
      text,
      threadReplies,
      hasMedia,
      isMissingOnX: false,
      snapshots: {},
    });
  } catch (err) {
    console.error(`draft ${draft.id}: ${errorMessage(err)}`);
  }
});
savePosts(posts);

const now = Date.now();
const work = [...posts.values()].flatMap((post) => {
  const due = dueSnapshots(post, now);
  return due.length > 0 ? [{ post, due }] : [];
});
console.log(`fetching stats for ${work.length} posts...`);

let done = 0;
let failed = 0;
const followerReadings: { followers: number; takenAt: string }[] = [];
await runPool(work, FXTWITTER_CONCURRENCY, async ({ post, due }) => {
  try {
    const lookup = await fetchTweet(post.tweetId);
    if (lookup.status === 'missing') {
      post.isMissingOnX = true;
    } else {
      const takenAt = new Date().toISOString();
      const ageHours = Math.round((Date.now() - new Date(post.publishedAt).getTime()) / HOUR_MS);
      post.isMissingOnX = false;
      for (const key of due) post.snapshots[key] = { takenAt, ageHours, stats: lookup.stats };
      followerReadings.push({ followers: lookup.followers, takenAt });
    }
  } catch (err) {
    // Snapshots stay unset so the next run retries while the window is open
    failed++;
    console.error(`tweet ${post.tweetId}: ${errorMessage(err)}`);
  }
  if (++done % SAVE_EVERY === 0) {
    savePosts(posts);
    console.log(`  ${done}/${work.length}`);
  }
});
savePosts(posts);

const followerPoint = followerReadings.sort((a, b) => a.takenAt.localeCompare(b.takenAt)).at(-1);
if (followerPoint) recordFollowers(followerPoint.followers, followerPoint.takenAt.slice(0, 10));

const snapshotCounts = (key: SnapshotKey): number => [...posts.values()].filter((p) => p.snapshots[key]).length;
console.log(`\ndone. ${posts.size} posts, ${snapshotCounts('h48')} with 48h, ${snapshotCounts('d7')} with 7d, ${failed} failed (rerun to retry)`);
if (followerPoint) console.log(`followers: ${followerPoint.followers}`);
console.log(`saved to ${POSTS_PATH}`);
