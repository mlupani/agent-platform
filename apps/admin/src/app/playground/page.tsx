import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import { PlaygroundClient } from '@/components/playground-client';

export default async function PlaygroundPage() {
  const businesses = await api<Business[]>('/admin/businesses').catch(() => []);

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">11 / PLAYGROUND</p>
        <h2 className="mt-2 text-3xl font-semibold">Playground</h2>
        <p className="text-sm text-muted mt-2">
          Probá el agente con timeline de tools, conocimiento recuperado, prompt,
          tokens, latencia, costo e historial de ejecuciones.
        </p>
      </header>
      <PlaygroundClient businesses={businesses} />
    </div>
  );
}
