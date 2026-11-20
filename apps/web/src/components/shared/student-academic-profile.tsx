"use client";

import { Briefcase, GraduationCap, NotebookPen, Target } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { Meter, QueryState, VerdictBadge } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, useApiMutation, useApiQuery } from "@/lib/hooks/use-api";

interface Profile {
  enrollments: Array<{ sectionId: string; sectionName: string; className: string; departmentName: string | null; programName: string | null; batchName: string | null; semesterName: string | null; semesterNumber: number | null; status: string }>;
  results: Array<{ id: string; assignmentId: string; assignmentTitle: string; questionTitle: string; language: string; status: string; verdict: string | null; score: number | null; maxMarks: number; passedTestCases: number; totalTestCases: number; submittedAt: string; courseTitle: string | null; semesterNumber: number | null; questionId?: string }>;
  skills: Array<{ skill: string; status: string; score: number | null; evidenceCount: number }>;
  placement: Array<{ role: string; readiness: string; score: number | null; evidenceCoverage: number }>;
  notes: Array<{ id: string; body: string; createdAt: string; author: string }>;
  coding: Array<{ language: string; runs: number; accepted: number }>;
}

const READINESS: Record<string, string> = {
  READY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  DEVELOPING: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  NEEDS_SUPPORT: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  INSUFFICIENT_EVIDENCE: "border-border bg-muted text-muted-foreground",
};

export function StudentAcademicProfile({ studentId, canAddNotes = false }: { studentId: string; canAddNotes?: boolean }) {
  const path = `/api/analytics/students/${studentId}/profile`;
  const q = useApiQuery<Profile>(path);
  const [note, setNote] = React.useState("");
  const addNote = useApiMutation<{ body: string }>("POST", `/api/analytics/students/${studentId}/notes`, { invalidate: [path], success: "Note saved" });
  const p = q.data;

  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
      {p && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="text-primary size-4" /> Academic history</CardTitle>
              <CardDescription>Enrolments across semesters are kept when a student moves on; results are never reset.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {p.enrollments.length ? p.enrollments.map((e) => (
                <div key={e.sectionId} className="rounded-lg border px-3 py-2 text-sm">
                  <p className="font-medium">{e.semesterName ?? "Unplaced"} · {e.className} {e.sectionName}</p>
                  <p className="text-muted-foreground text-xs">{[e.departmentName, e.programName, e.batchName].filter(Boolean).join(" · ") || "—"} · {humanize(e.status)}</p>
                </div>
              )) : <p className="text-muted-foreground text-sm">No enrolments.</p>}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Target className="text-primary size-4" /> Skill profile</CardTitle>
                <CardDescription>Scores need at least two pieces of graded evidence. “Insufficient evidence” is not a low score.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {p.skills.map((s) => (
                  <div key={s.skill} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 text-sm">
                    <span className="truncate">{s.skill} <span className="text-muted-foreground text-xs">({s.evidenceCount})</span></span>
                    {s.status === "MEASURED" ? <Meter value={s.score} /> : <span className="text-muted-foreground text-xs italic">Insufficient evidence</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Briefcase className="text-primary size-4" /> Placement readiness</CardTitle>
                <CardDescription>Weighted from measured skills; coverage shows how much of the role profile has evidence.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.placement.map((r) => (
                  <div key={r.role} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{r.role}</p>
                      <p className="text-muted-foreground text-xs">Evidence coverage {r.evidenceCoverage}%{r.score !== null ? ` · score ${r.score}` : ""}</p>
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${READINESS[r.readiness] ?? ""}`}>{humanize(r.readiness)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submissions and results</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {p.results.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Language</TableHead>
                      <TableHead>Verdict</TableHead>
                      <TableHead className="text-right">Tests</TableHead>
                      <TableHead className="text-right">Marks</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell><p className="font-medium">{r.assignmentTitle}</p><p className="text-muted-foreground text-xs">{r.questionTitle}</p></TableCell>
                        <TableCell className="text-muted-foreground">{r.courseTitle ?? "—"}{r.semesterNumber ? ` · S${r.semesterNumber}` : ""}</TableCell>
                        <TableCell><Badge variant="outline">{r.language}</Badge></TableCell>
                        <TableCell><VerdictBadge verdict={r.verdict} /></TableCell>
                        <TableCell className="text-right tabular-nums">{r.totalTestCases ? `${r.passedTestCases}/${r.totalTestCases}` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.score === null ? "—" : `${r.score}/${r.maxMarks}`}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{new Date(r.submittedAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <EmptyState title="No submissions yet" />}
            </CardContent>
          </Card>

          {canAddNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><NotebookPen className="text-primary size-4" /> Faculty notes</CardTitle>
                <CardDescription>Visible to faculty and administrators of this student, not to the student.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate({ body: note.trim() }, { onSuccess: () => setNote("") }); }}>
                  <textarea aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} className="border-input bg-background min-h-16 flex-1 rounded-md border p-2 text-sm" placeholder="Observation, feedback or follow-up…" />
                  <Button type="submit" disabled={!note.trim() || addNote.isPending} className="self-end">Add note</Button>
                </form>
                <ul className="divide-border divide-y">
                  {p.notes.map((n) => (
                    <li key={n.id} className="py-2 text-sm">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <p className="text-muted-foreground text-xs">{n.author} · {new Date(n.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <p className="text-muted-foreground text-xs">
            Coding activity: {p.coding.length ? p.coding.map((c) => `${c.language} ${c.accepted}/${c.runs} accepted`).join(" · ") : "none"} ·{" "}
            <Link className="underline" href={`/teacher/submissions`}>Review submissions</Link>
          </p>
        </div>
      )}
    </QueryState>
  );
}
