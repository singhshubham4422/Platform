// Course catalog for offline-first mode: published courses the student may read (RLS decides)
// with their newest course pack version, compared with what is installed locally.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase-client';
import type { PackInfo } from './packs';

export type CatalogState = 'NOT_INSTALLED' | 'INSTALLED' | 'UPDATE_AVAILABLE';

export interface CatalogEntry {
  courseId: string;
  title: string;
  languages: string[];
  packId: string;
  version: number;
  size: number;
  sha256: string;
  state: CatalogState;
  installedVersion: number | null;
}

interface PackVersionRow {
  pack_id: string;
  course_id: string;
  version: number;
  size: number;
  sha256: string;
  courses: { id: string; title: string; languages: string[]; status: string } | null;
}

export function buildCatalog(rows: PackVersionRow[], installed: PackInfo[]): CatalogEntry[] {
  const latest = new Map<string, PackVersionRow>();
  for (const r of rows) {
    if (!r.courses || r.courses.status !== 'PUBLISHED') continue;
    const cur = latest.get(r.course_id);
    if (!cur || r.version > cur.version) latest.set(r.course_id, r);
  }
  const installedByCourse = new Map(installed.filter((p) => p.kind === 'COURSE').map((p) => [p.courseId, p]));
  return [...latest.values()]
    .map((r) => {
      const local = installedByCourse.get(r.course_id);
      const state: CatalogState = !local ? 'NOT_INSTALLED' : local.version >= r.version ? 'INSTALLED' : 'UPDATE_AVAILABLE';
      return {
        courseId: r.course_id,
        title: r.courses!.title,
        languages: r.courses!.languages,
        packId: r.pack_id,
        version: r.version,
        size: Number(r.size),
        sha256: r.sha256,
        state,
        installedVersion: local?.version ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchCatalog(installed: PackInfo[], sb: SupabaseClient = getSupabase()): Promise<CatalogEntry[]> {
  const { data, error } = await sb
    .from('course_pack_versions')
    .select('pack_id,course_id,version,size,sha256,courses!inner(id,title,languages,status)')
    .eq('kind', 'COURSE');
  if (error) throw new Error(`NETWORK: ${error.message}`);
  return buildCatalog((data ?? []) as unknown as PackVersionRow[], installed);
}
