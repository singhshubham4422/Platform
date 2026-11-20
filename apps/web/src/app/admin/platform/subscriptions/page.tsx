"use client";

import { CreditCard, Package, Plus } from "lucide-react";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Meter, QueryState } from "@/components/shared/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, useApiMutation, useApiQuery } from "@/lib/hooks/use-api";

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  seatLimit: number;
  storageGb: number;
  judgeExecutionsPerMonth: number;
  pricePerSeatCents: number;
  currency: string;
  modules: string[];
  status: string;
}
interface Subscription {
  id: string;
  organizationId: string;
  organizationName: string;
  planName: string;
  planId: string;
  seats: number;
  seatsUsed: number;
  startsAt: string;
  renewsAt: string | null;
  expiresAt: string | null;
  status: string;
  billingEmail: string | null;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

export default function SubscriptionsPage() {
  const plans = useApiQuery<{ items: Plan[] }>("/api/platform/plans");
  const subs = useApiQuery<{ items: Subscription[] }>("/api/platform/subscriptions");
  const orgs = useApiQuery<Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> }>("/api/organizations/options");
  const orgList = Array.isArray(orgs.data) ? orgs.data : (orgs.data?.items ?? []);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [subOpen, setSubOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform owner"
        title="Plans & subscriptions"
        description="Licence seats, execution quotas and renewal dates per college. Judge quotas are enforced by the API."
        actions={
          <>
            <Button variant="outline" onClick={() => setPlanOpen(true)}>
              <Package className="size-4" /> New plan
            </Button>
            <Button onClick={() => setSubOpen(true)}>
              <Plus className="size-4" /> Assign subscription
            </Button>
          </>
        }
      />
      <QueryState isLoading={plans.isLoading} error={plans.error}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(plans.data?.items ?? []).map((p) => (
            <div key={p.id} className="surface p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                <Badge variant={p.status === "ACTIVE" ? "default" : "outline"}>{humanize(p.status)}</Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{p.description || "—"}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Seats</dt>
                <dd className="text-right tabular-nums">{p.seatLimit.toLocaleString()}</dd>
                <dt className="text-muted-foreground">Storage</dt>
                <dd className="text-right tabular-nums">{p.storageGb} GB</dd>
                <dt className="text-muted-foreground">Executions / month</dt>
                <dd className="text-right tabular-nums">{p.judgeExecutionsPerMonth.toLocaleString()}</dd>
                <dt className="text-muted-foreground">Price / seat</dt>
                <dd className="text-right tabular-nums">{p.pricePerSeatCents ? money(p.pricePerSeatCents, p.currency) : "Not set"}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1">
                {p.modules.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px]">
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="text-primary size-4" /> College subscriptions
          </CardTitle>
          <CardDescription>Seats used counts active student accounts.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <QueryState isLoading={subs.isLoading} error={subs.error}>
            {subs.data?.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>College</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="w-56">Seat utilisation</TableHead>
                    <TableHead>Renews</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.data.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.organizationName}</TableCell>
                      <TableCell>{s.planName}</TableCell>
                      <TableCell>
                        <div className="text-muted-foreground mb-1 text-xs tabular-nums">
                          {s.seatsUsed} / {s.seats}
                        </div>
                        <Meter value={s.seats ? (100 * s.seatsUsed) / s.seats : null} />
                      </TableCell>
                      <TableCell className="tabular-nums">{s.renewsAt?.slice(0, 10) ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{s.expiresAt?.slice(0, 10) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "ACTIVE" ? "default" : "outline"}>{humanize(s.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No subscriptions yet" description="Assign a plan to a college to start licensing." />
            )}
          </QueryState>
        </CardContent>
      </Card>

      <PlanDialog open={planOpen} onOpenChange={setPlanOpen} />
      <SubscriptionDialog open={subOpen} onOpenChange={setSubOpen} plans={plans.data?.items ?? []} orgs={orgList} />
    </div>
  );
}

function PlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const m = useApiMutation<Record<string, unknown>>("POST", "/api/platform/plans", { invalidate: ["/api/platform"], success: "Plan created" });
  const [v, setV] = React.useState({ code: "", name: "", description: "", seatLimit: "500", storageGb: "50", judgeExecutionsPerMonth: "50000", price: "0", modules: "academics,assignments,coding" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate(
              {
                code: v.code,
                name: v.name,
                description: v.description,
                seatLimit: Number(v.seatLimit),
                storageGb: Number(v.storageGb),
                judgeExecutionsPerMonth: Number(v.judgeExecutionsPerMonth),
                pricePerSeatCents: Math.round(Number(v.price) * 100),
                modules: v.modules.split(",").map((s) => s.trim()).filter(Boolean),
              },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New subscription plan</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code (lowercase)" value={v.code} onChange={set("code")} required pattern="[a-z0-9-]{2,40}" />
            <Field label="Name" value={v.name} onChange={set("name")} required />
            <Field label="Seat limit" type="number" value={v.seatLimit} onChange={set("seatLimit")} required />
            <Field label="Storage (GB)" type="number" value={v.storageGb} onChange={set("storageGb")} required />
            <Field label="Executions / month" type="number" value={v.judgeExecutionsPerMonth} onChange={set("judgeExecutionsPerMonth")} required />
            <Field label="Price per seat (INR)" type="number" value={v.price} onChange={set("price")} />
            <div className="sm:col-span-2">
              <Field label="Modules (comma separated)" value={v.modules} onChange={set("modules")} />
            </div>
            <div className="sm:col-span-2">
              <Field label="Description" value={v.description} onChange={set("description")} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={m.isPending}>
              Create plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionDialog({ open, onOpenChange, plans, orgs }: { open: boolean; onOpenChange: (o: boolean) => void; plans: Plan[]; orgs: Array<{ id: string; name: string }> }) {
  const m = useApiMutation<Record<string, unknown>>("POST", "/api/platform/subscriptions", { invalidate: ["/api/platform"], success: "Subscription assigned" });
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = React.useState({ organizationId: "", planId: "", seats: "100", startsAt: today, renewsAt: "", billingEmail: "" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate(
              { organizationId: v.organizationId, planId: v.planId, seats: Number(v.seats), startsAt: v.startsAt, renewsAt: v.renewsAt || null, billingEmail: v.billingEmail || null },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Assign subscription</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sub-org">College</Label>
              <NativeSelect id="sub-org" required value={v.organizationId} onChange={(e) => setV({ ...v, organizationId: e.target.value })}>
                <option value="">Select…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sub-plan">Plan</Label>
              <NativeSelect id="sub-plan" required value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}>
                <option value="">Select…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (max {p.seatLimit} seats)
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Field label="Seats" type="number" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} required />
            <Field label="Starts" type="date" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} required />
            <Field label="Renews" type="date" value={v.renewsAt} onChange={(e) => setV({ ...v, renewsAt: e.target.value })} />
            <Field label="Billing e-mail" type="email" value={v.billingEmail} onChange={(e) => setV({ ...v, billingEmail: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={m.isPending}>
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}
