'use client';

import { IntegrationsHub } from '@/components/integrations-hub';
import { Suspense } from 'react';

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Cargando integraciones…</p>}>
      <IntegrationsHub />
    </Suspense>
  );
}
