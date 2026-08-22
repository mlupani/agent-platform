'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function CallbackRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const qs = params.toString();
    router.replace(`/integrations${qs ? `?${qs}` : ''}`);
  }, [params, router]);

  return (
    <p className="text-sm text-muted">Cerrando la conexión con Zernio…</p>
  );
}

export default function IntegrationsCallbackPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Cerrando la conexión…</p>}>
      <CallbackRedirect />
    </Suspense>
  );
}
