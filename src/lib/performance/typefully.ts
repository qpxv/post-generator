const TYPEFULLY_BASE = 'https://api.typefully.com/v2';
const PAGE_SIZE = 50;

export interface PublishedDraft {
  id: number;
  createdAt: string;
  publishedAt: string;
  typefullyTags: string[];
  xUrl: string;
}

export interface DraftThread {
  // First entry is the post itself, the rest are the self-replies under it
  texts: string[];
  hasMedia: boolean;
}

interface DraftListItem {
  id: number;
  created_at: string;
  published_at: string | null;
  tags: string[];
  x_published_url: string | null;
}

interface DraftDetail {
  platforms: { x?: { posts: { text: string; media_ids?: string[] }[] } };
}

async function getJson<T>(apiKey: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`typefully GET ${url} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json() as T;
}

export async function fetchSocialSetId(apiKey: string): Promise<number> {
  const sets = await getJson<{ results: { id: number }[] }>(apiKey, `${TYPEFULLY_BASE}/social-sets`);
  const id = sets.results[0]?.id;
  if (id === undefined) throw new Error('no social set found in typefully');
  return id;
}

// Drafts without an x url (published elsewhere, or still processing) are dropped
export async function fetchPublishedDrafts(apiKey: string, socialSetId: number): Promise<PublishedDraft[]> {
  const drafts: PublishedDraft[] = [];
  let url: string | null = `${TYPEFULLY_BASE}/social-sets/${socialSetId}/drafts?status=published&limit=${PAGE_SIZE}`;
  while (url) {
    const page: { results: DraftListItem[]; next: string | null } = await getJson(apiKey, url);
    for (const d of page.results) {
      if (!d.x_published_url || !d.published_at) continue;
      drafts.push({ id: d.id, createdAt: d.created_at, publishedAt: d.published_at, typefullyTags: d.tags, xUrl: d.x_published_url });
    }
    url = page.next;
  }
  return drafts;
}

export async function fetchDraftThread(apiKey: string, socialSetId: number, draftId: number): Promise<DraftThread> {
  const detail = await getJson<DraftDetail>(apiKey, `${TYPEFULLY_BASE}/social-sets/${socialSetId}/drafts/${draftId}`);
  const posts = detail.platforms.x?.posts ?? [];
  return {
    texts: posts.map((p) => p.text),
    hasMedia: (posts[0]?.media_ids?.length ?? 0) > 0,
  };
}

export function tweetIdFromUrl(url: string): string | null {
  return url.match(/\/status\/(\d+)/)?.[1] ?? null;
}
