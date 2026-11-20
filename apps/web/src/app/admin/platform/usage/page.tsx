"use client";

import { Cpu, Database, Download, MonitorSmartphone } from "lucide-react";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Meter, QueryState } from "@/components/shared/insights";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, useApiQuery } from "@/lib/hooks/use-api";

interface UsageRow {
  organizationId: string;
  organizationName: string;
  status: string;
  activeStudents: number;
  faculty: number;
  storageBytes: number;
  uploads: number;
  activeDevices: number;
  judgeExecutions: number;
  judgeExecutionMs: number;
  downloadBytes: number;
  subscription: { plan: string; seats: number; judgeLimit: number; storageGb: number; expiresAt: string | null; renewsAt: string | null } | null;
}

export default function UsagePage() {
  const [period, setPeriod] = React.useState(new Date().toISOString().slice(0, 7));
  const q = useApiQuery<{ period: string; items: UsageRow[] }>(`/api/platform/usage?period=${period}`);
  const items = q.data?.items ?? [];
  const sum = (k: keyof UsageRow) => items.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Licensing"
        title="Usage & licences"
        description="Metered from judge jobs, stored files, downloads and device sessions. College administrators see their own institution only."
        actions={<Input type="month" aria-label="Billing period" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" />}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Judge executions" value={sum("judgeExecutions").toLocaleString()} hint={`${Math.round(sum("judgeExecutionMs") / 1000)} s total runtime`} icon={Cpu} loading={q.isLoading} />
        <StatCard label="Stored files" value={formatBytes(sum("storageBytes"))} hint={`${sum("uploads")} uploads`} icon={Database} tone="info" loading={q.isLoading} />
        <StatCard label="Downloads" value={formatBytes(sum("downloadBytes"))} icon={Download} tone="warning" loading={q.isLoading} />
        <StatCard label="Active desktop devices" value={sum("activeDevices")} icon={MonitorSmartphone} tone="rose" loading={q.isLoading} />
      </div>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
            {items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>College</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="w-48">Seats</TableHead>
                    <TableHead className="w-48">Executions</TableHead>
                    <TableHead className="w-48">Storage</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.organizationId}>
                      <TableCell className="font-medium">{r.organizationName}</TableCell>
                      <TableCell>{r.subscription?.plan ?? <span className="text-muted-foreground">No plan</span>}</TableCell>
                      <TableCell>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {r.activeStudents} / {r.subscription?.seats ?? "—"}
                        </p>
                        <Meter value={r.subscription?.seats ? (100 * r.activeStudents) / r.subscription.seats : null} />
                      </TableCell>
                      <TableCell>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {r.judgeExecutions.toLocaleString()} / {r.subscription?.judgeLimit?.toLocaleString() ?? "—"}
                        </p>
                        <Meter value={r.subscription?.judgeLimit ? (100 * r.judgeExecutions) / r.subscription.judgeLimit : null} />
                      </TableCell>
                      <TableCell>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {formatBytes(r.storageBytes)} / {r.subscription?.storageGb ?? "—"} GB
                        </p>
                        <Meter value={r.subscription?.storageGb ? (100 * r.storageBytes) / (r.subscription.storageGb * 1024 ** 3) : null} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.activeDevices}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No usage recorded for this period" />
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
