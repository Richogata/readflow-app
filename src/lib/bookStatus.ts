import type { Book } from './types';
import { getActivePlan, getProgress, listSessionsForPlan } from './storage';

export type BookStatusLabel = 'not-started' | 'in-progress' | 'behind' | 'done';

export function getBookStatus(book: Book): { percent: number; status: BookStatusLabel } {
  const progress = getProgress(book.id);
  const percent = progress?.percent ?? 0;
  const plan = getActivePlan(book.id);
  if (!plan) return { percent, status: 'not-started' };

  const sessions = listSessionsForPlan(plan.id);
  if (sessions.length === 0) return { percent, status: 'not-started' };

  const allDone = sessions.every((s) => s.status === 'completed');
  if (allDone) return { percent: 100, status: 'done' };

  const today = new Date().toISOString().slice(0, 10);
  const hasMissed = sessions.some((s) => s.sessionDate < today && s.status !== 'completed');
  if (hasMissed) return { percent, status: 'behind' };

  return { percent, status: 'in-progress' };
}
