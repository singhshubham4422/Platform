"use client";

import { ScanSearch } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { FactNotice, Meter, QueryState } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useApiMutation, useApiQuery } from "@/lib/hooks/use-api";

interface AssignmentDetail {
  id: string;
  title: string;
  questions?: Array<{ questionId?: string; id?: string; title?: string; question?: { id: string; title: string } }>;
}
interface Pair {
  a: { submissionId: string; studentId: string; studentName: string };
  b: { submissionId: string; studentId: string; studentName: string };
  score: number;
  matches: Array<{ aLines: [number, number]; bLines: [number, number] }>;
}
interface Report {
  id: string;
  assignment_id: string;
  question_id: string;
  provider: string;
  threshold: string;
  pairs: Pair[];
  created_at: string;
}

export default function IntegrityPage() {
  const assignments = useApiQuery<{ items: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>>("/api/assignments?pageSize=100");
  const list = Array.isArray(assignments.data) ? assignments.data : (assignments.data?.items ?? []);
  const [assignmentId, setAssignmentId] = React.useState("");
  const [questionId, setQuestionId] = React.useState("");
  const [threshold, setThreshold] = React.useState("0.5");
  const detail = useApiQuery<AssignmentDetail>(assignmentId ? `/api/assignments/${assignmentId}` : null);
  const questions = (detail.data?.questions ?? []).map((q) => ({ id: q.questionId ?? q.question?.id ?? q.id ?? "", title: q.title ?? q.question?.title ?? "Question" }));
  const reports = useApiQuery<{ items: Report[] }>(assignmentId ? `/api/coding/similarity?assignmentId=${assignmentId}` : "/api/coding/similarity");
  const run = useApiMutation<{ assignmentId: string; questionId: string; threshold: number }>("POST", "/api/coding/similarity", { invalidate: ["/api/coding/similarity"], success: "Similarity analysis complete" });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academic integrity" title="Code similarity" description="Compare final submissions for one assignment question. Results start a human review; they are not a finding." />
      <FactNotice>Similar code is common for short or standard exercises. Review matching regions, the students&apos; code history and context before drawing any conclusion. AI authorship cannot be reliably detected and is not assessed here.</FactNotice>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run an analysis</CardTitle>
          <CardDescription>Uses JPlag when configured on the server (JPLAG_JAR), otherwise the built-in token fingerprinting comparison.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-4 md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate({ assignmentId, questionId, threshold: Number(threshold) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="sim-asg">Assignment</Label>
              <NativeSelect id="sim-asg" required value={assignmentId} onChange={(e) => { setAssignmentId(e.target.value); setQuestionId(""); }}>
                <option value="">Select…</option>
                {list.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-q">Question</Label>
              <NativeSelect id="sim-q" required value={questionId} onChange={(e) => setQuestionId(e.target.value)} disabled={!questions.length}>
                <option value="">Select…</option>
                {questions.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-t">Minimum similarity</Label>
              <NativeSelect id="sim-t" value={threshold} onChange={(e) => setThreshold(e.target.value)}>
                {["0.4", "0.5", "0.6", "0.7", "0.8"].map((t) => <option key={t} value={t}>{Math.round(Number(t) * 100)}%</option>)}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={!assignmentId || !questionId || run.isPending}>
              <ScanSearch className="size-4" /> {run.isPending ? "Analysing…" : "Analyse"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <QueryState isLoading={reports.isLoading} error={reports.error}>
        {reports.data?.items.length ? (
          reports.data.items.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Report · {new Date(r.created_at).toLocaleString()}
                  <Badge variant="outline">{r.provider}</Badge>
                  <Badge variant="outline">≥ {Math.round(Number(r.threshold) * 100)}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {r.pairs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No pairs above the threshold.</p>
                ) : (
                  r.pairs.map((p) => (
                    <div key={`${p.a.submissionId}-${p.b.submissionId}`} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{p.a.studentName} ↔ {p.b.studentName}</p>
                        <div className="w-48"><Meter value={p.score * 100} label="Similarity" /></div>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Matching regions: {p.matches.length ? p.matches.map((m) => `L${m.aLines[0]}–${m.aLines[1]} ↔ L${m.bLines[0]}–${m.bLines[1]}`).join(", ") : "reported by JPlag"}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button asChild size="sm" variant="outline"><Link href={`/teacher/code-review?studentId=${p.a.studentId}&questionId=${r.question_id}&assignmentId=${r.assignment_id}`}>History: {p.a.studentName}</Link></Button>
                        <Button asChild size="sm" variant="outline"><Link href={`/teacher/code-review?studentId=${p.b.studentId}&questionId=${r.question_id}&assignmentId=${r.assignment_id}`}>History: {p.b.studentName}</Link></Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState icon={ScanSearch} title="No similarity reports yet" />
        )}
      </QueryState>
    </div>
  );
}
