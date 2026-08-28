import { PlaygroundClient } from '@/components/playground-client';

export default function PlaygroundPage() {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.18em] uppercase text-muted">Demo comercial · Playground</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Asistente para clínica odontológica</h2>
          <p className="text-sm text-muted mt-1">Experiencia real de WhatsApp · grabación lista para Reels / Shorts · 390×844 optimizado</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> Demo en vivo
        </span>
      </header>
      <PlaygroundClient />
    </div>
  );
}
