import type { Book, DetectedChapter, ExtractedPage, ReadingPlan, ReadingSession } from './types';
import { estimateMinutes } from './analyzeFile';

const OVERFLOW_FACTOR = 1.28; // allow a day to run a bit over target to avoid cutting a chapter
const REASONABLE_MAX_MINUTES = 40; // ceiling used when proposing a realistic new pace

export const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

interface Unit {
  title: string | null;
  startPage: number;
  endPage: number;
  pageCount: number;
}

function pageWordCount(pages: ExtractedPage[], from: number, to: number): number {
  return pages.filter((p) => p.pageNumber >= from && p.pageNumber <= to).reduce((s, p) => s + p.wordCount, 0);
}

function buildUnits(chapters: DetectedChapter[] | null, fromPage: number, toPage: number): Unit[] {
  if (chapters && chapters.length) {
    return chapters
      .map((c) => ({
        title: c.title,
        startPage: Math.max(c.startPage, fromPage),
        endPage: Math.min(c.endPage, toPage),
      }))
      .filter((c) => c.endPage >= c.startPage)
      .map((c) => ({ ...c, pageCount: c.endPage - c.startPage + 1 }));
  }
  const units: Unit[] = [];
  for (let p = fromPage; p <= toPage; p++) {
    units.push({ title: null, startPage: p, endPage: p, pageCount: 1 });
  }
  return units;
}

function pagesOf(bucket: Unit[]): number {
  return bucket.reduce((s, u) => s + u.pageCount, 0);
}

/** Greedily bucket units into `targetDays` balanced, chapter-respecting groups. */
function bucketUnits(units: Unit[], targetDays: number): Unit[][] {
  const totalPages = units.reduce((s, u) => s + u.pageCount, 0);
  const idealPerDay = totalPages / Math.max(1, targetDays);

  const buckets: Unit[][] = [];
  let current: Unit[] = [];
  let currentPages = 0;

  for (const unit of units) {
    if (current.length && currentPages + unit.pageCount > idealPerDay * OVERFLOW_FACTOR) {
      buckets.push(current);
      current = [unit];
      currentPages = unit.pageCount;
    } else {
      current.push(unit);
      currentPages += unit.pageCount;
    }
  }
  if (current.length) buckets.push(current);

  while (buckets.length > targetDays) {
    let mergeIdx = 0;
    let smallestSum = Infinity;
    for (let i = 0; i < buckets.length - 1; i++) {
      const sum = pagesOf(buckets[i]) + pagesOf(buckets[i + 1]);
      if (sum < smallestSum) { smallestSum = sum; mergeIdx = i; }
    }
    buckets[mergeIdx] = buckets[mergeIdx].concat(buckets[mergeIdx + 1]);
    buckets.splice(mergeIdx + 1, 1);
  }

  while (buckets.length < targetDays) {
    let idx = 0, max = -1;
    buckets.forEach((b, i) => { const pc = pagesOf(b); if (pc > max) { max = pc; idx = i; } });
    const b = buckets[idx];
    if (b.length <= 1) break;
    const mid = Math.ceil(b.length / 2);
    buckets.splice(idx, 1, b.slice(0, mid), b.slice(mid));
  }

  return buckets;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateDiffDays(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

function bucketsToSessions(opts: {
  buckets: Unit[][];
  bookId: string;
  pages: ExtractedPage[];
  planId: string;
  startDate: string;
  startSessionNumber: number;
}): ReadingSession[] {
  const { buckets, bookId, pages, planId, startDate, startSessionNumber } = opts;
  return buckets.map((bucket, i) => {
    const startPage = bucket[0].startPage;
    const endPage = bucket[bucket.length - 1].endPage;
    const words = pageWordCount(pages, startPage, endPage);
    const chapterTitles = Array.from(new Set(bucket.map((u) => u.title).filter((t): t is string => !!t)));
    return {
      id: uid(),
      planId,
      bookId,
      sessionDate: addDays(startDate, i),
      sessionNumber: startSessionNumber + i,
      startPage,
      endPage,
      chapterTitle: chapterTitles[0] || null,
      chapterTitles,
      estimatedMinutes: estimateMinutes(words),
      status: 'pending',
      completedAt: null,
      actualDuration: null,
    };
  });
}

export function buildInitialPlan(opts: {
  book: Book;
  pages: ExtractedPage[];
  chapters: DetectedChapter[] | null;
  targetDays: number;
  startDate: string;
}): { plan: ReadingPlan; sessions: ReadingSession[] } {
  const { book, pages, chapters, targetDays, startDate } = opts;
  const units = buildUnits(chapters, 1, book.totalPages);
  const buckets = bucketUnits(units, targetDays);
  const planId = uid();
  const sessions = bucketsToSessions({ buckets, bookId: book.id, pages, planId, startDate, startSessionNumber: 1 });
  const plan: ReadingPlan = {
    id: planId,
    bookId: book.id,
    startDate,
    targetDate: sessions.length ? sessions[sessions.length - 1].sessionDate : startDate,
    targetDays,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  };
  return { plan, sessions };
}

export interface ReplanResult {
  feasible: boolean;
  sessions: ReadingSession[];
  targetDate?: string;
  proposal?: { newTargetDate: string; minutesPerDay: number; days: number };
}

/** Adaptive replanning: redistribute remaining content, preserving progress already made. */
export function replan(opts: {
  book: Book;
  pages: ExtractedPage[];
  chapters: DetectedChapter[] | null;
  plan: ReadingPlan;
  currentPosition: number;
  todayStr: string;
  keepSessionsUpTo: number;
}): ReplanResult {
  const { book, pages, chapters, plan, currentPosition, todayStr, keepSessionsUpTo } = opts;
  const fromPage = Math.min(currentPosition + 1, book.totalPages);
  const toPage = book.totalPages;
  if (fromPage > toPage) return { feasible: true, sessions: [] };

  const remainingWords = pageWordCount(pages, fromPage, toPage);
  const remainingMinutes = estimateMinutes(remainingWords);

  const daysToTarget = Math.max(1, dateDiffDays(todayStr, plan.targetDate));
  const paceAtTarget = remainingMinutes / daysToTarget;

  const units = buildUnits(chapters, fromPage, toPage);

  if (paceAtTarget <= REASONABLE_MAX_MINUTES) {
    const buckets = bucketUnits(units, daysToTarget);
    const sessions = bucketsToSessions({ buckets, bookId: book.id, pages, planId: plan.id, startDate: todayStr, startSessionNumber: keepSessionsUpTo + 1 });
    return { feasible: true, sessions, targetDate: plan.targetDate };
  }

  const neededDays = Math.max(1, Math.ceil(remainingMinutes / REASONABLE_MAX_MINUTES));
  const newTargetDate = addDays(todayStr, neededDays - 1);
  const proposedMinutesPerDay = Math.round(remainingMinutes / neededDays);
  const buckets = bucketUnits(units, neededDays);
  const sessions = bucketsToSessions({ buckets, bookId: book.id, pages, planId: plan.id, startDate: todayStr, startSessionNumber: keepSessionsUpTo + 1 });

  return {
    feasible: false,
    proposal: { newTargetDate, minutesPerDay: proposedMinutesPerDay, days: neededDays },
    sessions,
  };
}
