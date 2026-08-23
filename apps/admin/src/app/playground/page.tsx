import { PlaygroundClient } from '@/components/playground-client';

export default function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs tracking-[0.18em] uppercase text-muted">
          Playground
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Probar agente</h2>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Simulá una conversación y configurá qué tools puede usar el agente de
          este negocio. Los cambios se guardan y aplican a todos los canales.
        </p>
      </header>
      <PlaygroundClient />
    </div>
  );
}
