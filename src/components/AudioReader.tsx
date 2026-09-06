'use client';

import { useEffect, useRef, useState } from 'react';
import WordHighlighter from './WordHighlighter';
import { findVoice, getVoices, isSpeechSupported, warmUpSpeech } from '@/lib/speech';

/** Max characters per utterance. Chrome's TTS gets flaky on very long
 * utterances (silent drops, missing onend), so the remaining text is queued
 * as sentence-boundary chunks that chain until the session ends. */
const MAX_CHUNK = 220;

export default function AudioReader({
  words, playing, rate, voiceURI, textSize, startIndex = 0, seekNonce = 0, onIndexChange, onPlayingChange, onEnd, onUnsupported,
}: {
  words: string[];
  playing: boolean;
  rate: number;
  voiceURI: string | null;
  textSize: number;
  startIndex?: number;
  /** Bumped by the parent on seek (skip buttons). Restarts speech from the
   * current startIndex without touching the playing state. */
  seekNonce?: number;
  onIndexChange?: (i: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onEnd?: () => void;
  onUnsupported?: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [prevStartIndex, setPrevStartIndex] = useState(startIndex);

  // All mutable state lives in a ref so the speech effect never re-runs on
  // unrelated re-renders (callback identities change constantly).
  const stateRef = useRef({
    index, playing, rate, voiceURI, words, startIndex,
    onIndexChange, onPlayingChange, onEnd, onUnsupported,
  });

  // Keep the ref in sync with latest props/state after every commit.
  // Declared before the speech effect so it runs first on every render.
  useEffect(() => {
    stateRef.current = {
      index, playing, rate, voiceURI, words, startIndex,
      onIndexChange, onPlayingChange, onEnd, onUnsupported,
    };
  });

  // Parent-driven seeks (skip buttons) must move the highlight immediately,
  // even while paused. Render-time adjustment is the supported pattern for
  // "reset state when a prop changes". Echoed updates from onboundary are
  // no-ops (startIndex already equals the internal index then).
  if (startIndex !== prevStartIndex) {
    setPrevStartIndex(startIndex);
    setIndex(startIndex);
  }

  const generationRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const offsetsRef = useRef<number[]>([]);
  const fromWordRef = useRef(0);
  const cursorRef = useRef(0);
  const startTimerRef = useRef<number | null>(null);
  const chainTimerRef = useRef<number | null>(null);
  const lastSpeakAtRef = useRef(0);

  // ── Speech lifecycle ──────────────────────────────────────
  // Re-runs only when playing / rate / voiceURI / seekNonce change. Every
  // async step is guarded by a generation counter: a restart (or unmount)
  // invalidates the previous run's timers and utterance handlers, so a
  // cancel() can never fire a stale onend or queue a stale chunk.
  useEffect(() => {
    const s = stateRef.current;
    const gen = ++generationRef.current;

    if (!isSpeechSupported()) {
      s.onUnsupported?.();
      return;
    }

    const synth = window.speechSynthesis;

    const clearTimers = () => {
      if (startTimerRef.current !== null) { clearTimeout(startTimerRef.current); startTimerRef.current = null; }
      if (chainTimerRef.current !== null) { clearTimeout(chainTimerRef.current); chainTimerRef.current = null; }
    };

    // ── STOP ─────────────────────────────────────────────
    if (!s.playing) {
      if (synth.speaking || synth.pending) synth.cancel();
      return;
    }

    // ── RESUME (paused externally, then play again) ──────
    if (synth.paused && synth.speaking) {
      synth.resume();
      return;
    }

    // ── START (from startIndex — where the highlight is) ─
    if (s.words.length === 0) return;

    const findWordIndex = (charIndex: number) => {
      const offsets = offsetsRef.current;
      let lo = 0, hi = offsets.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] <= charIndex) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return ans;
    };

    /** Build the chunk run for the remaining words starting at `from`. */
    const buildRun = (from: number) => {
      const remaining = stateRef.current.words.slice(from);
      const text = remaining.join(' ');
      const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
      const chunks: string[] = [];
      let cur = '';
      for (const sentence of sentences) {
        if (cur && cur.length + sentence.length > MAX_CHUNK) {
          chunks.push(cur);
          cur = '';
        }
        // A single sentence longer than MAX_CHUNK stays whole — cutting
        // mid-sentence hurts pronunciation more than length hurts stability.
        cur += sentence;
      }
      if (cur) chunks.push(cur);

      const offsets: number[] = [];
      let pos = 0;
      for (const w of remaining) {
        offsets.push(pos);
        pos += w.length + 1;
      }

      chunksRef.current = chunks;
      offsetsRef.current = offsets;
      fromWordRef.current = from;
      cursorRef.current = 0;
    };

    /** Speak the chunk at the cursor, chaining to the next one on end. */
    const speakChunk = () => {
      if (gen !== generationRef.current) return;
      const cur = stateRef.current;
      if (!cur.playing) return;
      // Engine busy → something is already queued. This makes the chunk
      // chain idempotent: the watchdog and the onend chain can never both
      // queue a chunk for the same gap.
      if (synth.speaking || synth.pending) return;

      const chunks = chunksRef.current;
      if (cursorRef.current >= chunks.length) {
        // Whole remaining text finished.
        const last = cur.words.length - 1;
        setIndex(last);
        cur.onIndexChange?.(last);
        cur.onPlayingChange?.(false);
        cur.onEnd?.();
        return;
      }

      const chunkIdx = cursorRef.current;
      const utter = new SpeechSynthesisUtterance(chunks[chunkIdx]);
      utter.rate = Math.min(3, Math.max(0.5, cur.rate));
      utter.lang = 'fr-FR';
      const voice = findVoice(synth.getVoices(), cur.voiceURI);
      if (voice) utter.voice = voice;

      // Chars consumed by earlier chunks, to map boundary charIndex onto
      // the remaining-words offset space.
      const chunkStartChar = chunks.slice(0, chunkIdx).reduce((a, c) => a + c.length, 0);

      utter.onboundary = (e) => {
        if (gen !== generationRef.current) return;
        if (e.name !== 'word') return;
        const wIdx = fromWordRef.current + findWordIndex(chunkStartChar + e.charIndex);
        setIndex(wIdx);
        stateRef.current.onIndexChange?.(wIdx);
      };

      utter.onend = () => {
        if (gen !== generationRef.current) return;
        cursorRef.current = chunkIdx + 1;
        // Small defer before queueing the next chunk: on some engines an
        // immediate re-speak from inside onend gets dropped.
        if (chainTimerRef.current !== null) clearTimeout(chainTimerRef.current);
        chainTimerRef.current = window.setTimeout(() => {
          if (gen !== generationRef.current) return;
          if (!stateRef.current.playing) return;
          speakChunk();
        }, 60);
      };

      utter.onerror = (e) => {
        if (gen !== generationRef.current) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.warn('[AudioReader] speech error:', e.error);
        stateRef.current.onPlayingChange?.(false);
      };

      lastSpeakAtRef.current = Date.now();
      synth.speak(utter);
    };

    // Chrome drops speak() called right after cancel() — even from a
    // microtask. Defer the first chunk with a real macrotask, and call
    // warmUpSpeech() to force engine init on the very first play. If the
    // warm-up is still in the queue when the timer fires, flush it first
    // and give Chrome another beat before speaking.
    warmUpSpeech();
    const beginRun = () => {
      if (gen !== generationRef.current) return;
      buildRun(Math.max(0, Math.min(s.words.length - 1, s.startIndex)));
      speakChunk();
    };
    startTimerRef.current = window.setTimeout(() => {
      if (gen !== generationRef.current) return;
      if (synth.speaking || synth.pending) {
        synth.cancel();
        startTimerRef.current = window.setTimeout(beginRun, 80);
        return;
      }
      beginRun();
    }, 120);

    // Watchdog: Chrome sometimes goes silent mid-session (throttling, a
    // silently dropped utterance, a lost onend). If the engine is idle while
    // we should still be speaking, restart at the cursor. The 1.5s guard
    // below a speak() call prevents double-queueing during normal chaining.
    const watchdog = window.setInterval(() => {
      if (gen !== generationRef.current) return;
      if (!stateRef.current.playing) return;
      if (cursorRef.current >= chunksRef.current.length) return;
      if (synth.speaking || synth.pending) return;
      if (Date.now() - lastSpeakAtRef.current < 1500) return;
      speakChunk();
    }, 4000);

    return () => {
      // Invalidate this run's async work. Pure assignment from the captured
      // gen (no read): a cancel() fired by this cleanup can never pass the
      // gen check of any live or future run.
      generationRef.current = gen + 1;
      clearInterval(watchdog);
      clearTimers();
      if (synth.speaking || synth.pending) synth.cancel();
    };
    // playing/rate/voiceURI/seekNonce restart speech; words.length lets a
    // pending start (empty text while loading) begin once text arrives.
    // The words array and callbacks live in stateRef — always fresh.
  }, [playing, rate, voiceURI, seekNonce, words.length]);

  // Warm up the speech engine once on mount, before any real utterance:
  // Chrome initialises TTS lazily and the first speak() can be silently
  // dropped or clipped without this.
  useEffect(() => {
    if (!isSpeechSupported()) return;
    let cancelled = false;
    getVoices().then(() => {
      if (cancelled) return;
      warmUpSpeech();
    });
    return () => { cancelled = true; };
  }, []);

  // Unmount must stop any ongoing speech.
  useEffect(() => () => {
    if (isSpeechSupported()) window.speechSynthesis.cancel();
  }, []);

  return <WordHighlighter words={words} index={index} textSize={textSize} />;
}
