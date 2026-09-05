'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileText, Check, Loader2 } from 'lucide-react';
import { analyzeFile } from '@/lib/analyzeFile';
import { saveFile, savePagesData } from '@/lib/db';
import { saveBook, saveChapters, savePlan, saveSessions, saveProgress, uid } from '@/lib/storage';
import { buildInitialPlan } from '@/lib/planner';
import type { BookAnalysis, Chapter, FileFormat } from '@/lib/types';

const STEPS = [
  { key: 'extract', label: 'Extraction du contenu' },
  { key: 'chapters', label: 'Détection des chapitres' },
  { key: 'done', label: 'Préparation du planning' },
] as const;

const DAY_OPTIONS = [3, 5, 7, 10, 14, 21, 30];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function AddBook() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [format, setFormat] = useState<FileFormat | null>(null);
  const [stepProgress, setStepProgress] = useState<Record<string, number>>({});
  const [analysis, setAnalysis] = useState<(BookAnalysis & { buffer: ArrayBuffer | null; guessedTitle: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(10);
  const [customDays, setCustomDays] = useState('');
  const [creating, setCreating] = useState(false);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    const f = fileList?.[0];
    if (!f) return;
    setError(null);
    setAnalysis(null);
    setFile({ name: f.name, size: f.size });
    setStepProgress({ extract: 0, chapters: 0, done: 0 });

    try {
      const { analysis: result, format: fmt, buffer } = await analyzeFile(f, (step, fraction) => {
        setStepProgress((prev) => ({ ...prev, [step]: fraction }));
      });
      setFormat(fmt);
      setAnalysis({ ...result, buffer, guessedTitle: result.title || f.name.replace(/\.(pdf|epub|txt)$/i, '') });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Impossible d'analyser ce fichier.";
      setError(message);
      setFile(null);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const finalDays = (): number => {
    const n = parseInt(customDays, 10);
    return customDays && n > 0 ? n : days;
  };

  const createBook = async () => {
    if (!analysis || !file || !format) return;
    setCreating(true);
    try {
      const bookId = uid();
      const targetDays = finalDays();
      const book = {
        id: bookId,
        title: analysis.guessedTitle,
        author: analysis.author,
        fileName: file.name,
        fileType: format,
        fileSize: file.size,
        totalPages: analysis.numPages,
        totalWords: analysis.totalWords,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active' as const,
        targetDate: null as string | null,
        targetDays,
      };

      if (analysis.buffer) await saveFile(bookId, analysis.buffer);
      await savePagesData(bookId, analysis.pages);

      if (analysis.chapters) {
        const chapters: Chapter[] = analysis.chapters.map((c, i) => ({ id: uid(), bookId, order: i, ...c }));
        saveChapters(bookId, chapters);
      }

      const startDate = new Date().toISOString().slice(0, 10);
      const { plan, sessions } = buildInitialPlan({ book, pages: analysis.pages, chapters: analysis.chapters, targetDays, startDate });
      book.targetDate = plan.targetDate;

      saveBook(book);
      savePlan(plan);
      saveSessions(sessions);
      saveProgress({ bookId, currentPage: 0, currentPosition: 0, percent: 0, lastReadAt: null });

      router.push(`/book/${bookId}`);
    } catch (e) {
      console.error(e);
      setError('Une erreur est survenue pendant la création du plan de lecture.');
      setCreating(false);
    }
  };

  const allStepsDone = analysis != null;

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 md:py-14 animate-fadeUp">
      <h1 className="font-display text-3xl mb-1">Ajouter un livre</h1>
      <p className="text-ink-soft dark:text-paper mb-8">Glisse ton PDF, EPUB ou TXT, on s&apos;occupe du reste.</p>

      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`card cursor-pointer flex flex-col items-center justify-center text-center py-16 px-6 border-2 border-dashed transition-colors ${
            dragOver ? 'border-ember bg-ember/[0.04]' : 'border-ink/15 dark:border-paper/15'
          }`}
        >
          <UploadCloud size={34} className="text-ink-faint mb-4" strokeWidth={1.4} />
          <p className="font-display text-xl mb-1">Glisse ton livre ici</p>
          <p className="text-sm text-ink-faint mb-5">ou clique pour choisir un fichier</p>
          <span className="btn-secondary !py-2 !px-5 text-sm">Choisir un fichier</span>
          <p className="label mt-6">PDF · EPUB · TXT</p>
          <input ref={inputRef} type="file" accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain" className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />
        </div>
      )}

      {error && <p className="mt-4 text-sm text-ember bg-ember/10 rounded-lg px-4 py-3">{error}</p>}

      {file && (
        <div className="card p-6 animate-fadeUp">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-ink/5 dark:bg-paper/10 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-ink-soft dark:text-paper" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{file.name}</p>
              <p className="text-xs text-ink-faint">{formatSize(file.size)} · {format?.toUpperCase()}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {STEPS.map(({ key, label }) => {
              const value = stepProgress[key] ?? 0;
              const complete = value >= 1;
              const active = !complete && value > 0;
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${complete ? 'bg-moss text-white' : ''}`}>
                    {complete ? <Check size={12} strokeWidth={3} /> : active ? <Loader2 size={13} className="animate-spin text-ember" /> : (
                      <div className="w-5 h-5 rounded-full bg-ink/[0.06] dark:bg-paper/10" />
                    )}
                  </div>
                  <span className={complete ? 'text-ink dark:text-paper' : 'text-ink-faint'}>{label}</span>
                </div>
              );
            })}
          </div>

          <AnimatePresence>
            {allStepsDone && analysis && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-6 pt-6 border-t border-ink/[0.06] dark:border-paper/[0.08]">
                <p className="label mb-1">Livre prêt</p>
                <h3 className="font-display text-xl mb-1">{analysis.guessedTitle}</h3>
                <p className="text-sm text-ink-faint mb-6">
                  {analysis.numPages} pages{analysis.chapters ? ` · ${analysis.chapters.length} chapitres détectés` : ' · pas de chapitres détectés (plan basé sur les pages)'}
                </p>

                <p className="font-display text-lg mb-3">En combien de jours veux-tu le terminer ?</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {DAY_OPTIONS.map((d) => (
                    <button key={d} onClick={() => { setDays(d); setCustomDays(''); }}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${days === d && !customDays ? 'bg-ink text-paper dark:bg-gold dark:text-nightpaper' : 'bg-ink/[0.05] dark:bg-paper/10 hover:bg-ink/[0.09]'}`}>
                      {d} jours
                    </button>
                  ))}
                  <input type="number" min="1" placeholder="Personnalisé" value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    className="w-28 px-4 py-2 rounded-full text-sm bg-ink/[0.05] dark:bg-paper/10 outline-none focus:ring-2 ring-ember/40" />
                </div>

                <button onClick={createBook} disabled={creating} className="btn-primary w-full mt-2">
                  {creating ? <Loader2 size={16} className="animate-spin" /> : null}
                  Créer mon plan
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
