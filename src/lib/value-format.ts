import fs from 'node:fs';
import { readText } from './fs.js';

// The guide written by `npm run study-format`. Kept out of data/examples on
// purpose: everything there is fed to every post, and only value posts may
// pick up this format.
export const VALUE_FORMAT_PATH = 'data/formats/value-posts.md';

export interface ValueFormat {
  guide: string;
  // Lowercased skeleton names from the guide's "### A. The ranked breakdown" headings
  skeletons: string[];
}

export function parseSkeletons(guide: string): string[] {
  const section = guide.split(/^## /m).find((chunk) => chunk.toLowerCase().startsWith('skeletons')) ?? '';
  return [...section.matchAll(/^### [A-Z]\.\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
}

export function loadValueFormat(filePath = VALUE_FORMAT_PATH): ValueFormat {
  const guide = fs.existsSync(filePath) ? readText(filePath).trim() : '';
  return { guide, skeletons: parseSkeletons(guide) };
}
