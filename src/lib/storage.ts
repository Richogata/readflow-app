import type { Book, Chapter, ExportBundle, ReadingPlan, ReadingProgress, ReadingSession, Settings } from './types';

const KEYS = {
  books: 'rf.books',
  chapters: 'rf.chapters',
  plans: 'rf.plans',
  sessions: 'rf.sessions',
  progress: 'rf.progress',
  settings: 'rf.settings',
} as const;

function read<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

export { uid } from './planner';

// ---------- Books ----------
export function listBooks(): Book[] {
  return read<Book>(KEYS.books);
}
export function getBook(id: string): Book | null {
  return listBooks().find((b) => b.id === id) || null;
}
export function saveBook(book: Book): Book {
  const books = listBooks();
  const idx = books.findIndex((b) => b.id === book.id);
  if (idx >= 0) books[idx] = book;
  else books.unshift(book);
  write(KEYS.books, books);
  return book;
}
export function deleteBook(id: string): void {
  write(KEYS.books, listBooks().filter((b) => b.id !== id));
  write(KEYS.chapters, listChapters().filter((c) => c.bookId !== id));
  write(KEYS.plans, listPlans().filter((p) => p.bookId !== id));
  write(KEYS.sessions, listSessions().filter((s) => s.bookId !== id));
  write(KEYS.progress, listProgress().filter((p) => p.bookId !== id));
}

// ---------- Chapters ----------
export function listChapters(bookId?: string): Chapter[] {
  const all = read<Chapter>(KEYS.chapters);
  return bookId ? all.filter((c) => c.bookId === bookId) : all;
}
export function saveChapters(bookId: string, chapters: Chapter[]): void {
  const all = read<Chapter>(KEYS.chapters).filter((c) => c.bookId !== bookId);
  write(KEYS.chapters, [...all, ...chapters]);
}

// ---------- Plans ----------
export function listPlans(bookId?: string): ReadingPlan[] {
  const all = read<ReadingPlan>(KEYS.plans);
  return bookId ? all.filter((p) => p.bookId === bookId) : all;
}
export function getActivePlan(bookId: string): ReadingPlan | null {
  return listPlans(bookId).find((p) => p.status === 'active') || null;
}
export function savePlan(plan: ReadingPlan): ReadingPlan {
  const plans = read<ReadingPlan>(KEYS.plans);
  const idx = plans.findIndex((p) => p.id === plan.id);
  if (idx >= 0) plans[idx] = plan;
  else plans.push(plan);
  write(KEYS.plans, plans);
  return plan;
}

// ---------- Sessions ----------
function listProgress(): ReadingProgress[] {
  return read<ReadingProgress>(KEYS.progress);
}
export function listSessions(bookId?: string): ReadingSession[] {
  const all = read<ReadingSession>(KEYS.sessions);
  return bookId ? all.filter((s) => s.bookId === bookId) : all;
}
export function listSessionsForPlan(planId?: string): ReadingSession[] {
  if (!planId) return [];
  return read<ReadingSession>(KEYS.sessions).filter((s) => s.planId === planId).sort((a, b) => a.sessionNumber - b.sessionNumber);
}
export function saveSessions(sessions: ReadingSession[]): void {
  const all = read<ReadingSession>(KEYS.sessions);
  const map = new Map(all.map((s) => [s.id, s]));
  for (const s of sessions) map.set(s.id, s);
  write(KEYS.sessions, Array.from(map.values()));
}
export function saveSession(session: ReadingSession): ReadingSession {
  saveSessions([session]);
  return session;
}
export function replaceSessionsForPlan(planId: string, newSessions: ReadingSession[]): void {
  const all = read<ReadingSession>(KEYS.sessions).filter((s) => s.planId !== planId);
  write(KEYS.sessions, [...all, ...newSessions]);
}

// ---------- Progress ----------
export function getProgress(bookId: string): ReadingProgress | null {
  return listProgress().find((p) => p.bookId === bookId) || null;
}
export function saveProgress(progress: ReadingProgress): ReadingProgress {
  const all = listProgress().filter((p) => p.bookId !== progress.bookId);
  write(KEYS.progress, [...all, progress]);
  return progress;
}

// ---------- Settings ----------
const DEFAULT_SETTINGS: Settings = { theme: 'light', textSize: 18, highlightIntensity: 0.66, defaultSpeed: 1, voiceURI: null };
export function getSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const stored = localStorage.getItem(KEYS.settings);
  return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
}
export function saveSettings(settings: Settings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

// ---------- Export / Import ----------
export function exportAllData(): ExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    books: listBooks(),
    chapters: read<Chapter>(KEYS.chapters),
    plans: read<ReadingPlan>(KEYS.plans),
    sessions: read<ReadingSession>(KEYS.sessions),
    progress: listProgress(),
    settings: getSettings(),
  };
}
export function importAllData(data: Partial<ExportBundle>): void {
  if (data.books) write(KEYS.books, data.books);
  if (data.chapters) write(KEYS.chapters, data.chapters);
  if (data.plans) write(KEYS.plans, data.plans);
  if (data.sessions) write(KEYS.sessions, data.sessions);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.settings) saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
}
export function wipeAllData(): void {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
