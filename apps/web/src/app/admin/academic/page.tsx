"use client";

import { Building2, CalendarRange, GitBranch, Layers, Network, Plus, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { QueryState } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanize, useApiMutation, useApiQuery } from "@/lib/hooks/use-api";

const ROLE_LABELS: Record<string, string> = {
  HOD: "Head of department",
  DEPARTMENT_ADMIN: "Department admin",
  TEACHING_ASSISTANT: "Teaching assistant",
  FACULTY: "Faculty",
};

type Row = Record<string, string | number | null>;
interface Tree {
  departments: Row[];
  programs: Row[];
  batches: Row[];
  semesters: Row[];
  classes: Row[];
}

type FieldDef = { key: string; label: string; type: "text" | "number" | "date" | "select"; options?: (t: Tree) => Array<{ value: string; label: string }>; required?: boolean };

const ENTITY_FORMS: Record<string, { title: string; path: string; fields: FieldDef[] }> = {
  departments: {
    title: "Department",
    path: "departments",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "code", label: "Code", type: "text", required: true },
    ],
  },
  programs: {
    title: "Program",
    path: "programs",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "code", label: "Code", type: "text", required: true },
      { key: "degree", label: "Degree", type: "text", required: true },
      { key: "durationSemesters", label: "Semesters", type: "number", required: true },
      { key: "departmentId", label: "Department", type: "select", options: (t) => t.departments.map((d) => ({ value: String(d.id), label: String(d.name) })) },
    ],
  },
  "academic-years": {
    title: "Academic year",
    path: "academic-years",
    fields: [
      { key: "label", label: "Label (e.g. 2026-27)", type: "text", required: true },
      { key: "startsOn", label: "Starts", type: "date", required: true },
      { key: "endsOn", label: "Ends", type: "date", required: true },
    ],
  },
  batches: {
    title: "Batch",
    path: "batches",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "programId", label: "Program", type: "select", options: (t) => t.programs.map((p) => ({ value: String(p.id), label: String(p.name) })) },
      { key: "startYear", label: "Start year", type: "number", required: true },
      { key: "endYear", label: "End year", type: "number", required: true },
    ],
  },
  semesters: {
    title: "Semester",
    path: "semesters",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "number", label: "Number (1–12)", type: "number", required: true },
      { key: "batchId", label: "Batch", type: "select", options: (t) => t.batches.map((b) => ({ value: String(b.id), label: String(b.name) })) },
      { key: "startsOn", label: "Starts", type: "date" },
      { key: "endsOn", label: "Ends", type: "date" },
    ],
  },
};

