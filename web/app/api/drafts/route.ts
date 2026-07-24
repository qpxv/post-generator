import { NextRequest, NextResponse } from 'next/server';
import { listDrafts, type Filter } from '@/lib/typefully';

const VALID_FILTERS: Filter[] = ['needs-review', 'reviewed'];
const DEFAULT_LIMIT = 10;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('filter') ?? 'needs-review';
  const filter = VALID_FILTERS.includes(raw as Filter) ? (raw as Filter) : 'needs-review';
  const limit = Number(req.nextUrl.searchParams.get('limit')) || DEFAULT_LIMIT;
  const offset = Number(req.nextUrl.searchParams.get('offset')) || 0;

  try {
    const page = await listDrafts(filter, limit, offset);
    return NextResponse.json(page);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
