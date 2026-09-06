'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import WordHighlighter from './WordHighlighter';
import { findVoice, getVoices, isSpeechSupported, warmUpSpeech } from '@/lib/speech';

/** Max characters per utterance. Chrome's TTS gets flaky on very long
 * utterances (silent drops, missing onend), so the remaining text is queued
 * as sentence-boundary chunks that chain until the session ends. */
const MAX_CHUNK = 220;

export default function AudioReader({
  words, playing, rate, voiceURI, textSize, startIndex = 0, seekNonce = 0, onIndexChange, onPlayingChange, onEnd, onUnsupported, onSeek,
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
  onSeek?: (wordIndex: number) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [prevStartIndex, setPrevStartIndex] = useState(startIndex);
  const [fraction, setFraction] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pace, setPace] = useState<number | null>(null);

  // All mutable state lives in a ref so the speech effect never re-runs on
  // unrelated re-renders (callback identities change constantly).
  const stateRef = useRef({
    index, playing, rate, voiceURI, words, startIndex,
    onIndexChange, onPlayingChange, onEnd, onUnsupported, onSeek,
    fraction, setFraction,
    elapsed, setElapsed,
    pace, setPace,
  });

  // Keep the ref in sync with latest props/state after every commit.
  // Declared before the speech effect so it runs first on every render.
  useEffect(() => {
    stateRef.current = {
      index, playing, rate, voiceURI, words, startIndex,
      onIndexChange, onPlayingChange, onEnd, onUnsupported, onSeek,
      fraction, setFraction,
      elapsed, setElapsed,
      pace, setPace,
    };
  });

  // Parent-driven seeks (skip buttons) must move the highlight immediately,
  // even while paused. Reset the progress readout when a top-level prop
  // like startIndex changes, so a skip restart does not inherit stale
  // elapsed/pace from a previous run.
  const [overlayX, setOverlayX] = useState<number | null>(null);

  if (startIndex !== prevStartIndex) {
    setPrevStartIndex(startIndex);
    setIndex(startIndex);
    setFraction(startIndex / Math.max(1, words.length - 1));
    setElapsed(0);
    setPace(null);
    setOverlayX(null);
  }

  const seekToFractionLocal = useCallback((f: number) => {
    const i = Math.max(0, Math.min(words.length - 1, Math.round(f * (words.length - 1))));
    const s = stateRef.current;
    s.onSeek?.(i);
    s.onIndexChange?.(i);
  }, [words.length]);

  const generationRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const offsetsRef = useRef<number[]>([]);
  const fromWordRef = useRef(0);
  const cursorRef = useRef(0);
  const startTimerRef = useRef<number | null>(null);
  const chainTimerRef = useRef<number | null>(null);
  const lastSpeakAtRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const lastPercentAtRef = useRef<number>(0);

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

    // tick elapsed + pace every second while playing
    // tick elapsed + pace every second while playing
    const tickTimer = window.setInterval(() => {
      if (gen !== generationRef.current) return;
      if (!stateRef.current.playing) return;
      const now = Date.now();
      stateRef.current.setElapsed(now - startTimeRef.current);
      if (now - lastPercentAtRef.current < 600) return;
      lastPercentAtRef.current = now;
      const frac = stateRef.current.index / Math.max(1, stateRef.current.words.length - 1);
      stateRef.current.setFraction(frac);
      const seconds = Math.max(1, (now - startTimeRef.current) / 1000);
      const wordsPh = ((stateRef.current.index - startIndex) / seconds) * 60;
      stateRef.current.setPace(wordsPh > 0 ? Math.round(wordsPh) : null);
    }, 1000);

    // ── STOP ─────────────────────────────────────────────
    if (!s.playing) {
      clearInterval(tickTimer);
      if (synth.speaking || synth.pending) synth.cancel();
      return;
    }

    // ── RESUME (paused externally, then play again) ──────
    if (synth.paused && synth.speaking) {
      synth.resume();
      return;
    }

    // ── START (from startIndex — where the highlight is) ─
    if (s.words.length === 0) {
      clearInterval(tickTimer);
      return;
    }

    // Chrome drops speak() called right after cancel() — even from a
    // microtask. Defer the first chunk with a real macrotask, and call
    // warmUpSpeech() to force engine init on the very first play. If the
    // warm-up is still in the queue when the timer fires, flush it first
    // and give Chrome another beat before speaking.
    warmUpSpeech();

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
      clearInterval(tickTimer);
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

  const trackRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      {words.length > 0 && (
        <div className="flex items-center gap-3 px-5 py-1.5 rounded-lg text-[11px] font-mono tabular-nums"
          style={{ background: 'rgba(255,255,255,0.04)', color: '#a0aec0' }}>
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
            <span className="truncate">
              {stateRef.current.words[stateRef.current.index]?.slice(0, 40) || ''}
            </span>
          </span>
          <span className="text-[10px] text-emerald-400/80 shrink-0">
            {Math.round(fraction * 100)}%
          </span>
          <div className="flex-1 min-w-[80px] h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-amber-400/70 transition-[width] duration-150"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-white/60">
            {elapsed < 60000
              ? `${Math.round(elapsed / 60000 * 100) / 100}m ${Math.round((elapsed % 60000) / 1000)}s`
              : `${Math.round(elapsed / 60000)}mn`}
            {pace != null && ` · ${pace}w/min`}
          </span>
        </div>
      )}
      <WordHighlighter words={words} index={index} textSize={textSize} />

      {/* Scrub strip: click or keyboard to seek inside audio mode. */}
      {words.length > 1 && (
        <div
          ref={(t) => { if (t) trackRef.current = t; }}
          role="slider"
          aria-label="Progression de la lecture audio"
          aria-valuemin={0}
          aria-valuemax={words.length - 1}
          aria-valuenow={index}
          tabIndex={0}
          onKeyDown={(e) => {
            const steps = words.length - 1;
            if (e.key === 'ArrowLeft') { e.preventDefault(); seekToFractionLocal(Math.max(0, index / steps - 0.01)); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); seekToFractionLocal(Math.min(1, (index + 1) / steps)); }
            else if (e.key === 'Home') { e.preventDefault(); seekToFractionLocal(0); }
            else if (e.key === 'End') { e.preventDefault(); seekToFractionLocal(1); }
          }}
          onPointerDown={(e) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seekToFractionLocal(f);
            const overlayPx = f * rect.width;
            setOverlayX(overlayPx);
          }}
        >
          <div className="mt-2 h-1 w-full rounded-full bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-amber-400/70 transition-[width] duration-150"
              style={{ width: `${fraction * 100}%` }}
            />
            {overlayX != null && (
              <div
                className="absolute top-0 h-full w-0.5 bg-white/90 shadow transition-[left,opacity] duration-150"
                style={{ left: `${overlayX}px`, opacity: 0.9 }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
