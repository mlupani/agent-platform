import { api } from '@/lib/api';
import type { Business } from '@/lib/types';

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const business = await api<Business>(`/admin/businesses/${id}`);
  const agent = business.agentConfigs?.[0];

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">BUSINESS / {business.slug}</p>
        <h2 className="mt-2 text-3xl font-semibold">{business.name}</h2>
        <p className="text-muted mt-2">{business.description}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">TIPO</p>
          <p className="mt-2">{business.type}</p>
        </article>
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">IDIOMA / TZ</p>
          <p className="mt-2">
            {business.language} · {business.timezone}
          </p>
        </article>
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">MODELO</p>
          <p className="mt-2">{agent?.model ?? '—'}</p>
        </article>
      </section>
      <article className="panel rounded-xl p-5">
        <p className="mono text-[11px] text-muted">SYSTEM PROMPT</p>
        <pre className="mt-3 whitespace-pre-wrap text-sm text-muted">{agent?.systemPrompt}</pre>
      </article>
      <article className="panel rounded-xl p-5">
        <p className="mono text-[11px] text-muted">TOOLS</p>
        <p className="mt-3 text-sm">{agent?.enabledTools.join(', ') || 'Ninguna'}</p>
      </article>
    </div>
  );
}
