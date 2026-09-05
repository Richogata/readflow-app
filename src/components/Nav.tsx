'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Library, Plus, Settings } from 'lucide-react';

const items = [
  { href: '/', icon: Home, label: 'Accueil' },
  { href: '/library', icon: Library, label: 'Bibliothèque' },
  { href: '/add', icon: Plus, label: 'Ajouter' },
  { href: '/settings', icon: Settings, label: 'Réglages' },
];

export default function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      <nav className="hidden md:flex fixed left-0 top-0 h-full w-20 flex-col items-center py-8 gap-2 border-r border-ink/[0.06] dark:border-paper/[0.08] z-40">
        <div className="mb-8">
          <div className="w-9 h-9 rounded-lg bg-ink dark:bg-gold flex items-center justify-center">
            <span className="font-display italic text-paper dark:text-nightpaper text-lg">R</span>
          </div>
        </div>
        {items.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={`group relative flex flex-col items-center gap-1 w-14 py-3 rounded-xl transition-colors ${
              isActive(href) ? 'text-ember dark:text-gold bg-ember/[0.08] dark:bg-gold/[0.1]' : 'text-ink-faint hover:text-ink dark:hover:text-paper'
            }`}
          >
            <Icon size={19} strokeWidth={1.75} />
            <span className="text-[10px] font-mono tracking-wide">{label.slice(0, 4)}</span>
          </Link>
        ))}
      </nav>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-ink/[0.06] dark:border-paper/[0.08] bg-paper/90 dark:bg-nightpaper/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around px-2 py-2">
          {items.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
                isActive(href) ? 'text-ember dark:text-gold' : 'text-ink-faint'
              }`}
            >
              <Icon size={21} strokeWidth={1.75} />
              <span className="text-[10px] font-mono">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
