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
}

export interface PostsFile {
  updatedAt: string;
  posts: PublishedPost[];
}

export interface FollowerPoint {
  date: string;
  followers: number;
}
