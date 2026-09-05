import type { BookAnalysis } from '../types';
import { paginateChapters, type RawChapter } from './paginate';
import { normalizeExtractedText } from './textNormalize';

const HEADING_RE = /^(chapitre|chapter|partie|part)\s+([0-9ivxlc]+|[a-zàâéèêëîïôöùûüç]+)\b.*$/i;

function detectChapters(fullText: string): RawChapter[] {
  const lines = fullText.split(/\r?\n/);
  const chapters: RawChapter[] = [];
  let current: RawChapter | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 80 && HEADING_RE.test(trimmed)) {
      if (current) chapters.push(current);
      current = { title: trimmed, text: '' };
    } else if (current) {
      current.text += line + '\n';
    } else {
      // Content before the first detected heading — keep as an intro chapter.
      current = { title: 'Introduction', text: line + '\n' };
    }
  }
  if (current) chapters.push(current);

  return chapters.length ? chapters : [{ title: 'Texte', text: fullText }];
}

export async function analyzeTxt(text: string, guessedTitle: string): Promise<BookAnalysis> {
  // normalizeExtractedText only folds spaces/tabs and special Unicode
  // space/ligature characters — it deliberately leaves \n alone so chapter
  // detection (which is line-based) keeps working unchanged. It does trim
  // the very start/end of the file, which is harmless here.
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => normalizeExtractedText(line))
    .join('\n');
  const rawChapters = detectChapters(cleaned);
  const { pages, chapters } = paginateChapters(rawChapters);
  const totalWords = pages.reduce((s, p) => s + p.wordCount, 0);

  return {
    title: guessedTitle,
    author: null,
    numPages: pages.length,
    totalWords,
    pages,
    chapters,
  };
}
