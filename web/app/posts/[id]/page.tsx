"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type DraftDetail = {
  id: string;
  post: string;
  reply: string | null;
  tags: string[];
  isReviewed: boolean;
};

function AutoTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={cn("resize-none overflow-hidden", className)}
    />
  );
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [post, setPost] = useState("");
  const [reply, setReply] = useState("");
  const [hasReply, setHasReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const [reviewPending, setReviewPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setDraft(null);
      setError(null);
      try {
        const res = await fetch(`/api/drafts/${id}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setDraft(data);
        setPost(data.post);
        setReply(data.reply ?? "");
        setHasReply(data.reply !== null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function save() {
    setSaveState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post, reply: hasReply ? reply : null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
      setSaveState("idle");
    }
  }

  async function toggleReviewed() {
    if (!draft) return;
    setReviewPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markReviewed: !draft.isReviewed }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDraft(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewPending(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-6">
      <header className="pt-14 pb-8 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          <ArrowLeft />
          Back
        </Button>

        {draft && (
          <Button
            variant={draft.isReviewed ? "success" : "outline"}
            size="sm"
            onClick={toggleReviewed}
            disabled={reviewPending}
          >
            {reviewPending ? (
              <Loader2 className="animate-spin" />
            ) : draft.isReviewed ? (
              <Check />
            ) : null}
            {draft.isReviewed ? "Mark as unreviewed" : "Mark as reviewed"}
          </Button>
        )}
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 mb-4 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!draft && !error && (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {draft && (
        <div className="flex flex-col gap-6 pb-16">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Post
            </label>
            <AutoTextarea value={post} onChange={setPost} className="text-sm leading-relaxed" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reply
              </label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground"
                onClick={() => setHasReply((v) => !v)}
              >
                {hasReply ? "Remove reply" : "Add reply"}
              </Button>
            </div>
            {hasReply ? (
              <AutoTextarea value={reply} onChange={setReply} className="text-sm leading-relaxed" />
            ) : (
              <p className="text-sm text-muted-foreground italic">None</p>
            )}
          </div>

          <div>
            <Button onClick={save} disabled={saveState === "saving"}>
              {saveState === "saving" && <Loader2 className="animate-spin" />}
              {saveState === "saving" ? "Saving" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
