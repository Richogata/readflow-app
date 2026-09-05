import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDashboardState } from '../sessionEngine';
import { saveBook, savePlan, saveSessions, saveProgress } from '../storage';
import type { Book, ExtractedPage, ReadingPlan, ReadingSession } from '../types';

function book(): Book {
  return {
    id: 'b1', title: 'Atomic Habits', author: null, fileName: 'a.pdf', fileType: 'pdf',
    fileSize: 100, totalPages: 100, totalWords: 40000, createdAt: '', updatedAt: '',
    status: 'active', targetDate: '2026-01-10', targetDays: 10,
  };
}
function plan(): ReadingPlan {
  return { id: 'p1', bookId: 'b1', startDate: '2026-01-01', targetDate: '2026-01-10', targetDays: 10, createdAt: '', updatedAt: '', status: 'active' };
}
function pages(): ExtractedPage[] {
  return Array.from({ length: 100 }, (_, i) => ({ pageNumber: i + 1, text: 'x '.repeat(100), wordCount: 100 }));
}
function session(n: number, start: number, end: number, date: string, status: ReadingSession['status'] = 'pending'): ReadingSession {
  return {
    id: `s${n}`, planId: 'p1', bookId: 'b1', sessionDate: date, sessionNumber: n,
    startPage: start, endPage: end, chapterTitle: null, chapterTitles: [], estimatedMinutes: 5,
    status, completedAt: status === 'completed' ? date : null, actualDuration: null,
  };
}

beforeEach(() => {
  localStorage.clear();
  saveBook(book());
  savePlan(plan());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getDashboardState — LOOP 10/11 (missed-session detection)', () => {
  it('does NOT jump straight to today\'s session when yesterday was missed — it reopens the missed one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-04T09:00:00'));

    saveSessions([
      session(1, 1, 10, '2026-01-01', 'completed'),
      session(2, 11, 20, '2026-01-02', 'completed'),
      session(3, 21, 30, '2026-01-03', 'pending'), // missed — yesterday, not done
      session(4, 31, 40, '2026-01-04', 'pending'), // "today"
    ]);
    saveProgress({ bookId: 'b1', currentPage: 20, currentPosition: 20, percent: 20, lastReadAt: null });

    const state = getDashboardState({ book: book(), pages: pages(), chapters: null, plan: plan() });

    expect(state.kind).toBe('catch-up');
    expect(state.missedCount).toBe(1);
    // The very next thing to read must resume right after the last completed page (20), not day 4.
    expect(state.session!.startPage).toBe(21);
  });

  it('handles several consecutive missed days and reorganizes the whole remainder', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-06T09:00:00'));

    saveSessions([
      session(1, 1, 10, '2026-01-01', 'completed'),
      session(2, 11, 20, '2026-01-02', 'completed'),
      session(3, 21, 30, '2026-01-03', 'pending'),
      session(4, 31, 40, '2026-01-04', 'pending'),
      session(5, 41, 50, '2026-01-05', 'pending'),
      session(6, 51, 60, '2026-01-06', 'pending'),
    ]);
    saveProgress({ bookId: 'b1', currentPage: 20, currentPosition: 20, percent: 20, lastReadAt: null });

    const state = getDashboardState({ book: book(), pages: pages(), chapters: null, plan: plan() });

    expect(state.kind).toBe('catch-up');
    expect(state.missedCount).toBe(3); // days 3, 4, 5 were in the past and incomplete
    expect(state.session!.startPage).toBe(21);
    // Completed sessions must be untouched, remaining content must still reach page 100.
    const allSessions = state.sessions!;
    const last = allSessions[allSessions.length - 1];
    expect(last.endPage).toBe(100);
    const completedOnes = allSessions.filter((s) => s.status === 'completed');
    expect(completedOnes.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('marks the book finished only once every session is completed (LOOP 15)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-11T09:00:00'));
    saveSessions([
      session(1, 1, 50, '2026-01-01', 'completed'),
      session(2, 51, 100, '2026-01-02', 'completed'),
    ]);
    const state = getDashboardState({ book: book(), pages: pages(), chapters: null, plan: plan() });
    expect(state.kind).toBe('finished');
  });

  it('shows today\'s session directly when nothing was missed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T09:00:00'));
    saveSessions([
      session(1, 1, 10, '2026-01-01', 'completed'),
      session(2, 11, 20, '2026-01-02', 'pending'),
    ]);
    const state = getDashboardState({ book: book(), pages: pages(), chapters: null, plan: plan() });
    expect(state.kind).toBe('today');
    expect(state.session!.sessionNumber).toBe(2);
  });
});
