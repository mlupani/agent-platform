import { Suspense } from 'react';
import { ClientsList } from '@/components/clients-list';

export default function ClientesPage() {
  return (
    <Suspense fallback={<p className="p-5 text-sm text-muted">Cargando alumnos…</p>}>
      <ClientsList />
    </Suspense>
  );
}