function CreateDialog({ entity, tree, open, onOpenChange }: { entity: string; tree: Tree; open: boolean; onOpenChange: (o: boolean) => void }) {
  const def = ENTITY_FORMS[entity]!;
  const [values, setValues] = React.useState<Record<string, string>>({});
  const m = useApiMutation<Record<string, unknown>>("POST", `/api/academic/${def.path}`, { invalidate: ["/api/academic", "/api/analytics"], success: `${def.title} created` });
  React.useEffect(() => setValues({}), [entity, open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      body[f.key] = f.type === "number" ? Number(v) : v;
    }
    m.mutate(body, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New {def.title.toLowerCase()}</DialogTitle>
            <DialogDescription>Records are created in your organization only.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {def.fields.map((f) => (
              <div key={f.key} className={f.type === "select" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label htmlFor={`f-${f.key}`}>
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                {f.type === "select" ? (
                  <NativeSelect id={`f-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">— none —</option>
                    {f.options!(tree).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input id={`f-${f.key}`} type={f.type} required={f.required} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SimpleTable({ rows, columns }: { rows: Row[]; columns: Array<{ key: string; label: string; render?: (r: Row) => React.ReactNode }> }) {
  if (!rows.length) return <EmptyState title="Nothing here yet" description="Use the button above to add the first record." />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={String(r.id)}>
              {columns.map((c) => (
                <TableCell key={c.key}>{c.render ? c.render(r) : (r[c.key] ?? "—")}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RoleAssignments({ tree }: { tree: Tree }) {
  const list = useApiQuery<{ items: Row[] }>("/api/academic/role-assignments");
  const teachers = useApiQuery<{ items: Array<{ id: string; firstName: string; lastName: string; role: string }> }>("/api/users?role=TEACHER&pageSize=200");
  const [userId, setUserId] = React.useState("");
  const [deptId, setDeptId] = React.useState("");
  const [role, setRole] = React.useState("HOD");
  const assign = useApiMutation<Record<string, string>>("POST", "/api/academic/role-assignments", { invalidate: ["/api/academic"], success: "Role assigned" });
  const revoke = useApiMutation<{ id: string }>("DELETE", (b) => `/api/academic/role-assignments/${b.id}`, { invalidate: ["/api/academic"], success: "Role revoked" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="text-primary size-4" /> Department roles
        </CardTitle>
        <CardDescription>HODs and department admins see analytics only for the departments assigned here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (userId && deptId) assign.mutate({ userId, role, scopeType: "DEPARTMENT", scopeId: deptId });
          }}
        >
          <NativeSelect aria-label="Faculty member" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Faculty member…</option>
            {(teachers.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="HOD">Head of department</option>
            <option value="DEPARTMENT_ADMIN">Department admin</option>
            <option value="TEACHING_ASSISTANT">Teaching assistant</option>
          </NativeSelect>
          <NativeSelect aria-label="Department" value={deptId} onChange={(e) => setDeptId(e.target.value)} required>
            <option value="">Department…</option>
            {tree.departments.map((d) => (
              <option key={String(d.id)} value={String(d.id)}>
                {String(d.name)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={assign.isPending}>
            Assign role
          </Button>
        </form>
        <SimpleTable
          rows={list.data?.items ?? []}
          columns={[
            { key: "userName", label: "Person" },
            { key: "role", label: "Role", render: (r) => <Badge variant="outline">{ROLE_LABELS[String(r.role)] ?? humanize(String(r.role))}</Badge> },
            { key: "departmentName", label: "Department" },
            {
              key: "actions",
              label: "",
              render: (r) => (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: String(r.id) })}>
                  Revoke
                </Button>
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export default function AcademicStructurePage() {
  const tree = useApiQuery<Tree>("/api/academic/tree");
  const [creating, setCreating] = React.useState<string | null>(null);
  const t: Tree = tree.data ?? { departments: [], programs: [], batches: [], semesters: [], classes: [] };
  const name = (rows: Row[], id: unknown) => (id ? String(rows.find((r) => r.id === id)?.name ?? "—") : "—");
  const tabs = [
    { key: "departments", label: "Departments", icon: Building2 },
    { key: "programs", label: "Programs", icon: GitBranch },
    { key: "batches", label: "Batches", icon: Users },
    { key: "semesters", label: "Semesters", icon: Layers },
    { key: "academic-years", label: "Academic years", icon: CalendarRange },
  ];
  const years = useApiQuery<{ items: Row[] }>("/api/academic/academic-years");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Institution setup"
        title="Academic structure"
        description="Organization → Department → Program → Batch → Semester → Class → Section. Every level is optional; classes link into the hierarchy for reporting."
      />
      <QueryState isLoading={tree.isLoading} error={tree.error} onRetry={() => tree.refetch()}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Departments", t.departments.length],
            ["Programs", t.programs.length],
            ["Batches", t.batches.length],
            ["Semesters", t.semesters.length],
            ["Classes", t.classes.length],
          ].map(([label, n]) => (
            <div key={String(label)} className="surface p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
              <p className="text-2xl font-bold tabular-nums">{n}</p>
            </div>
          ))}
        </div>
        <Tabs defaultValue="departments">
          <TabsList className="flex-wrap">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
                <tab.icon className="size-3.5" /> {tab.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="classes" className="gap-1.5">
              <Network className="size-3.5" /> Class placement
            </TabsTrigger>
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">{tab.label}</CardTitle>
                  <Button size="sm" onClick={() => setCreating(tab.key)}>
                    <Plus className="size-4" /> Add {ENTITY_FORMS[tab.key]!.title.toLowerCase()}
                  </Button>
                </CardHeader>
                <CardContent>
                  {tab.key === "departments" && (
                    <SimpleTable
                      rows={t.departments}
                      columns={[
                        { key: "name", label: "Name", render: (r) => <Link className="font-medium hover:underline" href={`/admin/departments/${r.id}`}>{String(r.name)}</Link> },
                        { key: "code", label: "Code" },
                        { key: "status", label: "Status", render: (r) => <Badge variant="outline">{humanize(String(r.status))}</Badge> },
                      ]}
                    />
                  )}
                  {tab.key === "programs" && (
                    <SimpleTable
                      rows={t.programs}
                      columns={[
                        { key: "name", label: "Name" },
                        { key: "code", label: "Code" },
                        { key: "degree", label: "Degree" },
                        { key: "durationSemesters", label: "Semesters" },
                        { key: "departmentId", label: "Department", render: (r) => name(t.departments, r.departmentId) },
                      ]}
                    />
                  )}
                  {tab.key === "batches" && (
                    <SimpleTable
                      rows={t.batches}
                      columns={[
                        { key: "name", label: "Name" },
                        { key: "programId", label: "Program", render: (r) => name(t.programs, r.programId) },
                        { key: "startYear", label: "From" },
                        { key: "endYear", label: "To" },
                        { key: "status", label: "Status", render: (r) => humanize(String(r.status)) },
                      ]}
                    />
                  )}
                  {tab.key === "semesters" && (
                    <SimpleTable
                      rows={t.semesters}
                      columns={[
                        { key: "name", label: "Name" },
                        { key: "number", label: "No." },
                        { key: "batchId", label: "Batch", render: (r) => name(t.batches, r.batchId) },
                        { key: "status", label: "Status", render: (r) => <Badge variant="outline">{humanize(String(r.status))}</Badge> },
                      ]}
                    />
                  )}
                  {tab.key === "academic-years" && (
                    <SimpleTable rows={years.data?.items ?? []} columns={[{ key: "label", label: "Label" }, { key: "startsOn", label: "Starts" }, { key: "endsOn", label: "Ends" }, { key: "status", label: "Status" }]} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
          <TabsContent value="classes">
            <ClassPlacement tree={t} />
          </TabsContent>
        </Tabs>
        <RoleAssignments tree={t} />
      </QueryState>
      {creating && <CreateDialog entity={creating} tree={t} open={Boolean(creating)} onOpenChange={(o) => !o && setCreating(null)} />}
    </div>
  );
}

function ClassPlacement({ tree }: { tree: Tree }) {
  const m = useApiMutation<{ id: string; semesterId?: string; departmentId?: string; programId?: string; batchId?: string }>(
    "PATCH",
    (b) => `/api/academic/classes/${b.id}/placement`,
    { invalidate: ["/api/academic", "/api/analytics"], success: "Class placement updated" },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Class placement</CardTitle>
        <CardDescription>Link each class (cohort) to its department, program, batch and semester. Moving a class to a new semester keeps every student&apos;s history.</CardDescription>
      </CardHeader>
      <CardContent>
        {tree.classes.length === 0 ? (
          <EmptyState title="No classes yet" action={<Button asChild size="sm"><Link href="/admin/classes/new">Create class</Link></Button>} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Semester</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tree.classes.map((c) => (
                  <TableRow key={String(c.id)}>
                    <TableCell className="font-medium">{String(c.name)}</TableCell>
                    <TableCell className="tabular-nums">{c.students}</TableCell>
                    {(
                      [
                        ["departmentId", tree.departments],
                        ["programId", tree.programs],
                        ["batchId", tree.batches],
                        ["semesterId", tree.semesters],
                      ] as const
                    ).map(([key, rows]) => (
                      <TableCell key={key}>
                        <NativeSelect
                          aria-label={`${key} for ${c.name}`}
                          className="h-8 min-w-36"
                          value={String(c[key] ?? "")}
                          onChange={(e) => e.target.value && m.mutate({ id: String(c.id), [key]: e.target.value })}
                        >
                          <option value="">—</option>
                          {rows.map((r) => (
                            <option key={String(r.id)} value={String(r.id)}>
                              {String(r.name)}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
