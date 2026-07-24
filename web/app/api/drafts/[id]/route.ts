import { NextRequest, NextResponse } from 'next/server';
import { getDraft, updateDraftText, setReviewed, deleteDraft } from '@/lib/typefully';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const draft = await getDraft(id);
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { post?: string; reply?: string | null; markReviewed?: boolean };

  try {
    if (body.post !== undefined) {
      await updateDraftText(id, body.post, body.reply ?? null);
    }
    if (body.markReviewed !== undefined) {
      const draft = await getDraft(id);
      await setReviewed(id, draft.tags, body.markReviewed);
    }
    const updated = await getDraft(id);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteDraft(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
