import type { BookAnalysis, FileFormat } from './types';
import { analyzePdf, type ProgressFn } from './formats/pdf';
import { analyzeEpub } from './formats/epub';
import { analyzeTxt } from './formats/txt';

export function detectFormat(file: File): FileFormat | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/epub+zip' || name.endsWith('.epub')) return 'epub';
  if (file.type === 'text/plain' || name.endsWith('.txt')) return 'txt';
  return null;
}

export async function analyzeFile(file: File, onProgress: ProgressFn = () => {}): Promise<{ analysis: BookAnalysis; format: FileFormat; buffer: ArrayBuffer | null }> {
  const format = detectFormat(file);
  if (!format) throw new Error('Format non pris en charge. Utilise un PDF, un EPUB ou un fichier TXT.');

  if (file.size === 0) throw new Error('Ce fichier est vide.');

  if (format === 'pdf') {
    const buffer = await file.arrayBuffer();
    const analysis = await analyzePdf(buffer.slice(0), onProgress);
    return { analysis, format, buffer };
  }

  if (format === 'epub') {
    onProgress('extract', 0.1);
    const buffer = await file.arrayBuffer();
    const analysis = await analyzeEpub(buffer.slice(0));
    onProgress('extract', 1);
    onProgress('chapters', 1);
    onProgress('done', 1);
    return { analysis, format, buffer };
  }

  // txt
  onProgress('extract', 0.2);
  const text = await file.text();
  const guessedTitle = file.name.replace(/\.txt$/i, '');
  const analysis = await analyzeTxt(text, guessedTitle);
  onProgress('extract', 1);
  onProgress('chapters', 1);
  onProgress('done', 1);
  return { analysis, format, buffer: null };
}

export function estimateMinutes(wordCount: number): number {
  const WORDS_PER_MINUTE = 200;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
