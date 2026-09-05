import { describe, it, expect } from 'vitest';
import { buildInitialPlan, replan } from '../planner';
import type { Book, DetectedChapter, ExtractedPage, ReadingPlan } from '../types';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book1',
    title: 'Test Book',
    author: null,
    fileName: 'test.pdf',
    fileType: 'pdf',
    fileSize: 1000,
    totalPages: 300,
    totalWords: 300 * 400,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    targetDate: null,
    targetDays: 10,
    ...overrides,
  };
}

function makePages(totalPages: number, wordsPerPage = 400): ExtractedPage[] {
  return Array.from({ length: totalPages }, (_, i) => ({
    pageNumber: i + 1,
    text: `page ${i + 1} content`.repeat(5),
    wordCount: wordsPerPage,
  }));
}

describe('buildInitialPlan — LOOP 5 (plan coverage)', () => {
  it('covers the whole book with no gaps, no overlaps, no duplication (no chapters)', () => {
    const book = makeBook({ totalPages: 300 });
    const pages = makePages(300);
    const { sessions } = buildInitialPlan({ book, pages, chapters: null, targetDays: 10, startDate: '2026-01-01' });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.length).toBeLessThanOrEqual(10);

    const sorted = [...sessions].sort((a, b) => a.sessionNumber - b.sessionNumber);
    expect(sorted[0].startPage).toBe(1);
    expect(sorted[sorted.length - 1].endPage).toBe(300);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startPage).toBe(sorted[i - 1].endPage + 1); // no gap, no overlap
    }
    // dates strictly increasing
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].sessionDate >= sorted[i - 1].sessionDate).toBe(true);
    }
  });

  it('respects chapter boundaries rather than cutting a small trailing chapter', () => {
    const book = makeBook({ totalPages: 100 });
    const pages = makePages(100, 100);
    // Day budget ~10 pages/day over 10 days. Chapter 3 example from the spec:
    // a 12-page chapter shouldn't be split when ~15 pages remain in the day.
    const chapters: DetectedChapter[] = [
      { title: 'Ch1', startPage: 1, endPage: 9 },
      { title: 'Ch2', startPage: 10, endPage: 21 }, // 12 pages
      { title: 'Ch3', startPage: 22, endPage: 40 },
      { title: 'Ch4', startPage: 41, endPage: 100 },
    ];
    const { sessions } = buildInitialPlan({ book, pages, chapters, targetDays: 10, startDate: '2026-01-01' });

    // Chapter 2 (10-21) must appear whole inside a single session, never split.
    const containing = sessions.find((s) => s.startPage <= 10 && s.endPage >= 10);
    expect(containing).toBeTruthy();
    expect(containing!.startPage).toBeLessThanOrEqual(10);
    expect(containing!.endPage).toBeGreaterThanOrEqual(21);
  });

  it('falls back to page-based bucketing when there is no chapter structure', () => {
    const book = makeBook({ totalPages: 50 });
    const pages = makePages(50, 100);
    const { sessions } = buildInitialPlan({ book, pages, chapters: null, targetDays: 5, startDate: '2026-01-01' });
    expect(sessions.length).toBe(5);
    const totalCovered = sessions.reduce((s, sess) => s + (sess.endPage - sess.startPage + 1), 0);
    expect(totalCovered).toBe(50);
  });
});

describe('replan — LOOP 12 (adaptive replanning)', () => {
  it('never reassigns already-completed content, only redistributes the remainder', () => {
    const book = makeBook({ totalPages: 300 });
    const pages = makePages(300);
    const plan: ReadingPlan = {
      id: 'plan1', bookId: book.id, startDate: '2026-01-01', targetDate: '2026-01-10',
      targetDays: 10, createdAt: '', updatedAt: '', status: 'active',
    };
    // User completed through page 90 (3 sessions of the original 10), then fell behind.
    const result = replan({
      book, pages, chapters: null, plan,
      currentPosition: 90,
      todayStr: '2026-01-05',
      keepSessionsUpTo: 3,
    });

    expect(result.sessions[0].startPage).toBe(91); // resumes exactly after last completed page
    expect(result.sessions[0].sessionNumber).toBe(4); // continues numbering, doesn't restart
    const last = result.sessions[result.sessions.length - 1];
    expect(last.endPage).toBe(300); // still covers all remaining content
  });

  it('preserves the target date when the resulting pace is realistic', () => {
    const book = makeBook({ totalPages: 100 });
    const pages = makePages(100, 100); // light book, easy pace
    const plan: ReadingPlan = {
      id: 'plan1', bookId: book.id, startDate: '2026-01-01', targetDate: '2026-01-10',
      targetDays: 10, createdAt: '', updatedAt: '', status: 'active',
    };
    const result = replan({ book, pages, chapters: null, plan, currentPosition: 20, todayStr: '2026-01-05', keepSessionsUpTo: 2 });
    expect(result.feasible).toBe(true);
    expect(result.targetDate).toBe('2026-01-10');
  });

  it('proposes a new, later date when the remaining pace is unrealistic', () => {
    const book = makeBook({ totalPages: 500 });
    const pages = makePages(500, 900); // dense book, huge remaining word count
    const plan: ReadingPlan = {
      id: 'plan1', bookId: book.id, startDate: '2026-01-01', targetDate: '2026-01-02', // almost no time left
      targetDays: 2, createdAt: '', updatedAt: '', status: 'active',
    };
    const result = replan({ book, pages, chapters: null, plan, currentPosition: 0, todayStr: '2026-01-01', keepSessionsUpTo: 0 });
    expect(result.feasible).toBe(false);
    expect(result.proposal).toBeTruthy();
    expect(result.proposal!.newTargetDate > plan.targetDate).toBe(true);
    expect(result.proposal!.minutesPerDay).toBeLessThanOrEqual(40);
  });
});
