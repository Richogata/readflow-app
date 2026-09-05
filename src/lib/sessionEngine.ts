import type { Book, DetectedChapter, ExtractedPage, ReadingPlan, ReadingSession } from './types';
import { listSessionsForPlan, saveSessions, replaceSessionsForPlan, savePlan, getProgress } from './storage';
import { replan, type ReplanResult } from './planner';

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

/** Mark any past, incomplete sessions as `missed` (LOOP 10). Persists changes. */
export function refreshMissedStatuses(planId: string): ReadingSession[] {
  const today = todayStr();
  const sessions = listSessionsForPlan(planId);
  let changed = false;
  const updated = sessions.map((s) => {
    if (s.sessionDate < today && s.status !== 'completed' && s.status !== 'missed') {
      changed = true;
      return { ...s, status: 'missed' as const };
    }
    return s;
  });
  if (changed) saveSessions(updated);
  return updated;
}

export type DashboardKind = 'none' | 'finished' | 'catch-up' | 'today' | 'ahead' | 'unrealistic';

export interface DashboardState {
  kind: DashboardKind;
  session?: ReadingSession;
  sessions?: ReadingSession[];
  missedCount?: number;
  proposal?: ReplanResult['proposal'];
}

/**
 * Open-app decision algorithm (LOOP 6 / LOOP 10 / LOOP 11): decide what the
 * dashboard should show for a book — priority: session en cours > session
 * manquée > session du jour > prochaine session.
 */
export function getDashboardState(opts: {
  book: Book;
  pages: ExtractedPage[];
  chapters: DetectedChapter[] | null;
  plan: ReadingPlan | null;
}): DashboardState {
  const { book, pages, chapters, plan } = opts;
  if (!plan) return { kind: 'none' };

  const sessions = refreshMissedStatuses(plan.id);
  if (sessions.length === 0) return { kind: 'none' };

  const today = todayStr();
  const missed = sessions.filter((s) => s.status === 'missed').sort((a, b) => a.sessionNumber - b.sessionNumber);
  const allDone = sessions.every((s) => s.status === 'completed');

  if (allDone) return { kind: 'finished', sessions };

  if (missed.length > 0) {
    const progress = getProgress(book.id);
    const currentPosition = progress?.currentPage || missed[0].startPage - 1;
    const completedCount = sessions.filter((s) => s.status === 'completed').length;

    const result = replan({
      book, pages, chapters, plan,
      currentPosition,
      todayStr: today,
      keepSessionsUpTo: completedCount,
    });

    const kept = sessions.filter((s) => s.status === 'completed');
    replaceSessionsForPlan(plan.id, [...kept, ...result.sessions]);

    if (!result.feasible) {
      savePlan({ ...plan, updatedAt: new Date().toISOString() });
      return { kind: 'unrealistic', proposal: result.proposal, sessions: [...kept, ...result.sessions], missedCount: missed.length };
    }

    savePlan({ ...plan, targetDate: result.targetDate || plan.targetDate, updatedAt: new Date().toISOString() });
    const next = result.sessions[0];
    return { kind: 'catch-up', missedCount: missed.length, session: next, sessions: [...kept, ...result.sessions] };
  }

  const pending = sessions.filter((s) => s.status !== 'completed').sort((a, b) => a.sessionNumber - b.sessionNumber);
  if (pending.length === 0) return { kind: 'finished', sessions };

  const next = pending[0];
  if (next.sessionDate > today) return { kind: 'ahead', session: next, sessions };
  return { kind: 'today', session: next, sessions };
}

export function acceptProposal(plan: ReadingPlan, proposal: NonNullable<ReplanResult['proposal']>): void {
  savePlan({ ...plan, targetDate: proposal.newTargetDate, targetDays: proposal.days, updatedAt: new Date().toISOString() });
}
