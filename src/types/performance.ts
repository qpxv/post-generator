import type { PostTags } from '../lib/performance/tags.js';

export interface TweetStats {
  views: number | null;
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
}

export interface Snapshot {
  takenAt: string;
  // Nightly runs land anywhere inside a snapshot window, so keep the real age
  ageHours: number;
  stats: TweetStats;
}

export interface PostSnapshots {
  h48?: Snapshot;
  d7?: Snapshot;
  latest?: Snapshot;
}

export interface PublishedPost {
  draftId: number;
  tweetId: string;
  url: string;
  createdAt: string;
  publishedAt: string;
  typefullyTags: string[];
  text: string;
  // Text of the posts after the first one in the thread (the self-reply)
  threadReplies: string[];
  hasMedia: boolean;
  isMissingOnX: boolean;
  snapshots: PostSnapshots;
  // Set by tag-posts from the published text, so review edits are reflected
  tags?: PostTags;
  // Generated as an exploration post that ignored the learned guidance
  isExplore?: boolean;
  philosophySource?: string | null;
}

export interface PostsFile {
  updatedAt: string;
  posts: PublishedPost[];
}

export interface FollowerPoint {
  date: string;
  followers: number;
}

export type PostType = 'value' | 'personal' | 'conspiracy';

export interface LedgerEntry {
  generatedAt: string;
  isExplore: boolean;
  // What the pipeline wrote before review, so edits can be diffed against
  // the published text later
  originalText: string;
  originalReply: string | null;
  // Title of the philosophy principle or client belief the post landed on,
  // null for personal posts and batches generated before the philosophy existed
  philosophySource?: string | null;
  // Unset on drafts generated before the value/personal/conspiracy mix
  postType?: PostType;
}

// Keyed by typefully draft id
export type Ledger = Record<string, LedgerEntry>;

export type ReviewOutcome = 'kept' | 'edited' | 'deleted';

// One draft and what ben did with it in review
export interface EditPair {
  draftId: number;
  // ledger: recorded at generation. history: recovered from old draft files in git.
  source: 'ledger' | 'history';
  outcome: ReviewOutcome;
  original: string;
  originalReply: string | null;
  published: string | null;
  publishedReply: string | null;
  // Bigram dice similarity of original vs published post text, 0 when deleted
  similarity: number;
  decidedAt: string;
}

// Keyed by typefully draft id
export type EditsFile = Record<string, EditPair>;

export interface EditRule {
  rule: string;
  evidence: string;
}

export interface EditLearnState {
  learnedAt: string;
  // Decided pairs at the last learn run, so the next run waits for fresh reviews
  decidedCount: number;
  rules: EditRule[];
}

export type RuleDirection = 'prefer' | 'avoid';

export interface LearnedRule {
  // e.g. "website:hook=math" or "all:length=short"
  id: string;
  direction: RuleDirection;
  text: string;
  effect: number;
  pValue: number;
  nWith: number;
  activeSince: string;
}

export interface Guidance {
  updatedAt: string;
  windowPosts: number;
  rules: LearnedRule[];
  // Only knob the learner may move. The website/personal split is never a knob.
  shortPosts: { min: number; max: number } | null;
  winnerDraftIds: number[];
}

export interface PipelineState {
  // filling: generate every night. draining: wait until the queue runs low.
  mode: 'filling' | 'draining';
  // Last journal day turned into posts, so a run after a pause reads every day since
  lastGeneratedThrough: string;
  updatedAt: string;
}
