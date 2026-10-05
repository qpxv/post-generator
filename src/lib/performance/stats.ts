export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// 0-100 rank of value among peers, ties split evenly
export function percentileAmong(value: number, peers: number[]): number {
  if (peers.length <= 1) return 50;
  const below = peers.filter((p) => p < value).length;
  const ties = peers.filter((p) => p === value).length;
  return ((below + (ties - 1) / 2) / (peers.length - 1)) * 100;
}

function medianGap(scores: number[], labels: boolean[]): number {
  return median(scores.filter((_, i) => labels[i])) - median(scores.filter((_, i) => !labels[i]));
}

// Shuffle the labels to see how often chance alone produces a median gap this
// large: the honest answer to "is this real or noise"
export function permutationPValue(
  scores: number[],
  labels: boolean[],
  permutations: number,
  random: () => number = Math.random,
): number {
  const observed = Math.abs(medianGap(scores, labels));
  const shuffled = [...labels];
  let asExtreme = 0;
  for (let n = 0; n < permutations; n++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (Math.abs(medianGap(scores, shuffled)) >= observed) asExtreme++;
  }
  return (asExtreme + 1) / (permutations + 1);
}

// Small seeded PRNG (mulberry32) so a rerun on the same data gives the same
// p-values instead of flipping rules that sit near a threshold
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
