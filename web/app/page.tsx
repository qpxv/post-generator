"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";

type DraftSummary = {
  id: string;
  preview: string;
  tags: string[];
  isReviewed: boolean;
  scheduledDate: string | null;
};

type FilterKey = "needs-review" | "reviewed";

const LIMIT = 10;

export default function Home() {
  const [filter, setFilter] = useState<FilterKey>("needs-review");
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setDrafts(null);
      setError(null);
      try {
        const res = await fetch(`/api/drafts?filter=${filter}&limit=${LIMIT}&offset=${offset}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setDrafts(data.drafts);
        setCount(data.count);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [filter, offset]);

  function changeFilter(next: FilterKey) {
    setFilter(next);
    setOffset(0);
  }

  async function setReviewed(id: string, reviewed: boolean) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markReviewed: reviewed }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDrafts((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
      setCount((c) => Math.max(0, c - 1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < count;

  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-6">
      <header className="pt-14 pb-8">
        <h1 className="text-lg font-semibold tracking-tight">
          Review <span className="text-muted-foreground font-normal">/ Drafts queue</span>
        </h1>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(v) => changeFilter(v as FilterKey)}
        >
          <TabsList>
            <TabsTrigger value="needs-review">Needs review</TabsTrigger>
            <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
          </TabsList>
        </Tabs>
        {count > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{count} total</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 mb-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {drafts === null && !error && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      )}

      {drafts !== null && drafts.length === 0 && !error && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Inbox className="size-6" />
          <p className="text-sm">Nothing here. Queue is clear.</p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {drafts?.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-4 rounded-lg border px-5 py-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
          >
            <Link
              href={`/posts/${d.id}`}
              className="flex-1 min-w-0 text-sm leading-relaxed line-clamp-2 hover:text-primary transition-colors"
            >
              {d.preview || <span className="text-muted-foreground italic">(Empty)</span>}
            </Link>
            <div className="shrink-0 pt-0.5">
              <Button
                variant={d.isReviewed ? "outline" : "success"}
                size="sm"
                onClick={() => setReviewed(d.id, !d.isReviewed)}
                disabled={pendingId === d.id}
              >
                {pendingId === d.id && <Loader2 className="animate-spin" />}
                {d.isReviewed ? "Mark as unreviewed" : "Mark as reviewed"}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {drafts !== null && drafts.length > 0 && (hasPrev || hasNext) && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (hasPrev) setOffset((o) => Math.max(0, o - LIMIT));
                }}
                className={!hasPrev ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (hasNext) setOffset((o) => o + LIMIT);
                }}
                className={!hasNext ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
