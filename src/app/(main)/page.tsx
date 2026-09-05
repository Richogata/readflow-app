'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { listBooks, getActivePlan, listChapters } from '@/lib/storage';
import { getPagesData } from '@/lib/db';
import { getDashboardState, acceptProposal, type DashboardState } from '@/lib/sessionEngine';
import { getBookStatus } from '@/lib/bookStatus';
import { Cover } from '@/components/BookCard';
import EmptyState from '@/components/EmptyState';
import type { Book } from '@/lib/types';

function pickCurrentBook(books: Book[]): Book | null {
  const withState = books.map((book) => ({ book, status: getBookStatus(book) }));
  const active = withState.filter(({ status }) => status.status !== 'done');
  if (active.length) {
    active.sort((a, b) => new Date(b.book.updatedAt || 0).getTime() - new Date(a.book.updatedAt || 0).getTime());
    return active[0].book;
  }
  return books[0] || null;
}

export default function Dashboard() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [state, setState] = useState<DashboardState | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const all = listBooks();
    setBooks(all);
    const current = pickCurrentBook(all);
    setBook(current);
    if (!current) { setLoaded(true); return; }
    (async () => {
      const plan = getActivePlan(current.id);
      const chapters = listChapters(current.id);
      const pages = await getPagesData(current.id);
      const ds = getDashboardState({ book: current, pages, chapters, plan });
      setState(ds);
      setLoaded(true);
    })();
  }, []);

  const finishedCount = useMemo(() => books.filter((b) => getBookStatus(b).status === 'done').length, [books]);

  if (!loaded) return null;

  if (books.length === 0) {
    return <EmptyState title="Ton espace de lecture" subtitle="Ajoute ton premier livre et ReadFlow construira ton parcours de lecture, jour après jour." />;
  }
  if (!book) return null;

  const { percent } = getBookStatus(book);

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 md:py-14 animate-fadeUp">
      <p className="label mb-1">Bonjour 👋</p>
      <h1 className="font-display text-3xl mb-8">Ta lecture d&apos;aujourd&apos;hui</h1>

      <div className="card p-6 md:p-7">
        <div className="flex gap-4 items-start mb-6">
          <Cover title={book.title} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-snug">{book.title}</h2>
            {book.author && <p className="text-sm text-ink-faint mt-0.5">{book.author}</p>}
            <div className="mt-3 flex items-center gap-3">
              <div className="progress-track flex-1 max-w-[160px]">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="label !text-ink-soft dark:!text-paper">{Math.round(percent)}%</span>
            </div>
          </div>
        </div>

        <SessionBody book={book} state={state} onNavigateRead={(url) => router.push(url)} />
      </div>

      <div className="flex items-center justify-between mt-8 px-1">
        <Link href="/library" className="btn-ghost">📚 {books.length} livre{books.length > 1 ? 's' : ''}</Link>
        <span className="label flex items-center gap-1.5"><CheckCircle2 size={13} /> {finishedCount} terminé{finishedCount > 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function SessionBody({ book, state, onNavigateRead }: { book: Book; state: DashboardState | null; onNavigateRead: (url: string) => void }) {
  if (!state) return <p className="text-ink-faint text-sm">Chargement…</p>;

  if (state.kind === 'none') {
    return (
      <div className="text-center py-6">
        <p className="text-ink-faint mb-4">Ce livre n&apos;a pas encore de plan de lecture.</p>
        <Link href={`/book/${book.id}`} className="btn-primary">Créer un plan</Link>
      </div>
    );
  }

  if (state.kind === 'finished') {
    return (
      <div className="text-center py-8">
        <Sparkles size={26} className="text-gold mx-auto mb-3" />
        <p className="font-display text-xl mb-1">Livre terminé 🎉</p>
        <p className="text-sm text-ink-faint mb-5">Tu as terminé {book.title}.</p>
        <Link href="/library" className="btn-secondary">Retour à la bibliothèque</Link>
      </div>
    );
  }

  if (state.kind === 'ahead') {
    return (
      <div className="text-center py-8">
        <CheckCircle2 size={24} className="text-moss mx-auto mb-3" />
        <p className="font-display text-lg mb-1">Lecture du jour terminée</p>
        <p className="text-sm text-ink-faint">Profite du reste de ta journée. Prochaine session : {state.session?.sessionDate}.</p>
      </div>
    );
  }

  if (state.kind === 'unrealistic') {
    const p = state.proposal!;
    return (
      <div>
        <div className="flex items-start gap-3 bg-ember/[0.08] rounded-xl p-4 mb-4">
          <AlertTriangle size={18} className="text-ember shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium mb-1">Ton objectif initial n&apos;est plus réaliste avec ton rythme actuel.</p>
            <p className="text-ink-soft dark:text-paper">Nouvelle date proposée : <strong>{p.newTargetDate}</strong> · ≈ {p.minutesPerDay} min/jour</p>
          </div>
        </div>
        <button
          className="btn-primary w-full"
          onClick={() => {
            const plan = getActivePlan(book.id);
            if (plan) acceptProposal(plan, p);
            window.location.reload();
          }}
        >
          Accepter la nouvelle date
        </button>
      </div>
    );
  }

  const session = state.session!;
  const isCatchUp = state.kind === 'catch-up';

  return (
    <div>
      {isCatchUp && (
        <div className="flex items-start gap-3 bg-ember/[0.08] rounded-xl p-4 mb-4 text-sm">
          <AlertTriangle size={18} className="text-ember shrink-0 mt-0.5" />
          <p>
            {(state.missedCount ?? 0) > 1
              ? `Tu as ${state.missedCount} sessions en retard. Pas de problème — j'ai réorganisé ton programme.`
              : "Tu as manqué ta lecture précédente. Nous reprenons ici."}
          </p>
        </div>
      )}
      <p className="label mb-2">Jour {session.sessionNumber}{session.chapterTitle ? ` · ${session.chapterTitle}` : ''}</p>
      <p className="font-display text-2xl mb-1">Pages {session.startPage} → {session.endPage}</p>
      <p className="text-sm text-ink-faint mb-6">≈ {session.estimatedMinutes} minutes</p>
      <button onClick={() => onNavigateRead(`/read/${book.id}?session=${session.id}`)} className="btn-primary w-full">
        {isCatchUp ? 'Reprendre' : 'Commencer la lecture'} <ArrowRight size={16} />
      </button>
    </div>
  );
}
