import JSZip from 'jszip';
import type { BookAnalysis } from '../types';
import { paginateChapters, type RawChapter } from './paginate';
import { normalizeExtractedText } from './textNormalize';

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// Block-level tags whose boundaries must never be silently glued together.
// Without this, `<p>Hello</p><p>World</p>` (or bold/em spans across a line
// break) collapses to "textContent" concatenation and produces "HelloWorld"
// instead of "Hello World" — a subtle but very visible letter-formation bug
// once the reader/TTS hits that seam.
const BLOCK_TAGS = new Set(['P', 'DIV', 'BR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TD', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HR']);

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style').forEach((el) => el.remove());
  doc.body?.querySelectorAll('*').forEach((el) => {
    if (BLOCK_TAGS.has(el.tagName)) {
      el.insertAdjacentText('beforebegin', ' ');
      el.insertAdjacentText('afterend', ' ');
    }
  });
  return normalizeExtractedText(doc.body?.textContent || '');
}

function firstHeading(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h = doc.querySelector('h1,h2,h3,title');
  const t = h?.textContent?.trim();
  return t && t.length > 0 && t.length < 140 ? t : null;
}

export async function analyzeEpub(arrayBuffer: ArrayBuffer): Promise<BookAnalysis> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('EPUB invalide : container.xml introuvable');
  const containerDoc = parseXml(containerXml);
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('EPUB invalide : rootfile introuvable');

  const opfText = await zip.file(rootfilePath)?.async('text');
  if (!opfText) throw new Error('EPUB invalide : fichier OPF introuvable');
  const opfDoc = parseXml(opfText);
  const basePath = rootfilePath.includes('/') ? rootfilePath.slice(0, rootfilePath.lastIndexOf('/') + 1) : '';

  const title = opfDoc.querySelector('metadata > title, dc\\:title')?.textContent?.trim() || null;
  const author = opfDoc.querySelector('metadata > creator, dc\\:creator')?.textContent?.trim() || null;

  const manifest = new Map<string, string>();
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, decodeURIComponent(href));
  });

  const spineIds: string[] = [];
  opfDoc.querySelectorAll('spine > itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref');
    if (idref) spineIds.push(idref);
  });

  if (spineIds.length === 0) throw new Error('EPUB invalide : spine vide');

  const rawChapters: RawChapter[] = [];
  let index = 0;
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const fullPath = basePath + href;
    const file = zip.file(fullPath) || zip.file(decodeURIComponent(fullPath));
    if (!file) continue;
    const html = await file.async('text');
    const text = htmlToText(html);
    if (!text) continue;
    index += 1;
    const chapterTitle = firstHeading(html) || `Chapitre ${index}`;
    rawChapters.push({ title: chapterTitle, text });
  }

  if (rawChapters.length === 0) throw new Error('EPUB invalide : aucun contenu lisible trouvé');

  const { pages, chapters } = paginateChapters(rawChapters);
  const totalWords = pages.reduce((s, p) => s + p.wordCount, 0);

  return {
    title,
    author,
    numPages: pages.length,
    totalWords,
    pages,
    chapters,
  };
}
