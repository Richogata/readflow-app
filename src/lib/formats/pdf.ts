import type { BookAnalysis, DetectedChapter, ExtractedPage } from '../types';
import { normalizeExtractedText } from './textNormalize';

export type ProgressFn = (step: 'extract' | 'chapters' | 'done', fraction: number) => void;

interface OutlineItem {
  title?: string;
  dest?: unknown;
  items?: OutlineItem[];
}
interface PdfDocumentLike {
  getOutline(): Promise<OutlineItem[] | null>;
  getDestination(name: string): Promise<unknown>;
  getPageIndex(ref: unknown): Promise<number>;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
  hasEOL?: boolean;
}

/**
 * pdf.js splits a page into many small text runs — often mid-word, e.g. a
 * bold/italic span, a kerning adjustment, or a column of a table. Blindly
 * joining every run with a space (the old behaviour) breaks words apart
 * ("impor tant"); blindly concatenating with nothing glues separate words
 * together ("wordanother"). Instead we look at the actual horizontal gap
 * between consecutive runs — a real inter-word space is much wider than
 * the tiny gaps kerning/style-splits leave — and only insert a space when
 * that gap is wide enough relative to the current font size. Line breaks
 * (`hasEOL`) get their own handling so that a word hyphenated across two
 * lines ("exam-\nple") is rejoined into "example" instead of "exam- ple".
 */
function joinPageText(items: PdfTextItem[]): string {
  let out = '';
  let hasPrev = false;
  let prevHasEOL = false;
  let prevEndX = 0;
  let prevFontSize = 10;

  for (const item of items) {
    const str = item.str;
    const fontSize = Math.hypot(item.transform[0], item.transform[1]) || prevFontSize;
    const startX = item.transform[4];

    if (str) {
      if (hasPrev) {
        if (prevHasEOL) {
          const hyphenBreak = /\p{L}-$/u.test(out) && /^\p{Ll}/u.test(str);
          if (hyphenBreak) {
            out = out.slice(0, -1); // drop the line-break hyphen, glue directly
          } else if (!/\s$/.test(out) && !/^\s/.test(str)) {
            out += ' ';
          }
        } else {
          const gap = startX - prevEndX;
          const needsSpace = !/\s$/.test(out) && !/^\s/.test(str) && gap > prevFontSize * 0.16;
          if (needsSpace) out += ' ';
        }
      }
      out += str;
      prevEndX = startX + (item.width ?? str.length * fontSize * 0.5);
      prevFontSize = fontSize;
      hasPrev = true;
      prevHasEOL = !!item.hasEOL;
    } else if (item.hasEOL && hasPrev) {
      // Empty end-of-line marker item — still carries line-break info.
      prevHasEOL = true;
    }
  }

  return out;
}

export async function analyzePdf(arrayBuffer: ArrayBuffer, onProgress: ProgressFn = () => {}): Promise<BookAnalysis> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  onProgress('extract', 0);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const meta = await pdf.getMetadata().catch(() => null);
  const info: Record<string, unknown> = (meta?.info as Record<string, unknown>) || {};

  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter((it) => 'str' in it) as unknown as PdfTextItem[];
    const text = normalizeExtractedText(joinPageText(items));
    const wordCount = text ? text.split(' ').filter(Boolean).length : 0;
    pages.push({ pageNumber: i, text, wordCount });
    onProgress('extract', i / numPages);
  }

  onProgress('chapters', 0);
  const chapters = await extractChapters(pdf as unknown as PdfDocumentLike, numPages);
  onProgress('chapters', 1);
  onProgress('done', 1);

  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);
  const title = typeof info.Title === 'string' ? info.Title.trim() : null;
  const author = typeof info.Author === 'string' ? info.Author.trim() : null;

  return { title: title || null, author: author || null, numPages, totalWords, pages, chapters };
}

async function extractChapters(pdf: PdfDocumentLike, numPages: number): Promise<DetectedChapter[] | null> {
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length === 0) return null;

    const flat: { title: string; pageNumber: number }[] = [];
    const flatten = async (items: OutlineItem[]) => {
      for (const item of items) {
        let pageNumber: number | null = null;
        try {
          let dest = item.dest;
          if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest)) {
            const ref = dest[0];
            pageNumber = (await pdf.getPageIndex(ref)) + 1;
          }
        } catch {
          pageNumber = null;
        }
        if (pageNumber) flat.push({ title: item.title?.trim() || 'Chapitre', pageNumber });
        if (item.items?.length) await flatten(item.items);
      }
    };
    await flatten(outline);
    if (flat.length === 0) return null;

    flat.sort((a, b) => a.pageNumber - b.pageNumber);
    const deduped: { title: string; pageNumber: number }[] = [];
    for (const c of flat) {
      if (!deduped.length || deduped[deduped.length - 1].pageNumber !== c.pageNumber) deduped.push(c);
    }

    const chapters: DetectedChapter[] = deduped
      .map((c, i) => ({
        title: c.title,
        startPage: c.pageNumber,
        endPage: i + 1 < deduped.length ? deduped[i + 1].pageNumber - 1 : numPages,
      }))
      .filter((c) => c.endPage >= c.startPage);

    return chapters.length ? chapters : null;
  } catch {
    return null;
  }
}
