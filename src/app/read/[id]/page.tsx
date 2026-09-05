import { Suspense } from 'react';
import ReaderClient from './ReaderClient';

export default function ReadPage() {
  return (
    <Suspense fallback={null}>
      <ReaderClient />
    </Suspense>
  );
}
