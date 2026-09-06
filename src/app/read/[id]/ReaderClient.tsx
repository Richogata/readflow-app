'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Pause, Play, SkipBack, SkipForward, Zap, Type, Sparkles, Headphones, CheckCircle2, Volume2, Moon, Sun } from 'lucide-react';
import { getBook, getActivePlan, listSessionsForPlan, saveSession, saveProgress, getProgress, getSettings, saveSettings, listChapters } from '@/lib/storage';
import { getPagesData } from '@/lib/db';
import FocusReader from '@/components/FocusReader';
import AudioReader from '@/components/AudioReader';
import { isSpeechSupported, getVoices, sortVoicesForPicker } from '@/lib/speech';
import type { Book, Chapter, ExtractedPage, ReadingSession } from '@/lib/types';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

/**
 * Split page text into paragraphs for book-like rendering.
 * Detects paragraph breaks from:
 * 1. Double newlines (explicit breaks)
 * 2. Single newlines followed by a capital letter or opening quote
 * 3. Falls back to treating the whole text as one paragraph
 */
function splitIntoParagraphs(text: string): string[] {
  if (!text) return [];

  // First try double newlines
  let paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  // Try single newlines before capital letters or quotes
  paragraphs = text.split(/\n(?=[A-ZÀÂÉÈÊËÎÏÔÖÙÛÜÇ"«])\s*/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  // Try single newlines followed by any letter (for lowercase starts)
  paragraphs = text.split(/\n(?=\p{L})/u).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  // Fallback: split long text at sentence boundaries for readability
  if (text.length > 600) {
    paragraphs = text.split(/(?<=[.!?…])\s+(?=[A-ZÀÂÉÈÊËÎÏÔÖÙÛÜÇ"])/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) return paragraphs;
  }

  return [text.trim()];
}

export default function ReaderClient() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const router = useRouter();

  const [book, setBook] = useState<Book | null>(null);
  const [session, setSession] = useState<ReadingSession | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [mode, setMode] = useState<'normal' | 'focus' | 'audio'>('normal');
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [textSize, setTextSize] = useState(18);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);
  // Bumped on every audio seek (skip buttons) so AudioReader restarts
  // speech from the new position even while it keeps playing.
  const [seekNonce, setSeekNonce] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [finished, setFinished] = useState(false);
  const [totalSessions, setTotalSessions] = useState(0);
  const [finalPercent, setFinalPercent] = useState(0);
  const [pagesData, setPagesData] = useState<ExtractedPage[]>([]);
  const [chaptersData, setChaptersData] = useState<Chapter[]>([]);
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [visualProgress, setVisualProgress] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const voicePickerRef = useRef<HTMLDivElement>(null);
  const speedPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const b = getBook(id);
    setBook(b);
    if (!b) { setLoading(false); return; }
    const p = getActivePlan(id);
    const sessions = listSessionsForPlan(p?.id);
    const s = sessions.find((x) => x.id === sessionId) || sessions.find((x) => x.status !== 'completed') || null;
    setSession(s);
    setTotalSessions(sessions.length);
    const settings = getSettings();
    setTextSize(settings.textSize);
    setVoiceURI(settings.voiceURI);
    setTheme(settings.theme);
    const idx = SPEEDS.indexOf(settings.defaultSpeed);
    setSpeedIdx(idx === -1 ? 2 : idx);

    const allChapters = listChapters(id);

    (async () => {
      try {
        const pages = await getPagesData(id);
        if (!s || cancelled) return;
        const relevant = pages
          .filter((pg) => pg.pageNumber >= s.startPage && pg.pageNumber <= s.endPage)
          .sort((a, b) => a.pageNumber - b.pageNumber);
        setPagesData(relevant);
        setChaptersData(allChapters.filter((ch) => ch.endPage >= s.startPage && ch.startPage <= s.endPage));
        const text = relevant.map((pg) => pg.text).join(' ').replace(/\s+/g, ' ').trim();
        setWords(text.split(' ').filter(Boolean));
      } catch (err) {
        console.error('Failed to load reading data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, sessionId]);

  // Load available voices once (Chrome/Edge loads them async).
  useEffect(() => {
    if (isSpeechSupported()) {
      getVoices().then((v) => setVoices(sortVoicesForPicker(v)));
    }
  }, []);

  // Close pickers on outside click.
  useEffect(() => {
    if (!showVoicePicker && !showSpeedPicker) return undefined;
    const handler = (e: MouseEvent) => {
      if (showVoicePicker && voicePickerRef.current && !voicePickerRef.current.contains(e.target as Node)) {
        setShowVoicePicker(false);
      }
      if (showSpeedPicker && speedPickerRef.current && !speedPickerRef.current.contains(e.target as Node)) {
        setShowSpeedPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVoicePicker, showSpeedPicker]);

  // Leaving audio mode (or the whole reader) must stop any ongoing speech —
  // otherwise the voice keeps talking over the "normal"/"focus" views.
  useEffect(() => {
    if (mode !== 'audio' && isSpeechSupported()) {
      window.speechSynthesis.cancel();
      setPlaying(false);
    }
  }, [mode]);

  const speed = SPEEDS[speedIdx];

  const persistProgress = useCallback((extraPercent: number) => {
    if (!book || !session) return;
    const prior = getProgress(book.id);
    const pageSpan = session.endPage - session.startPage + 1;
    const estPage = Math.min(session.endPage, session.startPage + Math.round(pageSpan * extraPercent));
    const percent = Math.min(100, Math.round((estPage / book.totalPages) * 100));
    if (percent >= (prior?.percent ?? 0)) {
      saveProgress({ bookId: book.id, currentPage: estPage, currentPosition: estPage, percent, lastReadAt: new Date().toISOString() });
    }
    return percent;
  }, [book, session]);

  const currentFraction = useCallback(() => {
    if (mode === 'focus') return focusIndex / Math.max(1, words.length - 1);
    if (mode === 'audio') return audioIndex / Math.max(1, words.length - 1);
    return null; // computed live from scroll position instead
  }, [mode, focusIndex, audioIndex, words.length]);

  const handleNormalScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const frac = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    persistProgress(frac);
    setVisualProgress(Math.min(100, Math.round(frac * 100)));
    if (frac > 0.96) setReachedEnd(true);

    // Track current chapter from scroll position
    if (chaptersData.length > 0 && pagesData.length > 0) {
      const totalWords = pagesData.reduce((s, pg) => s + pg.wordCount, 0);
      const wordsSoFar = Math.round(frac * totalWords);
      let wordsCounted = 0;
      for (const pg of pagesData) {
        wordsCounted += pg.wordCount;
        if (wordsCounted >= wordsSoFar) {
          const ch = chaptersData.find((c) => pg.pageNumber >= c.startPage && pg.pageNumber <= c.endPage);
          setCurrentChapterTitle(ch?.title || null);
          break;
        }
      }
    }
  };

  const handleReaderEnd = useCallback(() => {
    setPlaying(false);
    setReachedEnd(true);
  }, []);

  // The single source of truth for actually completing a session. Only
  // ever called from the confirmation dialog below, never from a scroll
  // position or a timer/speech "end" event — completion is always an
  // explicit, user-validated action.
  const confirmCompleteSession = () => {
    if (!session) return;
    if (isSpeechSupported()) window.speechSynthesis.cancel();
    setPlaying(false);
    const frac = currentFraction();
    const p = persistProgress(frac ?? 1);
    setFinalPercent(p ?? 0);
    saveSession({ ...session, status: 'completed', completedAt: new Date().toISOString(), actualDuration: null });
    setShowConfirm(false);
    setFinished(true);
  };

  const onExit = () => {
    const frac = currentFraction();
    if (frac !== null) persistProgress(frac);
    router.back();
  };

  const changeTextSize = (delta: number) => {
    const next = Math.min(28, Math.max(14, textSize + delta));
    setTextSize(next);
    saveSettings({ ...getSettings(), textSize: next });
  };

  const selectVoice = (uri: string | null) => {
    setVoiceURI(uri);
    saveSettings({ ...getSettings(), voiceURI: uri });
    setShowVoicePicker(false);
    // If playing, AudioReader restarts seamlessly from the current word
    // (its effect re-runs on voiceURI) — no need to stop playback.
  };

  const selectSpeed = (idx: number) => {
    setSpeedIdx(idx);
    saveSettings({ ...getSettings(), defaultSpeed: SPEEDS[idx] });
    setShowSpeedPicker(false);
    // Same as above: rate changes restart speech from the current word.
  };

  /** Skip ±15 words in audio mode: move the highlight immediately and bump
   * the seek nonce so speech restarts from the new position. */
  const seekAudio = (delta: number) => {
    setAudioIndex((i) => Math.min(words.length - 1, Math.max(0, i + delta)));
    setSeekNonce((n) => n + 1);
  };

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    saveSettings({ ...getSettings(), theme: next });
  };

  const currentVoiceName = voices.find((v) => v.voiceURI === voiceURI)?.name || 'Voix par défaut';

  // Update visual progress for focus/audio modes
  useEffect(() => {
    if (mode === 'focus') {
      const frac = focusIndex / Math.max(1, words.length - 1);
      setVisualProgress(Math.min(100, Math.round(frac * 100)));
    } else if (mode === 'audio') {
      const frac = audioIndex / Math.max(1, words.length - 1);
      setVisualProgress(Math.min(100, Math.round(frac * 100)));
    }
  }, [mode, focusIndex, audioIndex, words.length]);

  const dayLabel = session ? `Jour ${session.sessionNumber} / ${totalSessions}` : '';
  const currentPercent = Math.round((currentFraction() ?? 0) * 100);

  if (!book || !session || loading) {
    return <div className="max-w-2xl mx-auto px-5 py-14 text-ink-faint">Chargement de la session…</div>;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-paper dark:bg-nightpaper">
      <header className="flex items-center justify-between px-5 py-4 border-b border-ink/[0.06] dark:border-paper/[0.08] shrink-0">
        <button onClick={onExit} className="btn-ghost !px-2"><ArrowLeft size={18} /></button>
        <div className="text-center">
          <p className="text-sm font-medium truncate max-w-[50vw]">{book.title}</p>
          <p className="label">{dayLabel}</p>
          {currentChapterTitle && (
            <p className="text-xs text-ink-faint truncate max-w-[50vw] mt-0.5">{currentChapterTitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="btn-ghost !px-2" title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <div className="relative shrink-0">
        <div className="h-[3px] bg-ink/[0.06] dark:bg-paper/[0.08]">
          <div
            className="h-full bg-gradient-to-r from-ember to-gold transition-all duration-500 ease-out"
            style={{ width: `${visualProgress}%` }}
          />
        </div>
        <div className="absolute right-4 -top-6 flex items-center gap-2 text-[11px] font-mono text-ink-faint tabular-nums">
          <span>Pages {session.startPage}–{session.endPage}</span>
          <span className="text-ink-faint/50">·</span>
          <span>{visualProgress}%</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-b border-ink/[0.06] dark:border-paper/[0.08] shrink-0">
        <button onClick={() => setMode('normal')} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${mode === 'normal' ? 'bg-ink text-paper dark:bg-paper dark:text-nightpaper shadow-sm' : 'text-ink-soft hover:bg-ink/[0.06]'}`}>
          <Type size={15} /> Lecture
        </button>
        <button onClick={() => setMode('focus')} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${mode === 'focus' ? 'bg-ember text-paper shadow-sm' : 'text-ink-soft hover:bg-ink/[0.06]'}`}>
          <Sparkles size={15} /> Focus
        </button>
        <button onClick={() => { setMode('audio'); setPlaying(true); }} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${mode === 'audio' ? 'bg-moss text-paper shadow-sm' : 'text-ink-soft hover:bg-ink/[0.06]'}`}>
          <Headphones size={15} /> Audio
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {mode === 'normal' && (
          <div ref={scrollRef} onScroll={handleNormalScroll} className="h-full overflow-y-auto scrollbar-thin px-6 md:px-0 py-10">
            <div className="max-w-xl mx-auto font-body text-ink dark:text-paper leading-[1.85] tracking-[0.01em]" style={{ fontSize: `${textSize}px` }}>
              {(() => {
                const headings = new Map<number, string>();
                let prevTitle = '';
                for (const pg of pagesData) {
                  const ch = chaptersData.find((c) => pg.pageNumber >= c.startPage && pg.pageNumber <= c.endPage);
                  const title = ch?.title || '';
                  if (title && title !== prevTitle) {
                    headings.set(pg.pageNumber, title);
                    prevTitle = title;
                  }
                }
                let isFirstOfChapter = true;
                return pagesData.map((pg) => {
                  const paragraphs = splitIntoParagraphs(pg.text);
                  const hasChapterHeading = headings.has(pg.pageNumber);
                  const result = (
                    <div key={pg.pageNumber} className="mb-7">
                      {hasChapterHeading && (
                        <h3
                          id={`chapter-${pg.pageNumber}`}
                          className="font-display text-lg text-ink-soft dark:text-paper mb-5 pb-3 border-b border-ink/[0.08] dark:border-paper/[0.15] tracking-[0.02em]"
                        >
                          {headings.get(pg.pageNumber)}
                        </h3>
                      )}
                      {paragraphs.map((para, pi) => (
                        <p
                          key={pi}
                          className={`book-paragraph ${hasChapterHeading && pi === 0 ? 'first-of-chapter' : ''}`}
                          style={{ lineHeight: 1.85 }}
                        >
                          {para}
                        </p>
                      ))}
                    </div>
                  );
                  if (hasChapterHeading) isFirstOfChapter = false;
                  return result;
                });
              })()}
            </div>
            <div className="h-24" />
          </div>
        )}
        {mode === 'focus' && (
          <div className="h-full overflow-y-auto scrollbar-thin px-6 md:px-0 py-14">
            <div className="max-w-xl mx-auto">
              <FocusReader words={words} playing={playing} speed={speed} textSize={textSize} startIndex={focusIndex} onIndexChange={setFocusIndex} onEnd={handleReaderEnd} />
            </div>
          </div>
        )}
        {mode === 'audio' && (
          <div className="h-full overflow-y-auto scrollbar-thin px-6 md:px-0 py-14">
            <div className="max-w-xl mx-auto">
              {isSpeechSupported() ? (
                <AudioReader
                  words={words}
                  playing={playing}
                  rate={speed}
                  voiceURI={voiceURI}
                  textSize={textSize}
                  startIndex={audioIndex}
                  seekNonce={seekNonce}
                  onIndexChange={setAudioIndex}
                  onPlayingChange={setPlaying}
                  onEnd={handleReaderEnd}
                  onSeek={(i) => { setAudioIndex(i); setSeekNonce((n) => n + 1); }}
                />
              ) : (
                <p className="text-ink-faint text-sm text-center py-10">La lecture audio n&apos;est pas disponible sur ce navigateur.</p>
              )}
            </div>
          </div>
        )}

        {reachedEnd && !finished && (
          <div className="absolute bottom-3 inset-x-0 flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto bg-ink text-paper dark:bg-gold dark:text-nightpaper text-xs font-medium px-4 py-2 rounded-full shadow-lift flex items-center gap-2">
              <CheckCircle2 size={14} /> Tu es arrivé(e) au bout — appuie sur « Terminer » pour valider ta séance.
            </div>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-ink/[0.06] dark:border-paper/[0.08] px-5 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => changeTextSize(-1)} className="btn-ghost !px-2"><Minus size={15} /></button>
            <Type size={15} className="text-ink-faint" />
            <button onClick={() => changeTextSize(1)} className="btn-ghost !px-2"><Plus size={15} /></button>
          </div>

          {(mode === 'focus' || mode === 'audio') && (
            <div className="flex items-center gap-1">
              <button onClick={() => (mode === 'focus' ? setFocusIndex((i) => Math.max(0, i - 15)) : seekAudio(-15))} className="btn-ghost !px-2"><SkipBack size={16} /></button>
              <button onClick={() => setPlaying((p) => !p)} className="btn-primary !px-4 !py-2">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
              <button onClick={() => (mode === 'focus' ? setFocusIndex((i) => Math.min(words.length - 1, i + 15)) : seekAudio(15))} className="btn-ghost !px-2"><SkipForward size={16} /></button>

              {/* Speed picker */}
              <div className="relative" ref={speedPickerRef}>
                <button
                  onClick={() => { setShowSpeedPicker((v) => !v); setShowVoicePicker(false); }}
                  className={`btn-ghost !px-2.5 gap-1 text-xs font-mono ${showSpeedPicker ? '!bg-ink/[0.08] dark:!bg-paper/12' : ''}`}
                >
                  <Zap size={13} /> {speed}x
                </button>
                {showSpeedPicker && (
                  <div className="absolute bottom-full mb-2 right-0 w-48 card bg-paper dark:bg-nightpaper shadow-lift z-50 scrollbar-thin">
                    <div className="p-1.5">
                      <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-faint">Vitesse de lecture</p>
                      {SPEEDS.map((s, i) => (
                        <button
                          key={s}
                          onClick={() => selectSpeed(i)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${speedIdx === i ? 'bg-ink/[0.08] dark:bg-paper/10 font-medium' : 'hover:bg-ink/[0.05] dark:hover:bg-paper/5'}`}
                        >
                          <span>{s}x</span>
                          {speedIdx === i && <span className="text-moss text-xs">✓</span>}
                          {s === 1 && <span className="text-[10px] text-ink-faint">normal</span>}
                          {s === 2 && <span className="text-[10px] text-ink-faint">rapide</span>}
                          {s === 3 && <span className="text-[10px] text-ink-faint">très rapide</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {mode === 'audio' && (
                <div className="relative" ref={voicePickerRef}>
                  <button
                    onClick={() => { setShowVoicePicker((v) => !v); setShowSpeedPicker(false); }}
                    className={`btn-ghost !px-2.5 gap-1 text-xs ${showVoicePicker ? '!bg-ink/[0.08] dark:!bg-paper/12' : ''}`}
                    title={currentVoiceName}
                  >
                    <Volume2 size={14} />
                  </button>
                  {showVoicePicker && (
                    <div className="absolute bottom-full mb-2 right-0 w-64 max-h-72 overflow-y-auto card bg-paper dark:bg-nightpaper shadow-lift z-50 scrollbar-thin">
                      <div className="p-1.5">
                        <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-faint">Choisir une voix</p>
                        <button
                          onClick={() => selectVoice(null)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${!voiceURI ? 'bg-ink/[0.08] dark:bg-paper/10 font-medium' : 'hover:bg-ink/[0.05] dark:hover:bg-paper/5'}`}
                        >
                          Voix par défaut du navigateur
                        </button>
                        {voices.map((v) => (
                          <button
                            key={v.voiceURI}
                            onClick={() => selectVoice(v.voiceURI)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${voiceURI === v.voiceURI ? 'bg-ink/[0.08] dark:bg-paper/10 font-medium' : 'hover:bg-ink/[0.05] dark:hover:bg-paper/5'}`}
                          >
                            <span className="block truncate">{v.name}</span>
                            <span className="text-[11px] text-ink-faint">{v.lang}</span>
                          </button>
                        ))}
                        {voices.length === 0 && (
                          <p className="px-3 py-2 text-xs text-ink-faint">Aucune voix détectée…</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button onClick={() => setShowConfirm(true)} className="btn-primary !py-2.5 !px-5 text-sm gap-2"><CheckCircle2 size={15} /> Terminer</button>
        </div>
      </footer>

      <AnimatePresence>
        {showConfirm && (
          <ConfirmSessionOverlay
            percent={currentPercent}
            reachedEnd={reachedEnd}
            onConfirm={confirmCompleteSession}
            onCancel={() => setShowConfirm(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {finished && <SessionCompleteOverlay percent={finalPercent} onClose={() => router.push(`/book/${book.id}`)} />}
      </AnimatePresence>
    </div>
  );
}

function ConfirmSessionOverlay({
  percent, reachedEnd, onConfirm, onCancel,
}: { percent: number; reachedEnd: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-6">
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card bg-paper dark:bg-nightpaper max-w-sm w-full p-8 text-center">
        <h2 className="font-display text-2xl mb-2">Valider cette séance ?</h2>
        <p className="text-ink-soft dark:text-paper mb-6">
          {reachedEnd
            ? `Tu as parcouru le texte prévu pour aujourd'hui (${percent}%). Confirme pour enregistrer ta séance comme terminée.`
            : `Tu n'as parcouru que ${percent}% du texte prévu. Marquer quand même la séance comme terminée ?`}
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-ghost flex-1 !py-2.5">Continuer à lire</button>
          <button onClick={onConfirm} className="btn-primary flex-1 !py-2.5">Confirmer</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SessionCompleteOverlay({ percent, onClose }: { percent: number; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-6">
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card bg-paper dark:bg-nightpaper max-w-sm w-full p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-moss/15 text-moss flex items-center justify-center mx-auto mb-5 text-2xl">✅</div>
        <h2 className="font-display text-2xl mb-2">Session terminée</h2>
        <p className="text-ink-soft dark:text-paper mb-6">Tu as terminé la lecture prévue pour aujourd&apos;hui. Progression : {percent}%.</p>
        <button onClick={onClose} className="btn-primary w-full">Continuer</button>
      </motion.div>
    </motion.div>
  );
}
