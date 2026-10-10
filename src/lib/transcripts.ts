import path from 'node:path';

// Raw transcripts and per-video notes are gitignored (the repo is public and
// they are someone else's words). Only the distilled philosophy is committed.
export const TRANSCRIPTS_ROOT = 'data/transcripts';
export const PHILOSOPHY_ROOT = 'data/philosophy';

export function transcriptDir(slug: string): string {
  return path.join(TRANSCRIPTS_ROOT, slug);
}

// Each distill focus extracts different things per video, so each keeps its own notes cache
export function notesDir(slug: string, folder: string): string {
  return path.join(TRANSCRIPTS_ROOT, slug, folder);
}

export function philosophyPath(slug: string): string {
  return path.join(PHILOSOPHY_ROOT, `${slug}.md`);
}
