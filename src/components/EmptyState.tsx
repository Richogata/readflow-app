'use client';

import Link from 'next/link';
import { BookOpen } from 'lucide-react';

export default function EmptyState({
  title, subtitle, cta = 'Importer un livre', href = '/add',
}: { title: string; subtitle: string; cta?: string; href?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6 animate-fadeUp">
      <div className="w-16 h-16 rounded-2xl bg-ember/10 dark:bg-gold/10 flex items-center justify-center mb-6">
        <BookOpen size={28} className="text-ember dark:text-gold" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-2xl mb-2">{title}</h2>
      <p className="text-ink-soft dark:text-paper max-w-sm mb-7">{subtitle}</p>
      <Link href={href} className="btn-primary">{cta}</Link>
    </div>
  );
}
