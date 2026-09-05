import { describe, it, expect } from 'vitest';
import { normalizeExtractedText } from '../formats/textNormalize';

describe('normalizeExtractedText', () => {
  it('decomposes typographic ligatures into plain letters', () => {
    expect(normalizeExtractedText('di\uFB03cile')).toBe('difficile');
    expect(normalizeExtractedText('\uFB01n de chapitre')).toBe('fin de chapitre');
  });

  it('folds non-breaking and zero-width spaces into regular spaces', () => {
    expect(normalizeExtractedText('mot\u00A0suivant')).toBe('mot suivant');
    expect(normalizeExtractedText('mot\u200Bsuivant')).toBe('motsuivant');
  });

  it('composes decomposed accented letters (NFC)', () => {
    const decomposed = 'e\u0301'; // e + combining acute accent
    expect(normalizeExtractedText(decomposed)).toBe('é');
  });

  it('collapses repeated spaces/tabs without touching newlines', () => {
    expect(normalizeExtractedText('mot1   mot2\tmot3')).toBe('mot1 mot2 mot3');
  });
});
