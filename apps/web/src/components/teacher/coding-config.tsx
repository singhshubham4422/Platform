"use client";

import { LANGUAGES, type LanguageId } from "@lplatform/language-config";
import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface CodingConfigValue {
  languages: LanguageId[];
  starterCode: Partial<Record<LanguageId, string>>;
  referenceSolution: Partial<Record<LanguageId, string>>;
  timeLimitMs: number;
  memoryLimitMb: number;
  skills: string;
}

export const DEFAULT_CODING_CONFIG: CodingConfigValue = {
  languages: ["PYTHON", "C", "CPP", "JAVA"],
  starterCode: Object.fromEntries(LANGUAGES.map((l) => [l.id, l.starterCode])) as Record<LanguageId, string>,
  referenceSolution: {},
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  skills: "Programming fundamentals, Problem solving",
};

/** Payload fields understood by POST/PATCH /api/questions. */
export function codingPayload(v: CodingConfigValue) {
  const pick = (m: Partial<Record<LanguageId, string>>) =>
    Object.fromEntries(Object.entries(m).filter(([k, code]) => v.languages.includes(k as LanguageId) && code && code.trim()));
  const reference = pick(v.referenceSolution);
  return {
    supportedLanguages: v.languages,
    starterCode: pick(v.starterCode),
    referenceSolution: Object.keys(reference).length ? reference : null,
    timeLimitMs: v.timeLimitMs,
    memoryLimitMb: v.memoryLimitMb,
    skills: v.skills.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export function CodingConfig({ value, onChange }: { value: CodingConfigValue; onChange: (v: CodingConfigValue) => void }) {
  const [active, setActive] = React.useState<LanguageId>(value.languages[0] ?? "PYTHON");
  const [mode, setMode] = React.useState<"starter" | "reference">("starter");
  const toggle = (id: LanguageId) => {
    const languages = value.languages.includes(id) ? value.languages.filter((l) => l !== id) : [...value.languages, id];
    onChange({ ...value, languages });
    if (!languages.includes(active) && languages[0]) setActive(languages[0]);
  };
  const map = mode === "starter" ? value.starterCode : value.referenceSolution;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Languages, starter code and limits</CardTitle>
        <CardDescription>
          Students choose among the allowed languages. Starter code is shown in the editor; the reference solution is never sent to students.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Allowed languages</legend>
          {LANGUAGES.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.languages.includes(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={l.label} />
              {l.label}
            </label>
          ))}
        </fieldset>
        {value.languages.length === 0 && <p className="text-destructive text-sm">Select at least one language.</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-time">Time limit (ms per test)</Label>
            <Input id="cc-time" type="number" min={250} max={20000} step={250} value={value.timeLimitMs} onChange={(e) => onChange({ ...value, timeLimitMs: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-mem">Memory limit (MB)</Label>
            <Input id="cc-mem" type="number" min={32} max={1024} value={value.memoryLimitMb} onChange={(e) => onChange({ ...value, memoryLimitMb: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-skills">Skills evidenced (comma separated)</Label>
            <Input id="cc-skills" value={value.skills} onChange={(e) => onChange({ ...value, skills: e.target.value })} />
          </div>
        </div>
        {value.languages.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" aria-label="Language" className="bg-muted inline-flex rounded-lg p-1">
                {value.languages.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active === id}
                    onClick={() => setActive(id)}
                    className={cn("rounded-md px-3 py-1 text-xs font-medium", active === id ? "bg-background shadow-sm" : "text-muted-foreground")}
                  >
                    {LANGUAGES.find((l) => l.id === id)?.label}
                  </button>
                ))}
              </div>
              <div role="tablist" aria-label="Code kind" className="bg-muted inline-flex rounded-lg p-1">
                {(["starter", "reference"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1 text-xs font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    {m === "starter" ? "Starter code" : "Reference solution (private)"}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              aria-label={`${mode === "starter" ? "Starter code" : "Reference solution"} for ${active}`}
              spellCheck={false}
              className="border-input bg-background focus-visible:ring-ring min-h-56 w-full rounded-md border p-3 font-mono text-[13px] leading-6 focus-visible:ring-2 focus-visible:outline-none"
              value={map[active] ?? ""}
              onChange={(e) => onChange({ ...value, [mode === "starter" ? "starterCode" : "referenceSolution"]: { ...map, [active]: e.target.value } })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
