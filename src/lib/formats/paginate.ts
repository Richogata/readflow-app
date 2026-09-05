import type { DetectedChapter, ExtractedPage } from '../types';

const WORDS_PER_PAGE = 300;

export interface RawChapter {
  title: string;
  text: string;
}

/**
 * Turns a list of raw chapters (title + full text) into the common
 * {pages, chapters} shape used by the planner, by splitting each chapter's
 * text into ~300-word virtual pages. Used for EPUB and TXT, which have no
 * native page concept the way PDF does.
 */
export function paginateChapters(rawChapters: RawChapter[]): { pages: ExtractedPage[]; chapters: DetectedChapter[] | null } {
  const pages: ExtractedPage[] = [];
  const chapters: DetectedChapter[] = [];
  let pageNumber = 1;

  const meaningful = rawChapters.filter((c) => c.text.trim().length > 0);

  for (const chapter of meaningful) {
    const words = chapter.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const startPage = pageNumber;
    for (let i = 0; i < words.length; i += WORDS_PER_PAGE) {
      const chunk = words.slice(i, i + WORDS_PER_PAGE);
      pages.push({ pageNumber, text: chunk.join(' '), wordCount: chunk.length });
      pageNumber += 1;
    }
    const endPage = pageNumber - 1;
    chapters.push({ title: chapter.title, startPage, endPage });
  }

  // A single undifferentiated blob isn't a real chapter structure — let the
  // planner fall back to plain page-based bucketing in that case.
  const realStructure = chapters.length > 1;
  return { pages, chapters: realStructure ? chapters : null };
}
