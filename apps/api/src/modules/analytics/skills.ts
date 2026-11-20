// Skill evidence and placement readiness. Every score is traceable to graded academic evidence;
// a skill without evidence is reported as INSUFFICIENT_EVIDENCE, never as a low score.
import type { Tx } from '../../lib/scoped-sql.js';

export const SKILLS = [
  'Programming fundamentals', 'OOPS', 'Java', 'Python', 'C/C++', 'Data structures and algorithms',
  'Operating Systems', 'Computer Networks', 'DBMS', 'Debugging', 'Problem solving', 'Technical communication',
] as const;

export const PLACEMENT_ROLES: Record<string, Array<{ skill: string; weight: number }>> = {
  'Software development': [
    { skill: 'Programming fundamentals', weight: 2 }, { skill: 'Data structures and algorithms', weight: 3 },
    { skill: 'OOPS', weight: 2 }, { skill: 'Problem solving', weight: 3 }, { skill: 'DBMS', weight: 1 },
  ],
  'Backend engineering': [
    { skill: 'Java', weight: 2 }, { skill: 'DBMS', weight: 3 }, { skill: 'Computer Networks', weight: 2 },
    { skill: 'Operating Systems', weight: 1 }, { skill: 'Data structures and algorithms', weight: 2 },
  ],
  'AI/ML engineering': [
    { skill: 'Python', weight: 3 }, { skill: 'Data structures and algorithms', weight: 2 },
    { skill: 'Problem solving', weight: 2 }, { skill: 'Programming fundamentals', weight: 1 },
  ],
  'Systems engineering': [
    { skill: 'C/C++', weight: 3 }, { skill: 'Operating Systems', weight: 3 }, { skill: 'Computer Networks', weight: 2 },
    { skill: 'Debugging', weight: 2 },
  ],
  'QA and automation': [
    { skill: 'Debugging', weight: 3 }, { skill: 'Python', weight: 2 }, { skill: 'Programming fundamentals', weight: 2 },
    { skill: 'Technical communication', weight: 1 },
  ],
};

export function inferSkills(q: { skills: unknown; topic: string | null; title: string }, language: string | null): string[] {
  const explicit = Array.isArray(q.skills) ? (q.skills as string[]).filter((s) => typeof s === 'string') : [];
  if (explicit.length) return explicit;
  const text = `${q.topic ?? ''} ${q.title}`.toLowerCase();
  const out = new Set<string>(['Problem solving']);
  if (/array|sort|search|stack|queue|linked|tree|graph|dsa|recursion|hash|matrix|dynamic/.test(text)) out.add('Data structures and algorithms');
  if (/oop|inherit|class|polymorph|generic|interface|encapsul|abstract/.test(text)) out.add('OOPS');
  if (/exception|debug|error/.test(text)) out.add('Debugging');
  if (/process|thread|schedul|memory|deadlock|operating/.test(text)) out.add('Operating Systems');
  if (/network|tcp|socket|http|protocol/.test(text)) out.add('Computer Networks');
  if (/sql|database|dbms|normal/.test(text)) out.add('DBMS');
  if (out.size === 1) out.add('Programming fundamentals');
  if (language === 'JAVA') out.add('Java');
  if (language === 'PYTHON') out.add('Python');
  if (language === 'C' || language === 'CPP') out.add('C/C++');
  return [...out];
}

