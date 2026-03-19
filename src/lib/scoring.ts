import type { DraftPost, ScoredPost } from '../types/index.js';

const genericPhrases = [
  'game changer',
  'unlock potential',
  'best part',
  'at the end of the day',
  'furthermore',
  'in conclusion',
  'that said'
];

const commercialWords = [
  'trust',
  'money',
  'conversion',
  'clients',
  'offer',
  'price',
  'leads',
  'sales',
  'website'
];

const convictionWords = ['literally', 'bro', 'cheap', 'trust', 'serious', 'lazy', 'dogshit', 'premium'];

export function scorePost(post: DraftPost): ScoredPost {
  const text = `${post.hook}\n${post.body}`.toLowerCase();
  const notes: string[] = [];

  let specificity = 3;
  if (/\b(linktree|notion|carrd|wix|headline|pricing|testimonial|domain|faq)\b/.test(text)) specificity += 3;
  if (text.length > 140) specificity += 1;
  if (/\b\d/.test(text)) specificity += 1;
  specificity = clamp(specificity);

  let conviction = 3;
  conviction += countMatches(text, convictionWords);
  if (/\?{2,}|!{2,}/.test(text)) conviction += 1;
  conviction = clamp(conviction);

  let buyerRelevance = 2;
  buyerRelevance += countMatches(text, commercialWords);
  if (/\b(coach|client|offer|website|landing page|homepage)\b/.test(text)) buyerRelevance += 2;
  buyerRelevance = clamp(buyerRelevance);

  let originality = 6;
  if (/\b(i've been thinking|here's the thing|in today's world)\b/.test(text)) originality -= 3;
  originality -= genericPhrases.filter((phrase) => text.includes(phrase)).length * 2;
  originality = clamp(originality);

  let voiceMatch = 5;
  if (/[A-Z]{5,}/.test(`${post.hook}\n${post.body}`)) voiceMatch += 1;
  if (text.includes('linkedin')) voiceMatch -= 2;
  if (text.includes('😊') || text.includes('#')) voiceMatch -= 3;
  if (genericPhrases.some((phrase) => text.includes(phrase))) voiceMatch -= 2;
  voiceMatch = clamp(voiceMatch);

  if (specificity <= 4) notes.push('too vague');
  if (buyerRelevance <= 4) notes.push('not tied enough to client acquisition');
  if (originality <= 4) notes.push('sounds generic');
  if (voiceMatch <= 4) notes.push('does not sound enough like the target voice');

  return {
    ...post,
    scores: {
      specificity,
      conviction,
      buyerRelevance,
      originality,
      voiceMatch,
      total: specificity + conviction + buyerRelevance + originality + voiceMatch
    },
    notes
  };
}

function countMatches(text: string, words: string[]): number {
  return words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
}

function clamp(value: number): number {
  return Math.max(1, Math.min(10, value));
}
