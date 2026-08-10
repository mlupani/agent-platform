import { api } from '@/lib/api';
import type { DashboardPayload } from '@/lib/types';

export default async function AnalyticsPage() {
  const dashboard = await api<DashboardPayload>('/admin/analytics/dashboard').catch(
    () => null,
  );
  const m = dashboard?.metrics;

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">09 / ANALYTICS</p>
        <h2 className="mt-2 text-3xl font-semibold">Uso y costos</h2>
        {dashboard ? (
          <p className="text-sm text-muted mt-2">
            Semana {dashboard.period.weekStart} → {dashboard.period.weekEnd} ·{' '}
            {dashboard.business.name}
          </p>
        ) : null}
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">EJECUCIONES SEMANA</p>
          <p className="mt-2 text-3xl">{m?.executionsWeek ?? 0}</p>
        </article>
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">TOKENS SEMANA</p>
          <p className="mt-2 text-3xl">
            {(m?.inputTokensWeek ?? 0) + (m?.outputTokensWeek ?? 0)}
          </p>
        </article>
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">COSTO ESTIMADO</p>
          <p className="mt-2 text-3xl text-amber">
            ${(m?.estimatedCostWeek ?? 0).toFixed(4)}
          </p>
        </article>
        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">LATENCIA PROM.</p>
          <p className="mt-2 text-3xl">
            {m?.avgLatencyMs
              ? m.avgLatencyMs < 1000
                ? `${m.avgLatencyMs} ms`
                : `${(m.avgLatencyMs / 1000).toFixed(1)} s`
              : '—'}
          </p>
        </article>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="panel rounded-xl p-5">
          <h3 className="text-sm font-medium">Mix de canales</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {(dashboard?.channelMix ?? []).map((row) => (
              <li key={row.channel} className="flex justify-between">
                <span>{row.channel}</span>
                <span className="mono text-teal">{row.count}</span>
              </li>
            ))}
            {!dashboard?.channelMix?.length && (
              <li className="text-muted">Sin datos</li>
            )}
          </ul>
        </article>
        <article className="panel rounded-xl p-5">
          <h3 className="text-sm font-medium">Estados de conversación</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {(dashboard?.statusMix ?? []).map((row) => (
              <li key={row.status} className="flex justify-between">
                <span>{row.status}</span>
                <span className="mono text-muted">{row.count}</span>
              </li>
            ))}
            {!dashboard?.statusMix?.length && (
              <li className="text-muted">Sin datos</li>
            )}
          </ul>
        </article>
      </section>
    </div>
  );
}
