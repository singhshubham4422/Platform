import type { CatalogCourse, LearningCourse } from '../types';
import { outboxCounts, readDrafts } from './outbox';

const CACHE_AI_COURSE_KEY = 'lp_cache_ai_readiness_v1';
const CACHE_CATALOG_KEY = 'lp_cache_courses_catalog_v1';
const CACHE_COMPLETED_LESSONS_KEY = 'lp_cache_completed_lessons_v1';
const LAST_LESSON_KEY = 'lp_last_lesson_cursor_v1';

// Drafts and queued submissions live in the Programming Workspace outbox (./outbox.ts);
// these helpers adapt it for the dashboard views.
export function getDraft(assignmentId: string, questionId: string): { updatedAt: string } | null {
  const drafts = readDrafts().filter((d) => d.questionId === questionId && d.assignmentId === assignmentId);
  return drafts.length ? { updatedAt: drafts.map((d) => d.updatedAt).sort().at(-1)! } : null;
}

export function countSavedDrafts(): number {
  return readDrafts().length;
}

export function getQueuedSubmissions(): unknown[] {
  return new Array(outboxCounts().submissions).fill(null);
}

export function cacheAiReadinessCourse(course: LearningCourse): void {
  try {
    localStorage.setItem(CACHE_AI_COURSE_KEY, JSON.stringify(course));
  } catch {
    // Ignore quota errors
  }
}

export function getCachedAiReadinessCourse(): LearningCourse | null {
  try {
    const raw = localStorage.getItem(CACHE_AI_COURSE_KEY);
    return raw ? (JSON.parse(raw) as LearningCourse) : null;
  } catch {
    return null;
  }
}

export function cacheCoursesCatalog(items: CatalogCourse[]): void {
  try {
    localStorage.setItem(CACHE_CATALOG_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota errors
  }
}

export function getCachedCoursesCatalog(): CatalogCourse[] {
  try {
    const raw = localStorage.getItem(CACHE_CATALOG_KEY);
    return raw ? (JSON.parse(raw) as CatalogCourse[]) : [];
  } catch {
    return [];
  }
}

export function cacheCompletedLessons(ids: string[]): void {
  try {
    localStorage.setItem(CACHE_COMPLETED_LESSONS_KEY, JSON.stringify(ids));
  } catch {
    // Ignore quota errors
  }
}

export function getCachedCompletedLessons(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_COMPLETED_LESSONS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function setLastOpenedLesson(moduleIndex: number, lessonIndex: number): void {
  try {
    localStorage.setItem(LAST_LESSON_KEY, JSON.stringify({ moduleIndex, lessonIndex }));
  } catch {
    // Ignore
  }
}

export function getLastOpenedLesson(): { moduleIndex: number; lessonIndex: number } {
  try {
    const raw = localStorage.getItem(LAST_LESSON_KEY);
    if (!raw) return { moduleIndex: 0, lessonIndex: 0 };
    const parsed = JSON.parse(raw) as { moduleIndex?: number; lessonIndex?: number };
    return {
      moduleIndex: Number.isInteger(parsed.moduleIndex) ? Math.max(0, parsed.moduleIndex!) : 0,
      lessonIndex: Number.isInteger(parsed.lessonIndex) ? Math.max(0, parsed.lessonIndex!) : 0,
    };
  } catch {
    return { moduleIndex: 0, lessonIndex: 0 };
  }
}
