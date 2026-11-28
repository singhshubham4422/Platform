import type { Metadata } from "next";
import { AdminSessionProvider } from "@/components/admin/session-provider";
import { TeacherShell } from "@/components/teacher/teacher-shell";

export const metadata: Metadata = {
  title: {
    default: "Teacher Portal · PLATFORM",
    template: "%s · Teacher Portal · PLATFORM",
  },
  description:
    "Educational programming platform teacher portal for assignments and question management.",
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <TeacherShell>{children}</TeacherShell>
    </AdminSessionProvider>
  );
}
