"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { backendRequest } from "@/lib/api/client";

/** GET a backend path with caching; `null` path disables the query. */
export function useApiQuery<T>(path: string | null, options: { refetchInterval?: number } = {}) {
  return useQuery<T, Error>({
    queryKey: ["api", path],
    queryFn: () => backendRequest<T>(path as string),
    enabled: Boolean(path),
    refetchInterval: options.refetchInterval,
  });
}

/** Mutating request that invalidates every cached path starting with one of `invalidate`. */
export function useApiMutation<TBody, TResult = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string | ((body: TBody) => string),
  { invalidate = [] as string[], success }: { invalidate?: string[]; success?: string } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, Error, TBody>({
    mutationFn: (body) =>
      backendRequest<TResult>(typeof path === "function" ? path(body) : path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: () => {
      for (const prefix of invalidate) {
        qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[1] === "string" && (q.queryKey[1] as string).startsWith(prefix),
        });
      }
      if (success) toast.success(success);
    },
    onError: (error) => toast.error(error.message),
  });
}

export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : `${Math.round(Number(value))}%`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
