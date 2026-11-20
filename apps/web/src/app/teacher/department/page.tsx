"use client";

import { Building2 } from "lucide-react";
import * as React from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { DepartmentDashboard } from "@/components/shared/department-dashboard";
import { QueryState } from "@/components/shared/insights";
import { NativeSelect } from "@/components/ui/native-select";
import { useApiQuery } from "@/lib/hooks/use-api";

interface Scope {
  role: string;
  scopeType: string;
  scopeId: string | null;
  departmentName: string | null;
}

export default function HodDepartmentPage() {
  const q = useApiQuery<{ scopes: Scope[] }>("/api/academic/my-scopes");
  const departments = (q.data?.scopes ?? []).filter(
    (s) => s.scopeType === "DEPARTMENT" && (s.role === "HOD" || s.role === "DEPARTMENT_ADMIN") && s.scopeId,
  );
  const [selected, setSelected] = React.useState<string>("");
  const active = selected || departments[0]?.scopeId || "";
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No department assigned"
          description="Your college administrator assigns HOD or department-admin access under Academic Structure."
        />
      ) : (
        <div className="space-y-4">
          {departments.length > 1 && (
            <NativeSelect aria-label="Department" value={active} onChange={(e) => setSelected(e.target.value)} className="w-72">
              {departments.map((d) => (
                <option key={d.scopeId!} value={d.scopeId!}>
                  {d.departmentName}
                </option>
              ))}
            </NativeSelect>
          )}
          <DepartmentDashboard departmentId={active} eyebrow="Head of department" />
        </div>
      )}
    </QueryState>
  );
}
