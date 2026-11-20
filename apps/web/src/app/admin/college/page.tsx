"use client";

import { Activity, BookOpen, Building2, ClipboardList, GraduationCap, Layers, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageHeader } from "@/components/admin/page-header";
import { useOptionalSession } from "@/components/admin/session-provider";
import { StatCard } from "@/components/admin/stat-card";
import { EmptyState } from "@/components/admin/empty-state";
import { Meter, PercentBarChart, QueryState } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPct, useApiQuery } from "@/lib/hooks/use-api";

interface OrgAnalytics {
  organizationId: string;
  totals: Record<string, number>;
  departments: Array<{ id: string; name: string; code: string; students: number; faculty: number; avgScore: number | null }>;
  courses: Array<{ id: string; title: string; semesterNumber: number | null; sectionName: string; className: string; studentsAssessed: number; avgScore: number | null; assignments: number }>;
  semesters: Array<{ id: string; name: string; number: number; batchName: string | null; status: string; students: number; assignments: number; completionPct: number | null }>;
  studentsNeedingSupport: Array<{ id: string; name: string; email: string; avgScore: number | null; graded: number; missed: number; reasons: string[] }>;
}

export default function CollegeAnalyticsPage() {
  const session = useOptionalSession()?.session;
  const isOwner = session?.role === "PLATFORM_OWNER" || session?.role === "PLATFORM_ADMIN";
  const orgs = useApiQuery<Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> }>(
    isOwner ? "/api/organizations/options" : null,
  );
  const orgList = React.useMemo(() => (Array.isArray(orgs.data) ? orgs.data : (orgs.data?.items ?? [])), [orgs.data]);
  const [orgId, setOrgId] = React.useState("");
  React.useEffect(() => {
    if (isOwner && !orgId && orgList[0]) setOrgId(orgList[0].id);
  }, [isOwner, orgId, orgList]);

  const path = isOwner ? (orgId ? `/api/analytics/organization?organizationId=${orgId}` : null) : "/api/analytics/organization";
  const q = useApiQuery<OrgAnalytics>(path);
  const t = q.data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Institution"
        title="College analytics"
        description="Live figures from enrolments, graded submissions and assignment activity. Items without graded work are shown as “no data”, not as zero."
        actions={
          isOwner ? (
            <NativeSelect aria-label="Organization" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-64">
              {orgList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students" value={t?.students ?? 0} hint={`${t?.activeStudents ?? 0} active accounts`} icon={Users} loading={q.isLoading} />
        <StatCard label="Active in last 7 days" value={t?.studentsActive7d ?? 0} hint="Desktop workspace activity" icon={UserCheck} tone="info" loading={q.isLoading} />
        <StatCard label="Faculty" value={t?.faculty ?? 0} hint={`${t?.departments ?? 0} departments · ${t?.programs ?? 0} programs`} icon={GraduationCap} tone="warning" loading={q.isLoading} />
        <StatCard label="Active assignments" value={t?.activeAssignments ?? 0} hint={`${t?.submissions ?? 0} submissions · ${t?.releasedResults ?? 0} released`} icon={ClipboardList} tone="rose" loading={q.isLoading} />
      </div>

      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="text-primary size-4" /> Department performance
              </CardTitle>
              <CardDescription>Average score across graded coding and written work.</CardDescription>
            </CardHeader>
            <CardContent>
              {q.data?.departments.length ? (
                <PercentBarChart data={q.data.departments.map((d) => ({ name: d.code, value: d.avgScore === null ? null : Number(d.avgScore) }))} />
              ) : (
                <EmptyState title="No departments yet" description="Create departments under Academic Structure." />
              )}
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="text-primary size-4" /> Semester progress
              </CardTitle>
              <CardDescription>Submissions made against submissions expected.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {q.data?.semesters.length ? (
                q.data.semesters.map((s) => (
                  <div key={s.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {s.batchName ? `${s.batchName} · ` : ""}
                        {s.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.status.toLowerCase()}
                      </Badge>
                    </div>
                    <Meter value={s.completionPct} label={`${s.name} completion`} />
                  </div>
                ))
              ) : (
                <EmptyState title="No semesters configured" />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="text-primary size-4" /> Course and section performance
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {q.data?.courses.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Course</TableHead>
                    <TableHead>Sem</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead className="text-right">Assignments</TableHead>
                    <TableHead className="text-right">Students assessed</TableHead>
                    <TableHead className="w-56">Average score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.courses.map((c) => (
                    <TableRow key={`${c.id}-${c.sectionName}-${c.className}`}>
                      <TableCell className="font-medium">{c.title}</TableCell>
                      <TableCell>{c.semesterNumber ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.className} · {c.sectionName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.assignments}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.studentsAssessed}</TableCell>
                      <TableCell>
                        <Meter value={c.avgScore === null ? null : Number(c.avgScore)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No course allocations" description="Allocate courses to sections to see performance." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="text-primary size-4" /> Students who may need support
            </CardTitle>
            <CardDescription>Flagged when the average graded score is below 40% or two or more past-due assignments have no submission. Review before acting.</CardDescription>
          </CardHeader>
          <CardContent>
            {q.data?.studentsNeedingSupport.length ? (
              <ul className="divide-border divide-y">
                {q.data.studentsNeedingSupport.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={`/admin/users/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">{s.reasons.join(" · ")}</p>
                    </div>
                    <span className="text-muted-foreground text-xs tabular-nums">Average {formatPct(s.avgScore)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No students flagged" description="Nobody currently meets the support criteria." />
            )}
          </CardContent>
        </Card>

        {q.data?.departments.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {q.data.departments.map((d) => (
              <Link key={d.id} href={`/admin/departments/${d.id}`} className="surface hover:border-primary/40 block p-4 transition-colors">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{d.name}</p>
                  <Badge variant="outline">{d.code}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {d.students} students · {d.faculty} faculty
                </p>
                <Meter className="mt-3" value={d.avgScore === null ? null : Number(d.avgScore)} />
              </Link>
            ))}
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
