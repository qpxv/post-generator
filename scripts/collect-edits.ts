import { execFileSync } from 'node:child_process';
import { loadEnv } from '../src/lib/env.js';
import { containment, diceSimilarity, reviewOutcome } from '../src/lib/performance/edits.js';
import { fetchDraftExists, fetchSocialSetId } from '../src/lib/performance/typefully.js';
import { EDITS_PATH, LEDGER_PATH, loadJson, loadPosts, saveJson } from '../src/lib/performance/store.js';
import type { EditPair, EditsFile, Ledger, PublishedPost } from '../src/types/performance.js';

loadEnv();

// --history recovers pairs from the draft files that used to be committed to
// output/drafts. One-off and local only: ci checks out without history.
const isHistoryMode = process.argv.includes('--history');
const TYPEFULLY_CONCURRENCY = 4;
// Below this overlap an old draft and a published post are different posts.
// Containment alone lets a 6-word post match any long draft sharing two word
// pairs, so the overall similarity has to clear a floor too.
const HISTORY_MATCH_MIN = 0.4;
const HISTORY_DICE_MIN = 0.25;
const DRAFT_DIR = 'output/drafts';

interface DraftPost {
  date: string;
  text: string;
  reply: string | null;
}

function pairFromPost(draftId: number, source: EditPair['source'], original: string, originalReply: string | null, post: PublishedPost): EditPair {
  const publishedReply = post.threadReplies[0] ?? null;
  return {
    draftId,
    source,
    outcome: reviewOutcome(original, originalReply, post.text, publishedReply),
    original,
    originalReply,
    published: post.text,
    publishedReply,
    similarity: Number(diceSimilarity(original, post.text).toFixed(3)),
    decidedAt: post.publishedAt,
  };
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) await worker(items[next++]);
  }));
}

async function addLedgerPairs(edits: EditsFile, posts: Map<number, PublishedPost>): Promise<void> {
  const ledger = loadJson<Ledger>(LEDGER_PATH, {});
  const pending: [string, Ledger[string]][] = [];
  for (const [id, entry] of Object.entries(ledger)) {
    if (edits[id]) continue;
    const post = posts.get(Number(id));
    if (post) edits[id] = pairFromPost(Number(id), 'ledger', entry.originalText, entry.originalReply, post);
    else pending.push([id, entry]);
  }
  console.log(`${Object.keys(ledger).length} ledger drafts, ${pending.length} still in review or queued`);

  const apiKey = process.env.TYPEFULLY_API_KEY;
  if (pending.length === 0) return;
  if (!apiKey) {
    console.warn('no TYPEFULLY_API_KEY, skipping the deleted-draft check');
    return;
  }
  const socialSetId = await fetchSocialSetId(apiKey);
  await runPool(pending, TYPEFULLY_CONCURRENCY, async ([id, entry]) => {
    try {
      if (await fetchDraftExists(apiKey, socialSetId, Number(id))) return;
      edits[id] = {
        draftId: Number(id),
        source: 'ledger',
        outcome: 'deleted',
        original: entry.originalText,
        originalReply: entry.originalReply,
        published: null,
        publishedReply: null,
        similarity: 0,
        decidedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Stays pending, so tomorrow's run checks it again
      console.error(`draft ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Files were regenerated in later commits, so the oldest version of each is the original
function oldestDraftFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const commits = git(['log', '--all', '--reverse', '--format=%H', '--', DRAFT_DIR]).split('\n').filter(Boolean);
  for (const commit of commits) {
    for (const file of git(['ls-tree', '-r', '--name-only', commit, DRAFT_DIR]).split('\n').filter(Boolean)) {
      if (!files.has(file)) files.set(file, git(['show', `${commit}:${file}`]));
    }
  }
  return files;
}

function parseDraftFile(file: string, content: string): DraftPost[] {
  const date = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
  return content.split(/^## post \d+.*$/m).slice(1).flatMap((block) => {
    const [body = '', reply] = block.replace(/\n---\s*$/, '').split('**reply:**');
    const text = body.trim();
    const replyText = reply?.trim() ?? '';
    return text ? [{ date, text, reply: replyText && replyText !== 'none' ? replyText : null }] : [];
  });
}

function addHistoryPairs(edits: EditsFile, posts: Map<number, PublishedPost>): void {
  const drafts = [...oldestDraftFiles()].flatMap(([file, content]) => parseDraftFile(file, content));
  const best = new Map<number, { draft: DraftPost; score: number }>();
  let unmatched = 0;
  for (const draft of drafts) {
    // A draft can only publish after the day it was generated
    let match: { post: PublishedPost; score: number } | null = null;
    for (const post of posts.values()) {
      if (post.publishedAt.slice(0, 10) < draft.date) continue;
      const score = containment(draft.text, post.text);
      if (score < HISTORY_MATCH_MIN || score <= (match?.score ?? 0)) continue;
      if (diceSimilarity(draft.text, post.text) >= HISTORY_DICE_MIN) match = { post, score };
    }
    if (!match) {
      // A deletion and a full rewrite look the same here, so neither is counted
      unmatched++;
      continue;
    }
    const previous = best.get(match.post.draftId);
    if (!previous || match.score > previous.score) best.set(match.post.draftId, { draft, score: match.score });
  }

  let added = 0;
  for (const [draftId, { draft }] of best) {
    const post = posts.get(draftId);
    if (!post || edits[String(draftId)]) continue;
    edits[String(draftId)] = pairFromPost(draftId, 'history', draft.text, draft.reply, post);
    added++;
  }
  console.log(`${drafts.length} old drafts, ${best.size} matched a published post, ${unmatched} unmatched, ${added} new pairs`);
}

const edits = loadJson<EditsFile>(EDITS_PATH, {});
const posts = loadPosts();
if (isHistoryMode) addHistoryPairs(edits, posts);
else await addLedgerPairs(edits, posts);
saveJson(EDITS_PATH, edits);

const pairs = Object.values(edits);
const count = (outcome: EditPair['outcome']): number => pairs.filter((p) => p.outcome === outcome).length;
console.log(`\n${pairs.length} reviewed drafts: ${count('kept')} kept, ${count('edited')} edited, ${count('deleted')} deleted`);
console.log(`saved to ${EDITS_PATH}`);
