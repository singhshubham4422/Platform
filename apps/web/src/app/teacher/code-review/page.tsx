"use client";

import { ChevronLeft, ChevronRight, ClipboardPaste, Eye, FileCode2, Pause, Play, PlayCircle, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { FactNotice, QueryState, VerdictBadge } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { changedLines } from "@/lib/diff";
import { humanize, useApiQuery } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

interface Snapshot {
  id: string;
  kind: string;
  language: string;
  content: string;
  job_id: string | null;
  metadata: Record<string, unknown>;
  client_ts: string;
}
interface ActivityEvent {
  id: string;
  event_type: string;
  client_ts: string;
  metadata: Record<string, unknown>;
}
interface Execution {
  id: string;
  kind: string;
  language: string;
  status: string;
  verdict: string | null;
  passed_tests: number;
  total_tests: number;
  created_at: string;
}
interface Playback {
  snapshots: Snapshot[];
  events: ActivityEvent[];
  executions: Execution[];
  notice: string;
}

const time = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function CodeReviewContent() {
  const params = useSearchParams();
  const studentId = params.get("studentId");
  const questionId = params.get("questionId");
  const assignmentId = params.get("assignmentId");
  const path = studentId && questionId ? `/api/coding/playback?studentId=${studentId}&questionId=${questionId}${assignmentId ? `&assignmentId=${assignmentId}` : ""}` : null;
  const q = useApiQuery<Playback>(path);
  const snaps = q.data?.snapshots ?? [];
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => setIndex(Math.max(0, snaps.length - 1)), [snaps.length]);
  React.useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= snaps.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, snaps.length]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(snaps.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snaps.length]);

  if (!path) {
    return <EmptyState icon={FileCode2} title="Choose a submission" description="Open Code Playback from the Submissions page to review a student's coding history." action={<Button asChild size="sm"><Link href="/teacher/submissions">Go to submissions</Link></Button>} />;
  }

  const current = snaps[index];
  const prev = index > 0 ? snaps[index - 1] : undefined;
  const changed = current ? changedLines(prev?.content ?? "", current.content) : new Set<number>();
  const currentTs = current ? new Date(current.client_ts).getTime() : 0;
  const jumpTo = (ts: string) => {
    const t = new Date(ts).getTime();
    let best = 0;
    snaps.forEach((s, i) => {
      if (new Date(s.client_ts).getTime() <= t) best = i;
    });
    setIndex(best);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Code playback"
        title="Coding history"
        description="Replay saved revisions, paste events and execution attempts. Use ← → to step and Space to play."
        actions={
          <Button asChild variant="outline">
            <Link href={`/teacher/students/${studentId}`}>
              <Eye className="size-4" /> Student profile
            </Link>
          </Button>
        }
      />
      <FactNotice>Activity records are observations, not evidence of misconduct. A paste can come from the student&apos;s own notes; a focus change has many ordinary causes.</FactNotice>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {snaps.length === 0 || !current ? (
          <EmptyState title="No code history recorded" description="History is captured by the student desktop app while the student works on this question." />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
            <Card className="min-w-0">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    Revision {index + 1} of {snaps.length}
                    <Badge variant="outline">{humanize(current.kind)}</Badge>
                    <Badge variant="outline">{current.language}</Badge>
                  </CardTitle>
                  <span className="text-muted-foreground text-xs tabular-nums">{new Date(current.client_ts).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" aria-label="First revision" onClick={() => setIndex(0)}><SkipBack className="size-4" /></Button>
                  <Button size="icon" variant="outline" aria-label="Previous revision" onClick={() => setIndex((i) => Math.max(0, i - 1))}><ChevronLeft className="size-4" /></Button>
                  <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
                  <Button size="icon" variant="outline" aria-label="Next revision" onClick={() => setIndex((i) => Math.min(snaps.length - 1, i + 1))}><ChevronRight className="size-4" /></Button>
                  <Button size="icon" variant="outline" aria-label="Last revision" onClick={() => setIndex(snaps.length - 1)}><SkipForward className="size-4" /></Button>
                  <input
                    type="range"
                    min={0}
                    max={snaps.length - 1}
                    value={index}
                    onChange={(e) => setIndex(Number(e.target.value))}
                    className="accent-primary flex-1"
                    aria-label="Timeline position"
                  />
                </div>
                <p className="text-muted-foreground text-xs">{changed.size} line(s) changed from the previous revision{current.kind === "PASTE" ? ` · pasted ${String(current.metadata?.pastedChars ?? "?")} characters` : ""}</p>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted/50 max-h-[560px] overflow-auto rounded-lg border p-0 font-mono text-[13px] leading-6" aria-label="Source code at this revision">
                  {current.content.split("\n").map((line, i) => (
                    <div key={i} className={cn("flex", changed.has(i) && "bg-emerald-500/15")}>
                      <span className="text-muted-foreground w-12 shrink-0 border-r pr-3 text-right select-none">{i + 1}</span>
                      <code className="px-3 whitespace-pre">{line || " "}</code>
                    </div>
                  ))}
                </pre>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Executions</CardTitle>
                  <CardDescription>Runs use visible tests; submissions include hidden tests.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(q.data?.executions ?? []).map((e) => (
                    <button key={e.id} type="button" onClick={() => jumpTo(e.created_at)} className={cn("hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm", new Date(e.created_at).getTime() <= currentTs && "border-primary/30")}>
                      <span className="flex items-center gap-2">
                        <PlayCircle className="text-muted-foreground size-4" />
                        {e.kind === "SUBMIT" ? "Submit" : "Run"} · {e.language}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs tabular-nums">{e.passed_tests}/{e.total_tests}</span>
                        <VerdictBadge verdict={e.verdict} />
                      </span>
                    </button>
                  ))}
                  {!q.data?.executions.length && <p className="text-muted-foreground text-sm">No executions.</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Activity timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="max-h-80 space-y-1 overflow-auto">
                    {(q.data?.events ?? []).map((e) => (
                      <li key={e.id}>
                        <button type="button" onClick={() => jumpTo(e.client_ts)} className={cn("hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs", new Date(e.client_ts).getTime() > currentTs && "opacity-50")}>
                          {e.event_type === "paste_detected" ? <ClipboardPaste className="size-3.5 text-amber-500" /> : <span className="bg-primary/60 size-1.5 rounded-full" />}
                          <span className="font-medium">{humanize(e.event_type)}</span>
                          <span className="text-muted-foreground ml-auto tabular-nums">{time(e.client_ts)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export default function CodeReviewPage() {
  return (
    <React.Suspense>
      <CodeReviewContent />
    </React.Suspense>
  );
}
