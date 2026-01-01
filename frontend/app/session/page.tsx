import { Suspense } from 'react';
import SessionView from './SessionView';
import TimelineSkeleton from '@/app/components/TimelineSkeleton';

export default function SessionPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <TimelineSkeleton />
        </div>
      </main>
    }>
      <SessionView />
    </Suspense>
  );
}
