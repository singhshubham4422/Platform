"use client";

import { CheckCircle2, MailOpen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backendRequest } from "@/lib/api/client";

function AcceptInvitation() {
  const token = useSearchParams().get("token") ?? "";
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ role: string; email: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await backendRequest<{ role: string; email: string }>("/api/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, firstName, lastName, password: password || undefined }),
      });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {done ? <CheckCircle2 className="size-5 text-emerald-500" /> : <MailOpen className="text-primary size-5" />}
            {done ? "Account created" : "Accept your invitation"}
          </CardTitle>
          <CardDescription>
            {done
              ? done.role === "STUDENT"
                ? "Install the L_Platform student app and sign in with the code e-mailed to you once your college enrols you in a section."
                : `Sign in as ${done.email} with the password you just set.`
              : "Set up your L_Platform account. The link works once and expires after 7 days."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            done.role !== "STUDENT" && (
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            )
          ) : !token ? (
            <p className="text-destructive text-sm">This link is missing its invitation token.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-first">First name</Label>
                  <Input id="inv-first" required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-last">Last name</Label>
                  <Input id="inv-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-pass">Password (staff accounts, min. 10 characters)</Label>
                <Input id="inv-pass" type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function InviteAcceptPage() {
  return (
    <React.Suspense>
      <AcceptInvitation />
    </React.Suspense>
  );
}
