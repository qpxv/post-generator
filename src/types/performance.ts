export interface TweetStats {
  views: number | null;
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
}

export type StatsLookup =
  | { status: 'ok'; stats: TweetStats; fetchedAt: string }
  | { status: 'missing'; fetchedAt: string };

export interface PublishedPost {
  draftId: number;
  tweetId: string;
  url: string;
  createdAt: string;
  publishedAt: string;
  tags: string[];
  text: string;
  // Text of the posts after the first one in the thread (the self-reply)
  threadReplies: string[];
  lookup: StatsLookup | null;
}

export interface BackfillFile {
  updatedAt: string;
  posts: PublishedPost[];
}
