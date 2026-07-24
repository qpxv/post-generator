const BASE_URL = 'https://api.typefully.com';

function authHeaders(): HeadersInit {
  const apiKey = process.env.TYPEFULLY_API_KEY;
  if (!apiKey) throw new Error('missing TYPEFULLY_API_KEY in web/.env.local');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function typefullyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`typefully ${init?.method ?? 'GET'} ${path} failed: ${body}`);
  }
  return res.json() as Promise<T>;
}

type SocialSet = { id: string };
type Tag = { slug: string; name: string };
type Post = { text: string };
type Draft = {
  id: string;
  preview: string;
  tags: string[];
  scheduled_date: string | null;
  platforms: { x: { enabled: boolean; posts: Post[] } | null };
};

let socialSetIdPromise: Promise<string> | null = null;
let tagSlugsPromise: Promise<{ needsReview: string; reviewed: string }> | null = null;

function getSocialSetId(): Promise<string> {
  if (!socialSetIdPromise) {
    socialSetIdPromise = typefullyFetch<{ results: SocialSet[] }>('/v2/social-sets').then((data) => {
      const id = data.results[0]?.id;
      if (!id) throw new Error('no social set found in typefully');
      return id;
    });
  }
  return socialSetIdPromise;
}

async function getTagSlugs(): Promise<{ needsReview: string; reviewed: string }> {
  if (!tagSlugsPromise) {
    tagSlugsPromise = (async () => {
      const socialSetId = await getSocialSetId();
      const data = await typefullyFetch<{ results: Tag[] }>(`/v2/social-sets/${socialSetId}/tags`);
      const needsReview = data.results.find((t) => t.name.toLowerCase() === 'needs review');
      const reviewed = data.results.find((t) => t.name.toLowerCase() === 'reviewed');
      if (!needsReview) throw new Error('no "needs review" tag found in typefully');
      if (!reviewed) throw new Error('no "reviewed" tag found in typefully');
      return { needsReview: needsReview.slug, reviewed: reviewed.slug };
    })();
  }
  return tagSlugsPromise;
}

export type Filter = 'needs-review' | 'reviewed';

export type DraftSummary = {
  id: string;
  preview: string;
  tags: string[];
  isReviewed: boolean;
  scheduledDate: string | null;
};

export type DraftDetail = {
  id: string;
  post: string;
  reply: string | null;
  tags: string[];
  isReviewed: boolean;
};

export type DraftPage = {
  drafts: DraftSummary[];
  count: number;
};

export async function listDrafts(filter: Filter, limit: number, offset: number): Promise<DraftPage> {
  const socialSetId = await getSocialSetId();
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const slugs = await getTagSlugs();
  params.set('tag', filter === 'needs-review' ? slugs.needsReview : slugs.reviewed);
  const data = await typefullyFetch<{ results: Draft[]; count: number }>(
    `/v2/social-sets/${socialSetId}/drafts?${params.toString()}`
  );
  return {
    count: data.count,
    drafts: data.results.map((d) => {
      const tags = d.tags;
      return {
        id: d.id,
        preview: d.preview,
        tags,
        isReviewed: tags.includes(slugs.reviewed),
        scheduledDate: d.scheduled_date,
      };
    }),
  };
}

export async function getDraft(id: string): Promise<DraftDetail> {
  const socialSetId = await getSocialSetId();
  const [d, slugs] = await Promise.all([
    typefullyFetch<Draft>(`/v2/social-sets/${socialSetId}/drafts/${id}`),
    getTagSlugs(),
  ]);
  const posts = d.platforms.x?.posts ?? [];
  const tags = d.tags;
  return {
    id: d.id,
    post: posts[0]?.text ?? '',
    reply: posts[1]?.text ?? null,
    tags,
    isReviewed: tags.includes(slugs.reviewed),
  };
}

export async function updateDraftText(id: string, post: string, reply: string | null): Promise<void> {
  const socialSetId = await getSocialSetId();
  const posts: Post[] = reply ? [{ text: post }, { text: reply }] : [{ text: post }];
  await typefullyFetch(`/v2/social-sets/${socialSetId}/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ platforms: { x: { enabled: true, posts } } }),
  });
}

export async function setReviewed(id: string, currentTags: string[], reviewed: boolean): Promise<void> {
  const socialSetId = await getSocialSetId();
  const slugs = await getTagSlugs();
  const addSlug = reviewed ? slugs.reviewed : slugs.needsReview;
  const removeSlug = reviewed ? slugs.needsReview : slugs.reviewed;
  const nextTags = currentTags.filter((t) => t !== removeSlug);
  if (!nextTags.includes(addSlug)) nextTags.push(addSlug);
  await typefullyFetch(`/v2/social-sets/${socialSetId}/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags: nextTags }),
  });
}