export async function recordSkillEvidenceForSubmission(tx: Tx, submissionId: string, validatedBy: string): Promise<number> {
  const r = await tx.query<{
    student_id: string; organization_id: string; score: number | null; marks: number; language: string; skills: unknown;
    topic: string | null; title: string; difficulty: string; course_id: string | null; question_type: string;
  }>(
    `SELECT s.student_id, a.organization_id, s.score, COALESCE(aq.marks, q.marks) AS marks, s.language, q.skills, q.topic, q.title,
            q.difficulty, ca.course_id, q.question_type
     FROM submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN questions q ON q.id = s.question_id
     LEFT JOIN assignment_questions aq ON aq.assignment_id = s.assignment_id AND aq.question_id = s.question_id
     LEFT JOIN course_allocations ca ON ca.id = a.course_allocation_id
     WHERE s.id = $1`,
    [submissionId],
  );
  const row = r.rows[0];
  if (!row || row.marks <= 0 || row.score === null) return 0;
  const pct = Math.max(0, Math.min(100, (row.score / row.marks) * 100));
  const isCode = ['CODE', 'PROGRAMMING', 'CODING'].includes(row.question_type);
  const skills = inferSkills(row, isCode ? row.language : null);
  for (const skill of skills) {
    await tx.query(
      `INSERT INTO skill_evidence (organization_id, student_id, skill, source_type, source_id, course_id, score_pct, difficulty, validated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (student_id, skill, source_type, source_id)
       DO UPDATE SET score_pct = EXCLUDED.score_pct, validated_by = EXCLUDED.validated_by, evidence_at = NOW()`,
      [row.organization_id, row.student_id, skill, isCode ? 'CODING_SUBMISSION' : 'ASSESSMENT', submissionId, row.course_id,
        pct.toFixed(2), row.difficulty, validatedBy],
    );
  }
  return skills.length;
}

export interface SkillScore {
  skill: string;
  status: 'MEASURED' | 'INSUFFICIENT_EVIDENCE';
  score: number | null;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  sources: Array<{ sourceType: string; sourceId: string; scorePct: number; evidenceAt: string; difficulty: string | null }>;
}

const MIN_EVIDENCE = 2;

export async function studentSkillProfile(tx: Tx, studentId: string): Promise<{ skills: SkillScore[]; placement: unknown[] }> {
  const r = await tx.query<{ skill: string; source_type: string; source_id: string; score_pct: string; evidence_at: string; difficulty: string | null }>(
    `SELECT skill, source_type, source_id, score_pct, evidence_at, difficulty FROM skill_evidence WHERE student_id = $1 ORDER BY evidence_at DESC`,
    [studentId],
  );
  const by = new Map<string, typeof r.rows>();
  for (const e of r.rows) by.set(e.skill, [...(by.get(e.skill) ?? []), e]);
  const skills: SkillScore[] = SKILLS.map((skill) => {
    const ev = by.get(skill) ?? [];
    const measured = ev.length >= MIN_EVIDENCE;
    return {
      skill,
      status: measured ? 'MEASURED' : 'INSUFFICIENT_EVIDENCE',
      score: measured ? Math.round(ev.reduce((a, e) => a + Number(e.score_pct), 0) / ev.length) : null,
      evidenceCount: ev.length,
      lastEvidenceAt: ev[0]?.evidence_at ?? null,
      sources: ev.slice(0, 10).map((e) => ({ sourceType: e.source_type, sourceId: e.source_id, scorePct: Number(e.score_pct), evidenceAt: e.evidence_at, difficulty: e.difficulty })),
    };
  });
  const lookup = new Map(skills.map((s) => [s.skill, s]));
  const placement = Object.entries(PLACEMENT_ROLES).map(([role, reqs]) => {
    const totalWeight = reqs.reduce((a, r) => a + r.weight, 0);
    const covered = reqs.filter((r) => lookup.get(r.skill)?.status === 'MEASURED');
    const coveredWeight = covered.reduce((a, r) => a + r.weight, 0);
    const coverage = Math.round((coveredWeight / totalWeight) * 100);
    const score = coveredWeight === 0 ? null : Math.round(covered.reduce((a, r) => a + r.weight * (lookup.get(r.skill)!.score ?? 0), 0) / coveredWeight);
    return {
      role,
      readiness: coverage < 60 ? 'INSUFFICIENT_EVIDENCE' : score! >= 75 ? 'READY' : score! >= 55 ? 'DEVELOPING' : 'NEEDS_SUPPORT',
      score,
      evidenceCoverage: coverage,
      requirements: reqs.map((r) => ({ ...r, status: lookup.get(r.skill)?.status, score: lookup.get(r.skill)?.score ?? null })),
    };
  });
  return { skills, placement };
}
