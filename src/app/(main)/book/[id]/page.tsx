'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Trash2, ArrowRight, Clock } from 'lucide-react';
import { getBook, getActivePlan, listChapters, listSessionsForPlan, deleteBook, getProgress } from '@/lib/storage';
import { getPagesData, deleteFile, deletePagesData } from '@/lib/db';
import { getDashboardState, type DashboardState } from '@/lib/sessionEngine';
import { Cover } from '@/components/BookCard';
import type { Book, ReadingPlan, ReadingProgress, ReadingSession, SessionStatus } from '@/lib/types';

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [book, setBook] = useState<Book | null>(null);
  const [plan, setPlan] = useState<ReadingPlan | null>(null);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [state, setState] = useState<DashboardState | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const b = getBook(id);
    setBook(b);
    if (!b) { setLoaded(true); return; }
    (async () => {
      const p = getActivePlan(id);
      const chapters = listChapters(id);
      const pages = await getPagesData(id);
      const ds = getDashboardState({ book: b, pages, chapters, plan: p });
      const refreshedPlan = getActivePlan(id);
      setPlan(refreshedPlan);
      setSessions(listSessionsForPlan(refreshedPlan?.id));
      setState(ds);
      setProgress(getProgress(id));
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded) return null;

  if (!book) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-14 text-center text-ink-faint">
        Livre introuvable. <Link href="/library" className="text-ember">Retour à la bibliothèque</Link>
      </div>
    );
  }

  const percent = progress?.percent ?? 0;
  const nextSession = state?.session;

  const handleDelete = async () => {
    await deleteFile(id);
    await deletePagesData(id);
    deleteBook(id);
    router.push('/library');
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 md:py-14 animate-fadeUp">
      <button onClick={() => router.back()} className="btn-ghost !px-2 mb-6"><ArrowLeft size={17} /> Retour</button>

      <div className="flex gap-5 items-start mb-8">
        <Cover title={book.title} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight">{book.title}</h1>
          {book.author && <p className="text-ink-faint mt-1">{book.author}</p>}
          <p className="label mt-3">{book.totalPages} pages</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="progress-track flex-1"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
            <span className="label !text-ink-soft dark:!text-paper">{Math.round(percent)}%</span>
          </div>
        </div>
      </div>

      {nextSession && state?.kind !== 'finished' && (
        <div className="card p-5 mb-8">
          <p className="label mb-1.5">🎯 Prochaine session</p>
          <p className="font-display text-lg mb-1">{nextSession.chapterTitle ? `${nextSession.chapterTitle} · ` : ''}Pages {nextSession.startPage}–{nextSession.endPage}</p>
          <p className="text-sm text-ink-faint flex items-center gap-1.5 mb-4"><Clock size={13} /> ≈ {nextSession.estimatedMinutes} min</p>
          <button onClick={() => router.push(`/read/${book.id}?session=${nextSession.id}`)} className="btn-primary w-full">Commencer <ArrowRight size={16} /></button>
        </div>
      )}

      {plan && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="label">Plan de lecture</p>
            <p className="label">Objectif : {plan.targetDate}</p>
          </div>
          <div className="card divide-y divide-ink/[0.06] dark:divide-paper/[0.06]">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <StatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Jour {s.sessionNumber} · Pages {s.startPage}–{s.endPage}</p>
                  {s.chapterTitle && <p className="text-xs text-ink-faint truncate">{s.chapterTitle}</p>}
                </div>
                <span className="text-xs text-ink-faint shrink-0">{s.sessionDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-ink/[0.06] dark:border-paper/[0.08]">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="btn-ghost text-ember"><Trash2 size={15} /> Supprimer ce livre</button>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
            <p className="text-sm text-ink-faint">Supprimer définitivement ?</p>
            <button onClick={handleDelete} className="btn-secondary !text-ember !border-ember/30 !py-1.5 !px-3 text-sm">Oui, supprimer</button>
            <button onClick={() => setConfirmDelete(false)} className="btn-ghost !py-1.5 !px-3 text-sm">Annuler</button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: SessionStatus }) {
  if (status === 'completed') return <div className="w-6 h-6 rounded-full bg-moss/15 text-moss flex items-center justify-center shrink-0"><Check size={13} strokeWidth={3} /></div>;
  if (status === 'missed') return <div className="w-6 h-6 rounded-full bg-ember/15 text-ember flex items-center justify-center shrink-0 text-[11px] font-bold">!</div>;
  return <div className="w-6 h-6 rounded-full bg-ink/[0.06] dark:bg-paper/[0.08] shrink-0" />;
}
