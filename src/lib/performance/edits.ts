import type { ReviewOutcome } from '../../types/performance.js';

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
}

function bigrams(text: string): Set<string> {
  const w = words(text);
  const set = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) set.add(`${w[i]} ${w[i + 1]}`);
  return set;
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared;
}

// How much of the original survived the edit (1 = word pairs unchanged)
export function diceSimilarity(a: string, b: string): number {
  const [ba, bb] = [bigrams(a), bigrams(b)];
  if (ba.size + bb.size === 0) return 1;
  return (2 * sharedCount(ba, bb)) / (ba.size + bb.size);
}

// Overlap relative to the shorter text, so a draft ben cut down hard still
// matches its published version when recovering old pairs
export function containment(a: string, b: string): number {
  const [ba, bb] = [bigrams(a), bigrams(b)];
  const smaller = Math.min(ba.size, bb.size);
  return smaller === 0 ? 0 : sharedCount(ba, bb) / smaller;
}

// Typefully can reflow whitespace, which isn't an edit
function normalizeWhitespace(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function reviewOutcome(
  original: string,
  originalReply: string | null,
  published: string,
  publishedReply: string | null,
): ReviewOutcome {
  const isSamePost = normalizeWhitespace(original) === normalizeWhitespace(published);
  const isSameReply = normalizeWhitespace(originalReply) === normalizeWhitespace(publishedReply);
  return isSamePost && isSameReply ? 'kept' : 'edited';
}
