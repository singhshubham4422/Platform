"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Horizontal meter. `null` renders an explicit "no data" state rather than 0%. */
export function Meter({ value, label, className }: { value: number | null; label?: string; className?: string }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, value));
  const tone = pct === null ? "bg-muted" : pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label={label}
      >
        {pct !== null && <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />}
      </div>
      <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{pct === null ? "No data" : `${Math.round(pct)}%`}</span>
    </div>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--foreground)",
} as const;

/** Bar chart of real percentages; items with no data are listed instead of drawn as zero. */
export function PercentBarChart({ data, height = 260 }: { data: Array<{ name: string; value: number | null }>; height?: number }) {
  const measured = data.filter((d) => d.value !== null && d.value !== undefined);
  const missing = data.filter((d) => d.value === null || d.value === undefined);
  if (measured.length === 0) {
    return <EmptyState title="No graded work yet" description="Scores appear here once submissions are evaluated." />;
  }
  return (
    <div className="space-y-2">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={measured} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
            <YAxis domain={[0, 100]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Average score"]} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {missing.length > 0 && (
        <p className="text-muted-foreground text-xs">No graded work yet: {missing.map((m) => m.name).join(", ")}</p>
      )}
    </div>
  );
}

export function QueryState({
  isLoading,
  error,
  onRetry,
  rows = 4,
  children,
}: {
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
  rows?: number;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error.message} onRetry={onRetry} />;
  return <>{children}</>;
}

const VERDICT_TONE: Record<string, string> = {
  ACCEPTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  WRONG_ANSWER: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  COMPILE_ERROR: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  RUNTIME_ERROR: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  TIME_LIMIT_EXCEEDED: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  MEMORY_LIMIT_EXCEEDED: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  JUDGE_UNAVAILABLE: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
  SUBMISSION_FAILED: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <Badge variant="outline">Pending</Badge>;
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", VERDICT_TONE[verdict] ?? "border-border")}>
      {verdict.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export function FactNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
