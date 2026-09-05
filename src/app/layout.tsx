import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReadFlow — Termine tes livres, un jour à la fois",
  description: "Importe un livre, choisis ta durée, ReadFlow construit ton plan de lecture et t'y ramène chaque jour.",
};

export const viewport: Viewport = {
  themeColor: "#F6F1E7",
  viewportFit: "cover",
};

// Applies the stored theme to <html> before React hydrates or any paint
// happens, on every full navigation (not just after visiting Settings).
// Without this, a hard refresh on /library or /read/[id] would always
// start in light mode until the user re-opened Settings.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var raw = window.localStorage.getItem('rf.settings');
    var theme = raw ? JSON.parse(raw).theme : 'light';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
