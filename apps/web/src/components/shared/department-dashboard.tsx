"use client";

import { BookOpen, ClipboardCheck, GraduationCap, Users } from "lucide-react";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Meter, PercentBarChart, QueryState } from "@/components/shared/insights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPct, useApiQuery } from "@/lib/hooks/use-api";

interface DepartmentAnalytics {
  department: { id: string; name: string; code: string; students: number; faculty: number; avgScore: number | null } | null;
  courses: Array<{ id: string; title: string; semesterNumber: number | null; sectionName: string; className: string; studentsAssessed: number; avgScore: number | null; assignments: number }>;
  semesters: Array<{ id: string; name: string; batchName: string | null; completionPct: number | null }>;
  studentsNeedingSupport: Array<{ id: string; name: string; reasons: string[]; avgScore: number | null }>;
  faculty: Array<{ id: string; name: string; email: string }>;
  assignmentStats: { assignments: number; submissions: number; pendingReview: number };
}

export function DepartmentDashboard({ departmentId, eyebrow = "Department" }: { departmentId: string; eyebrow?: string }) {
  const q = useApiQuery<DepartmentAnalytics>(`/api/analytics/departments/${departmentId}`);
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={d?.department?.name ?? "Department"}
        description="Department-scoped figures. HODs only see departments assigned to them."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students" value={d?.department?.students ?? 0} icon={Users} loading={q.isLoading} />
        <StatCard label="Faculty" value={d?.department?.faculty ?? 0} icon={GraduationCap} tone="info" loading={q.isLoading} />
        <StatCard label="Assignments" value={d?.assignmentStats.assignments ?? 0} hint={`${d?.assignmentStats.submissions ?? 0} submissions`} icon={BookOpen} tone="warning" loading={q.isLoading} />
        <StatCard label="Pending review" value={d?.assignmentStats.pendingReview ?? 0} icon={ClipboardCheck} tone="rose" loading={q.isLoading} />
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subject performance</CardTitle>
              <CardDescription>Average score per course section.</CardDescription>
            </CardHeader>
            <CardContent>
              <PercentBarChart data={(d?.courses ?? []).map((c) => ({ name: `${c.title.slice(0, 16)} ${c.sectionName}`, value: c.avgScore === null ? null : Number(c.avgScore) }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Semester analytics</CardTitle>
              <CardDescription>Submission completion per semester.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {d?.semesters.length ? (
                d.semesters.map((s) => (
                  <div key={s.id}>
                    <p className="text-sm font-medium">
                      {s.batchName ? `${s.batchName} · ` : ""}
                      {s.name}
                    </p>
                    <Meter value={s.completionPct} />
                  </div>
                ))
              ) : (
                <EmptyState title="No semesters linked to this department" />
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Faculty</CardTitle>
            </CardHeader>
            <CardContent>
              {d?.faculty.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>E-mail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.faculty.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">{f.name}</TableCell>
                        <TableCell className="text-muted-foreground">{f.email}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="No faculty assigned to this department's sections" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Students requiring attention</CardTitle>
            </CardHeader>
            <CardContent>
              {d?.studentsNeedingSupport.length ? (
                <ul className="divide-border divide-y">
                  {d.studentsNeedingSupport.map((s) => (
                    <li key={s.id} className="py-2.5">
                      <p className="text-sm font-medium">
                        {s.name} <span className="text-muted-foreground text-xs">({formatPct(s.avgScore)})</span>
                      </p>
                      <p className="text-muted-foreground text-xs">{s.reasons.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No students flagged" />
              )}
            </CardContent>
          </Card>
        </div>
      </QueryState>
    </div>
  );
}
