'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SpendReport } from '@/lib/types';

function money(value: number) {
  return `$${value.toFixed(4)}`;
}

export function SpendHome() {
  const [month, setMonth] = useState('');
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['spend', month || 'current'],
    queryFn: () =>
      api<SpendReport>(
        `/admin/analytics/spend${month ? `?month=${encodeURIComponent(month)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const selectedMonth = month || data?.period.month || '';
  const services = data?.services ?? [];

  return (
    <div className="space-y-7 max-w-5xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Gastos</h2>
          <p className="text-sm text-muted mt-1">
            Control de keys y suscripciones de IA. Día de hoy y mes seleccionado.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 min-w-[13.5rem]">
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
            Mes
          </span>
          <select
            className="input"
            value={selectedMonth}
            onChange={(event) => setMonth(event.target.value)}
            disabled={!data?.period.availableMonths.length}
            aria-label="Seleccionar mes"
          >
            {(data?.period.availableMonths ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div className="panel rounded-2xl p-5 text-rose text-sm">
          No se pudo leer el gasto.
          <pre className="mono mt-3 text-xs text-muted whitespace-pre-wrap">
            {(error as Error).message}
          </pre>
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="panel rounded-2xl h-28 animate-pulse bg-panel-2" />
          <div className="panel rounded-2xl h-28 animate-pulse bg-panel-2" />
        </div>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <article className="panel rounded-2xl p-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
                Hoy
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
                {money(data.totals.day)}
              </p>
              <p className="mt-1 text-xs text-muted">{data.period.today}</p>
            </article>
            <article className="panel rounded-2xl p-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
                {data.period.monthLabel}
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-amber">
                {money(data.totals.month)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {isFetching ? 'Actualizando' : 'Suma de todos los servicios'}
              </p>
            </article>
          </section>

          <section className="panel rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="font-medium">Servicios y keys</h3>
              <p className="text-xs text-muted mt-1">
                Cada fila es una suscripción o API key que puede generar gasto.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-5 py-3 font-medium">Servicio</th>
                    <th className="px-5 py-3 font-medium">Hoy</th>
                    <th className="px-5 py-3 font-medium">Mes</th>
                    <th className="px-5 py-3 font-medium text-right">Usos mes</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((row) => (
                    <tr key={row.id} className="border-t border-line align-top">
                      <td className="px-5 py-4">
                        <p className="font-medium">{row.name}</p>
                        <p className="mono text-[11px] text-muted mt-0.5">
                          {row.envKey || 'Sin key declarada'}
                          {row.configured ? '' : ' · no configurada'}
                        </p>
                        {row.breakdown.length ? (
                          <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                            {row.breakdown.map((item) => (
                              <li key={item.label}>
                                {item.label}: {money(item.month.cost)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 tabular-nums whitespace-nowrap">
                        {money(row.day.cost)}
                      </td>
                      <td className="px-5 py-4 tabular-nums whitespace-nowrap font-medium">
                        {money(row.month.cost)}
                      </td>
                      <td className="px-5 py-4 tabular-nums text-right text-muted">
                        {row.month.calls}
                      </td>
                    </tr>
                  ))}
                  {!services.length ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-sm text-muted">
                        No hay keys configuradas ni gasto registrado este mes.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-text/15 bg-panel-2">
                    <td className="px-5 py-4 font-semibold">Total</td>
                    <td className="px-5 py-4 tabular-nums font-semibold">
                      {money(data.totals.day)}
                    </td>
                    <td className="px-5 py-4 tabular-nums font-semibold text-amber">
                      {money(data.totals.month)}
                    </td>
                    <td className="px-5 py-4 tabular-nums text-right text-muted">
                      {services.reduce((sum, row) => sum + row.month.calls, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <p className="text-xs text-muted max-w-3xl">{data.note}</p>
        </>
      ) : null}
    </div>
  );
}
