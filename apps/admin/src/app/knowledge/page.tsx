import { KnowledgeManager } from '@/components/knowledge-manager';

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">05 / KNOWLEDGE</p>
        <h2 className="mt-2 text-3xl font-semibold">Conocimiento</h2>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Acá cargás lo que el asistente debe saber sobre tu negocio: FAQs,
          políticas, precios y documentos. No hace falta hablar de embeddings ni
          bases vectoriales.
        </p>
      </header>
      <KnowledgeManager />
    </div>
  );
}
