// Modèle de données partagé (cf. cahier des charges §35 / architecture LOOP 0).
// "page" est une unité virtuelle de pagination (~300 mots) pour EPUB/TXT,
// et la vraie page PDF pour les fichiers PDF — le planificateur ne dépend
// que de ce contrat commun, pas du format source.

export type FileFormat = 'pdf' | 'epub' | 'txt';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  fileName: string;
  fileType: FileFormat;
  fileSize: number;
  totalPages: number;
  totalWords: number;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed';
  targetDate: string | null;
  targetDays: number;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  order: number;
  startPage: number;
  endPage: number;
}

export type PlanStatus = 'active' | 'completed';

export interface ReadingPlan {
  id: string;
  bookId: string;
  startDate: string;
  targetDate: string;
  targetDays: number;
  createdAt: string;
  updatedAt: string;
  status: PlanStatus;
}

export type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'missed';

export interface ReadingSession {
  id: string;
  planId: string;
  bookId: string;
  sessionDate: string; // YYYY-MM-DD
  sessionNumber: number;
  startPage: number;
  endPage: number;
  chapterTitle: string | null;
  chapterTitles: string[];
  estimatedMinutes: number;
  status: SessionStatus;
  completedAt: string | null;
  actualDuration: number | null;
}

export interface ReadingProgress {
  bookId: string;
  currentPage: number;
  currentPosition: number;
  percent: number;
  lastReadAt: string | null;
}

export interface Settings {
  theme: 'light' | 'dark';
  textSize: number;
  highlightIntensity: number;
  defaultSpeed: number;
  /** SpeechSynthesisVoice.voiceURI of the preferred read-aloud voice, or null for the browser default. */
  voiceURI: string | null;
}

/** A virtual/real "page" of extracted content, produced by any format extractor. */
export interface ExtractedPage {
  pageNumber: number;
  text: string;
  wordCount: number;
}

/** A detected chapter boundary, in page-number space. */
export interface DetectedChapter {
  title: string;
  startPage: number;
  endPage: number;
}

export interface BookAnalysis {
  title: string | null;
  author: string | null;
  numPages: number;
  totalWords: number;
  pages: ExtractedPage[];
  chapters: DetectedChapter[] | null;
}

export interface ExportBundle {
  exportedAt: string;
  books: Book[];
  chapters: Chapter[];
  plans: ReadingPlan[];
  sessions: ReadingSession[];
  progress: ReadingProgress[];
  settings: Settings;
}
