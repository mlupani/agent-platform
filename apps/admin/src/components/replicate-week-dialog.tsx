'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface ReplicateResult {
  totalSource: number;
  toCreate: number;
  skippedDuplicate: number;
  skippedFull: number;
  skippedNoTemplate: number;
  created: number;
  dryRun: boolean;
  items: Array<{
    sourceId: string;
    contactName: string | null;
    sourceStartsAt: string;
    targetStartsAt: string;
    targetEndsAt: string;
    status: string;
    reason?: string;
  }>;
  errors: Array<{ sourceId: string; message: string }>;
}

function toIsoDateLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextMondayFrom(date: Date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  // go to next monday
  const day = d.getDay(); // 0 dom, 1 lun
  const diff = day === 1 ? 7 : day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return toIsoDateLocal(d);
}

function formatRange(from: string, to: string) {
  try {
    const a = new Date(from);
    const b = new Date(to);
    // to is exclusive upper bound in our range, subtract 1ms day
    const bInclusive = new Date(b.getTime() - 1);
    const fmt = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    if (a.toDateString() === bInclusive.toDateString()) return fmt(a);
    return `${fmt(a)} → ${fmt(bInclusive)}`;
  } catch {
    return `${from} → ${to}`;
  }
}

export function ReplicateWeekDialog({
  open,
  onClose,
  sourceFrom,
  sourceTo,
  viewLabel,
}: {
  open: boolean;
  onClose: () => void;
  sourceFrom: string;
  sourceTo: string;
  viewLabel: string;
}) {
  const queryClient = useQueryClient();
  const defaultTarget = useMemo(() => {
    try {
      const s = new Date(sourceFrom);
      return nextMondayFrom(s);
    } catch {
      return toIsoDateLocal(new Date(Date.now() + 7 * 86400000));
    }
  }, [sourceFrom]);

  const [targetDate, setTargetDate] = useState(defaultTarget);
  const [includeTrials, setIncludeTrials] = useState(true);
  const [preview, setPreview] = useState<ReplicateResult | null>(null);

  // reset when opened with new source
  const [lastSource, setLastSource] = useState(sourceFrom);
  if (open && lastSource !== sourceFrom) {
    setLastSource(sourceFrom);
    setPreview(null);
    setTargetDate(nextMondayFrom(new Date(sourceFrom)));
  }

  const doReplicate = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ReplicateResult>('/admin/appointments/replicate-week', {
        method: 'POST',
        body: JSON.stringify({
          sourceFrom,
          sourceTo,
          targetFrom: targetDate,
          dryRun,
          includeTrials,
        }),
      }),
    onSuccess: (data) => {
      if (data.dryRun) {
        setPreview(data);
      } else {
        setPreview(data);
        queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
        queryClient.invalidateQueries({ queryKey: ['appointments-calendar'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    },
  });

  if (!open) return null;

  const isPreview = preview?.dryRun === true;
  const hasResult = !!preview && !preview.dryRun;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="replicate-title">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">Duplicar semana</p>
            <h3 id="replicate-title" className="font-semibold text-lg mt-1">
              Replicar {viewLabel}
            </h3>
            <p className="text-sm text-muted">
              Origen: {formatRange(sourceFrom, sourceTo)} · {preview?.totalSource != null ? `${preview.totalSource} clases` : 'cargando…'}
            </p>
          </div>
          <button type="button" className="text-muted hover:text-text text-xl leading-none px-1" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="rounded-xl border border-line bg-panel-2/40 p-3 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Semana destino (lunes)</span>
            <input type="date" className="input w-full" value={targetDate} onChange={(e) => { setTargetDate(e.target.value); setPreview(null); }} />
            <span className="text-xs text-muted">Se mantiene el mismo día y hora de cada clase. Ej: Lun 09:00 origen → Lun 09:00 destino.</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-line" checked={includeTrials} onChange={(e) => { setIncludeTrials(e.target.checked); setPreview(null); }} />
            <span>Incluir clases de prueba</span>
          </label>
        </div>

        {doReplicate.isError ? <p className="text-sm text-rose">{(doReplicate.error as Error).message}</p> : null}

        {preview ? (
          <div className={`rounded-xl border p-3 space-y-2 ${hasResult ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-panel-2/30'}`}>
            <p className={`text-sm font-medium ${hasResult ? 'text-emerald-800' : 'text-text'}`}>
              {hasResult
                ? `Listo: ${preview.created} clases creadas`
                : `Vista previa: ${preview.toCreate} se van a crear`}
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>Total en origen: <span className="font-medium text-text">{preview.totalSource}</span></li>
              {preview.toCreate > 0 ? <li>A crear: <span className="font-medium text-emerald-700">{preview.toCreate}</span></li> : null}
              {preview.skippedDuplicate > 0 ? <li>Omitidas (ya anotada): {preview.skippedDuplicate}</li> : null}
              {preview.skippedFull > 0 ? <li>Omitidas (clase llena): {preview.skippedFull}</li> : null}
              {preview.skippedNoTemplate > 0 ? <li>Omitidas (sin horario): {preview.skippedNoTemplate}</li> : null}
              {preview.errors.length > 0 ? <li className="text-rose">Errores: {preview.errors.length}</li> : null}
            </ul>
            {preview.items.length > 0 && preview.items.length <= 12 ? (
              <ul className="text-xs divide-y divide-line/50 max-h-40 overflow-y-auto">
                {preview.items.slice(0, 12).map((it) => (
                  <li key={it.sourceId} className="py-1 flex justify-between gap-2">
                    <span className="truncate">{it.contactName || 'Alumna'} · {new Date(it.targetStartsAt).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={it.status === 'will_create' || it.status === 'created' ? 'text-emerald-700' : it.status.includes('skipped') ? 'text-muted' : 'text-rose'}>{it.status === 'will_create' ? '→ crear' : it.status === 'created' ? '✓ creada' : it.reason || it.status}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {!preview || hasResult ? (
            <button
              type="button"
              className="btn-primary min-h-11 px-4 disabled:opacity-50"
              disabled={doReplicate.isPending || !targetDate}
              onClick={() => doReplicate.mutate(true)}
            >
              {doReplicate.isPending ? 'Calculando…' : 'Calcular vista previa'}
            </button>
          ) : null}
          {isPreview ? (
            <button
              type="button"
              className="min-h-11 px-4 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
              disabled={doReplicate.isPending || preview.toCreate === 0}
              onClick={() => doReplicate.mutate(false)}
            >
              {doReplicate.isPending ? 'Duplicando…' : `Confirmar y crear ${preview.toCreate} clases`}
            </button>
          ) : null}
          <button type="button" className="min-h-11 px-4 rounded-xl border border-line hover:bg-panel-2 text-sm" onClick={onClose}>
            {hasResult ? 'Cerrar' : 'Cancelar'}
          </button>
          {isPreview && preview.toCreate === 0 ? <p className="text-xs text-muted w-full">Nada para crear en esa semana destino.</p> : null}
        </div>
      </div>
    </div>
  );
}
