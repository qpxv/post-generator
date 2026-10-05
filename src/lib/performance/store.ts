import fs from 'node:fs';
import { readText, writeText } from '../fs.js';
import type { FollowerPoint, PostsFile, PublishedPost } from '../../types/performance.js';

export const POSTS_PATH = 'data/performance/posts.json';
export const FOLLOWERS_PATH = 'data/performance/followers.json';

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
