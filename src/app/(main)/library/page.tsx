'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { listBooks } from '@/lib/storage';
import { getBookStatus } from '@/lib/bookStatus';
import BookCard from '@/components/BookCard';
import EmptyState from '@/components/EmptyState';
import type { Book } from '@/lib/types';

export default function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setBooks(listBooks());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  if (books.length === 0) {
    return <EmptyState title="Ton espace de lecture" subtitle="Ajoute ton premier livre et ReadFlow construira ton parcours de lecture, jour après jour." />;
  }

  const finished = books.filter((b) => getBookStatus(b).status === 'done').length;

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 md:py-14 animate-fadeUp">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl">Mes livres</h1>
          <p className="label mt-1">{books.length} livre{books.length > 1 ? 's' : ''} · {finished} terminé{finished > 1 ? 's' : ''}</p>
        </div>
        <Link href="/add" className="btn-secondary !px-4 !py-2.5"><Plus size={17} /> Ajouter</Link>
      </div>
      <div className="flex flex-col gap-3">
        {books.map((book) => {
          const { percent, status } = getBookStatus(book);
          return <BookCard key={book.id} book={book} percent={percent} status={status} />;
        })}
      </div>
    </div>
  );
}
