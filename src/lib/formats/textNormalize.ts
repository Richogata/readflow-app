// Shared post-processing applied to text pulled out of any source format
// (PDF, EPUB, TXT). PDF and some EPUB fonts encode certain letter pairs as
// single "ligature" glyphs (ﬁ, ﬂ, ﬀ…) which render fine visually but are
// NOT the plain letters they look like — left alone they break search,
// word-splitting for the reader/TTS, and copy-paste. We decompose them
// back into normal letters here so every downstream feature (Focus mode
// word highlighting, text-to-speech, page word counts) sees real text.
const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};
const LIGATURE_RE = /[\uFB00-\uFB06]/g;

export function normalizeExtractedText(text: string): string {
  if (!text) return text;
  return text
    // Unicode-normalize first so accented letters that arrived as separate
    // base+combining-mark codepoints become the single composed character
    // (é vs e + ́) — otherwise the same word can look different across pages.
    .normalize('NFC')
    .replace(LIGATURE_RE, (ch) => LIGATURES[ch] || ch)
    // Non-breaking / narrow / zero-width spaces read fine but don't split
    // on `\s` the same way everywhere — fold them into regular spaces.
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
