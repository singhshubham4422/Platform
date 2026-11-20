"use client";

import { useParams } from "next/navigation";
import { DepartmentDashboard } from "@/components/shared/department-dashboard";

export default function AdminDepartmentPage() {
  const { departmentId } = useParams<{ departmentId: string }>();
  return <DepartmentDashboard departmentId={departmentId} />;
}
