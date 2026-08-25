import { Suspense } from 'react';
import { LeadsList } from '@/components/leads-list';

export default function LeadsPage() {
  return (
    <Suspense fallback={<p className="p-5 text-sm text-muted">Cargando leads…</p>}>
      <LeadsList />
    </Suspense>
  );
}
