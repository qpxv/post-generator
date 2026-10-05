import fs from 'node:fs';
import { readText, writeText } from '../fs.js';
import type { FollowerPoint, PipelineState, PostsFile, PublishedPost } from '../../types/performance.js';

export const POSTS_PATH = 'data/performance/posts.json';
export const FOLLOWERS_PATH = 'data/performance/followers.json';
// Written by daily.ts when a draft is created, read by the collector once it publishes
export const LEDGER_PATH = 'data/performance/ledger.json';
export const GUIDANCE_PATH = 'data/learned/guidance.json';
export const LEARNED_PROMPT_PATH = 'data/learned/prompt.md';
export const CHANGELOG_PATH = 'data/learned/changelog.md';
export const PIPELINE_STATE_PATH = 'data/pipeline/state.json';

export function loadJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(readText(filePath)) as T;
}

export function saveJson(filePath: string, value: unknown): void {
  writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function loadPosts(): Map<number, PublishedPost> {
  const file = loadJson<PostsFile>(POSTS_PATH, { updatedAt: '', posts: [] });
  return new Map(file.posts.map((p) => [p.draftId, p]));
}

export function savePosts(posts: Map<number, PublishedPost>): void {
  const sorted = [...posts.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  saveJson(POSTS_PATH, { updatedAt: new Date().toISOString(), posts: sorted } satisfies PostsFile);
}

export function loadFollowers(): FollowerPoint[] {
  return loadJson<FollowerPoint[]>(FOLLOWERS_PATH, []);
}

// One point per day: a rerun on the same day overwrites rather than duplicates
export function recordFollowers(followers: number, date: string): void {
  const points = loadFollowers().filter((p) => p.date !== date);
  points.push({ date, followers });
  points.sort((a, b) => a.date.localeCompare(b.date));
  saveJson(FOLLOWERS_PATH, points);
}

// Seeded with the last journal day the old one-day-per-night pipeline used
const INITIAL_PIPELINE_STATE: PipelineState = { mode: 'filling', lastGeneratedThrough: '2026-10-04', updatedAt: '' };

export function loadPipelineState(): PipelineState {
  return loadJson<PipelineState>(PIPELINE_STATE_PATH, INITIAL_PIPELINE_STATE);
}

export function savePipelineState(state: PipelineState): void {
  saveJson(PIPELINE_STATE_PATH, { ...state, updatedAt: new Date().toISOString() } satisfies PipelineState);
}
