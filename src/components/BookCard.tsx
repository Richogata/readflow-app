'use client';

import Link from 'next/link';
import type { Book } from '@/lib/types';
import type { BookStatusLabel } from '@/lib/bookStatus';

const PALETTES: [string, string][] = [
  ['#C0673C', '#8F4726'],
  ['#5B6E4F', '#39472F'],
  ['#3E5C76', '#22344A'],
  ['#8F5B8F', '#5A3B62'],
  ['#B98A3E', '#7A5A22'],
];

function hashTo(str: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function Cover({ title = 'Livre', size = 'md' }: { title?: string; size?: 'sm' | 'md' | 'lg' }) {
  const palette = PALETTES[hashTo(title, PALETTES.length)];
  const dims = size === 'lg' ? 'w-24 h-32' : size === 'sm' ? 'w-12 h-16' : 'w-16 h-20';
  return (
    <div
      className={`${dims} shrink-0 rounded-md shadow-card flex items-center justify-center relative overflow-hidden`}
      style={{ background: `linear-gradient(155deg, ${palette[0]}, ${palette[1]})` }}
    >
      <div
        className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 6px)' }}
      />
      <span className="font-display italic text-paper/90 text-2xl relative">{title.trim()[0]?.toUpperCase() || 'R'}</span>
      <div className="absolute left-1 top-1 bottom-1 w-[2px] bg-black/15 rounded-full" />
    </div>
  );
}

const STATUS_LABEL: Record<BookStatusLabel, string> = {
  'not-started': 'À commencer',
  'in-progress': 'En cours',
  behind: 'En retard',
  done: 'Terminé',
};

export default function BookCard({ book, percent = 0, status = 'not-started' }: { book: Book; percent?: number; status?: BookStatusLabel }) {
  return (
    <Link href={`/book/${book.id}`} className="card flex gap-4 p-4 items-center hover:shadow-lift hover:-translate-y-0.5 transition-all duration-300">
      <Cover title={book.title} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg leading-tight truncate">{book.title}</p>
        {book.author && <p className="text-sm text-ink-faint truncate mt-0.5">{book.author}</p>}
        <div className="mt-3 flex items-center gap-3">
          <div className="progress-track flex-1">
            <div className="progress-fill" style={{ width: `${Math.round(percent)}%` }} />
          </div>
          <span className="label !text-ink-soft dark:!text-paper shrink-0">{Math.round(percent)}%</span>
        </div>
        <span className={`label mt-2 inline-block ${status === 'behind' ? 'text-ember' : status === 'done' ? 'text-moss' : ''}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
    </Link>
  );
}
