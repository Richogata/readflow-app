import Nav from '@/components/Nav';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative">
      <div className="grain" />
      <Nav />
      <main className="relative z-10 md:pl-20 pb-24 md:pb-0">{children}</main>
    </div>
  );
}
