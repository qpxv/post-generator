import type { TweetStats } from '../../types/performance.js';

export type TweetLookup =
  | { status: 'ok'; stats: TweetStats; followers: number }
  | { status: 'missing' };

interface FxTweet extends TweetStats {
  author: { followers: number };
}

// fxtwitter is unofficial and unauthenticated: callers should throttle and
// treat a thrown error as "try again next run", never as fatal
export async function fetchTweet(tweetId: string): Promise<TweetLookup> {
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`);
  // A deleted or protected tweet comes back as an html page, not json
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  if (res.status === 404 || !isJson) return { status: 'missing' };
  if (!res.ok) throw new Error(`fxtwitter ${tweetId} failed with ${res.status}`);

  const body = await res.json() as { tweet?: FxTweet };
  if (!body.tweet) return { status: 'missing' };
  const { views, likes, replies, retweets, quotes, bookmarks, author } = body.tweet;
  return { status: 'ok', stats: { views, likes, replies, retweets, quotes, bookmarks }, followers: author.followers };
}
