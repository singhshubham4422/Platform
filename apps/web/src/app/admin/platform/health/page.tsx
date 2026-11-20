"use client";

import { CheckCircle2, Cpu, Database, HardDrive, Mail, RefreshCw, XCircle } from "lucide-react";
import * as React from "react";
import { PageHeader } from "@/components/admin/page-header";
import { FactNotice, QueryState } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiQuery } from "@/lib/hooks/use-api";

interface Health {
  version: string;
  nodeEnv: string;
  uptimeSeconds: number;
  database: { ok: boolean; latencyMs?: number; error?: string };
  judge: { provider?: string; available?: boolean; detail?: string; sandboxed?: boolean; languages?: Record<string, string> };
  queue: Record<string, number | string | null>;
  storage: { provider: string; configured: boolean; maxUploadMb: number };
  email: { provider: string };
  checkedAt: string;
}

function Status({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-4" /> Healthy
    </span>
  ) : (
    <span className="text-destructive inline-flex items-center gap-1 text-sm font-medium">
      <XCircle className="size-4" /> Unavailable
    </span>
  );
}

export default function HealthPage() {
  const q = useApiQuery<Health>("/api/platform/health", { refetchInterval: 15_000 });
  const h = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="System health"
        description="Database, judge, queue, storage and e-mail status. Refreshes every 15 seconds."
        actions={
          <Button variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {h && (
          <>
            {h.judge.sandboxed === false && (
              <FactNotice>
                The judge is using the development-only local provider, which does not isolate student code. Configure JUDGE_PROVIDER=judge0 before
                giving untrusted users access.
              </FactNotice>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4" /> Database</CardTitle>
                  <Status ok={h.database.ok} />
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">{h.database.ok ? `${h.database.latencyMs} ms round-trip` : h.database.error}</CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Cpu className="size-4" /> Judge</CardTitle>
                  <Status ok={Boolean(h.judge.available)} />
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{h.judge.provider} {h.judge.sandboxed ? "(sandboxed)" : h.judge.sandboxed === false ? "(not sandboxed)" : ""}</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(h.judge.languages ?? {}).map(([k, v]) => (
                      <Badge key={k} variant="outline" title={v} className="text-[10px]">{k}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><HardDrive className="size-4" /> Storage</CardTitle>
                  <Status ok={h.storage.configured} />
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">{h.storage.provider} · max upload {h.storage.maxUploadMb} MB</CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Mail className="size-4" /> E-mail</CardTitle>
                  <Status ok={h.email.provider !== "none"} />
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">{h.email.provider}</CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Execution queue</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
                  {[
                    ["Queued", h.queue.queued],
                    ["Running", h.queue.running],
                    ["Completed (24 h)", h.queue.completed24h],
                    ["Failed (24 h)", h.queue.failed24h],
                    ["Avg turnaround", h.queue.avgTurnaroundMs ? `${h.queue.avgTurnaroundMs} ms` : "—"],
                    ["Last claim", h.queue.lastClaimedAt ? new Date(String(h.queue.lastClaimedAt)).toLocaleTimeString() : "—"],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-muted-foreground text-xs uppercase">{k}</dt>
                      <dd className="text-xl font-semibold tabular-nums">{v ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <p className="text-muted-foreground text-xs">
              API v{h.version} · {h.nodeEnv} · up {Math.round(h.uptimeSeconds / 60)} min · checked {new Date(h.checkedAt).toLocaleTimeString()}
            </p>
          </>
        )}
      </QueryState>
    </div>
  );
}
