'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import WordHighlighter from './WordHighlighter';
import { findVoice, isSpeechSupported } from '@/lib/speech';

export default function AudioReader({
  words, playing, rate, voiceURI, textSize, startIndex = 0, onIndexChange, onPlayingChange, onEnd, onUnsupported,
}: {
  words: string[];
  playing: boolean;
  rate: number;
  voiceURI: string | null;
  textSize: number;
  startIndex?: number;
  onIndexChange?: (i: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onEnd?: () => void;
  onUnsupported?: () => void;
}) {
  const [index, setIndex] = useState(startIndex);

  // All mutable state lives in refs so the speech effect never needs to
  // re-run due to stale closures or changing callback identities.
  const stateRef = useRef({
    index, playing, rate, voiceURI, words,
    onIndexChange, onPlayingChange, onEnd, onUnsupported,
  });

  // Keep refs in sync with latest props/state on every render
  stateRef.current = {
    index, playing, rate, voiceURI, words,
    onIndexChange, onPlayingChange, onEnd, onUnsupported,
  };

  // Single effect: starts, stops, restarts speech. Dependencies are only
  // values that should actually restart speech: playing, rate, voiceURI.
  // Everything else (words, callbacks) is read from stateRef.current.
  useEffect(() => {
    const s = stateRef.current;

    if (!isSpeechSupported()) {
      s.onUnsupported?.();
      return;
    }

    const synth = window.speechSynthesis;

    // ── STOP ──────────────────────────────────────────────
    if (!s.playing) {
      if (synth.speaking) synth.cancel();
      return;
    }

    // ── RESUME (paused then play again) ──────────────────
    if (synth.paused && synth.speaking) {
      synth.resume();
      return;
    }

    // ── START ─────────────────────────────────────────────
    if (s.words.length === 0) return;

    const fullText = s.words.join(' ');

    const utter = new SpeechSynthesisUtterance(fullText);
    utter.rate = Math.min(3, Math.max(0.5, s.rate));
    utter.lang = 'fr-FR';

    const voice = findVoice(synth.getVoices(), s.voiceURI);
    if (voice) utter.voice = voice;

    // Build word-offset map for boundary tracking
    const offsets: number[] = [];
    let pos = 0;
    for (const w of s.words) {
      offsets.push(pos);
      pos += w.length + 1;
    }

    const findWordIndex = (charIndex: number) => {
      let lo = 0, hi = offsets.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] <= charIndex) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return ans;
    };

    utter.onboundary = (e) => {
      if (e.name !== 'word') return;
      const wIdx = findWordIndex(e.charIndex);
      setIndex(wIdx);
      stateRef.current.onIndexChange?.(wIdx);
    };

    utter.onend = () => {
      const cur = stateRef.current;
      const last = cur.words.length - 1;
      setIndex(last);
      cur.onIndexChange?.(last);
      cur.onPlayingChange?.(false);
      cur.onEnd?.();
    };

    utter.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('[AudioReader] speech error:', e.error);
      stateRef.current.onPlayingChange?.(false);
    };

    // Chrome fix: speak() sometimes silently fails right after cancel().
    // Calling speak() in a microtask gives Chrome time to process the cancel.
    synth.cancel();
    Promise.resolve().then(() => {
      if (stateRef.current.playing) {
        synth.speak(utter);
      }
    });

    // Chrome workaround: speech synthesis throttles after ~15s of silence.
    // Periodically pause+resume to keep the engine alive.
    const keepAlive = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10000);

    return () => {
      clearInterval(keepAlive);
      synth.cancel();
    };
    // Only react to playing / rate / voiceURI changes.
    // Words and callbacks are read from stateRef — always fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate, voiceURI]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (isSpeechSupported()) window.speechSynthesis.cancel();
  }, []);

  return <WordHighlighter words={words} index={index} textSize={textSize} />;
}
