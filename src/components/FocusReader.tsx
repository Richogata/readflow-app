'use client';

import { useEffect, useState } from 'react';
import WordHighlighter from './WordHighlighter';

const BASE_WPM = 260;

export default function FocusReader({
  words, playing, speed, textSize, startIndex = 0, onIndexChange, onEnd,
}: {
  words: string[];
  playing: boolean;
  speed: number;
  textSize: number;
  startIndex?: number;
  onIndexChange?: (i: number) => void;
  /** Fired once the reader reaches the last word. Does NOT complete the
   * session by itself — the user still has to press "Terminer" to
   * validate the session, per design. */
  onEnd?: () => void;
}) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= words.length - 1) return undefined;

    const word = words[index] || '';
    const lengthFactor = Math.min(1.6, 0.7 + word.length * 0.045);
    const punctuationPause = /[.,;:!?—]$/.test(word) ? 1.4 : 1;
    const msPerWord = (60000 / (BASE_WPM * speed)) * lengthFactor * punctuationPause;

    const t = setTimeout(() => {
      const next = index + 1;
      setIndex(next);
      onIndexChange?.(next);
      if (next >= words.length - 1) onEnd?.();
    }, msPerWord);
    return () => clearTimeout(t);
  }, [playing, index, speed, words, onIndexChange, onEnd]);

  return <WordHighlighter words={words} index={index} textSize={textSize} />;
}
