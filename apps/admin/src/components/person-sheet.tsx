'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CatalogService, ClientRow, LeadDetail, LeadRow } from '@/lib/types';
import { useEffect, useState } from 'react';

export interface PersonTarget {
  userId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

function normalizePhone(phone?: string | null) {
  return (phone || '').replace(/\D/g, '').slice(-8);
}

function displayName(target: PersonTarget, fallback?: string) {
  return target.contactName || fallback || target.contactPhone || target.contactEmail || 'Sin nombre';
}

export function PersonSheet({
  target,
  open,
  onClose,
}: {
  target: PersonTarget | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const phoneDigits = normalizePhone(target?.contactPhone);
  const hasPhone = phoneDigits.length >= 6;
  const hasContactQuery = hasPhone || !!target?.contactEmail?.trim();

  // 1) si hay userId -> fetch directo alumno
  const clientById = useQuery({
    queryKey: ['person-client-id', target?.userId],
    queryFn: () => api<ClientRow>(`/admin/clients/${target!.userId}`),
    enabled: open && !!target?.userId,
  });

  // 2) lookup por teléfono/email si no hay userId (client) y siempre para lead (para badge combinado)
  const clientsByPhone = useQuery({
    queryKey: ['person-clients-search', phoneDigits, target?.contactEmail],
    queryFn: () => {
      const q = target!.contactPhone || target!.contactEmail || '';
      return api<ClientRow[]>(`/admin/clients?search=${encodeURIComponent(q)}`);
    },
    enabled: open && !target?.userId && hasContactQuery,
  });

  const leadsByPhone = useQuery({
    queryKey: ['person-leads-search', phoneDigits, target?.contactEmail],
    queryFn: () => {
      const q = target!.contactPhone || target!.contactEmail || '';
      return api<LeadRow[]>(`/admin/leads?search=${encodeURIComponent(q)}`);
    },
    enabled: open && hasContactQuery,
  });

  // también buscar lead por userId == lead.user.id? si alumno no encontrado pero userId existe, buscar lead por user
  const leadByUser = useQuery({
    queryKey: ['person-lead-by-user', target?.userId],
    queryFn: async () => {
      const rows = await api<LeadRow[]>(`/admin/leads?search=${encodeURIComponent(target!.userId!)}`);
      return rows;
    },
    enabled: open && !!target?.userId && !clientById.data && clientById.isError,
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !target) return null;

  // resolución
  let resolvedType: 'alumno' | 'lead' | 'prospect' = 'prospect';
  let resolvedClient: ClientRow | null = null;
  let resolvedLead: LeadRow | null = null;

  if (target.userId && clientById.data) {
    resolvedType = 'alumno';
    resolvedClient = clientById.data;
    // si además existe lead vinculado al mismo user, lo resolvemos para mostrar badge combinado
    if (leadsByPhone.data?.length) {
      const extraLead =
        (hasPhone && leadsByPhone.data.find((l) => normalizePhone(l.phone) === phoneDigits)) ||
        (target.contactEmail && leadsByPhone.data.find((l) => l.email?.toLowerCase() === target.contactEmail!.toLowerCase())) ||
        null;
      if (extraLead) {
        resolvedLead = extraLead;
        // mantener alumno como principal pero guardar lead para UI "both"
        // usaremos tipo alumno con lead secundario; el header mostrará ambos badges
      }
    }
  } else if (target.userId && clientById.isError) {
    if (leadByUser.data && leadByUser.data.length) {
      resolvedType = 'lead';
      resolvedLead = leadByUser.data[0];
    }
  } else if (!target.userId && hasContactQuery) {
    const clients = clientsByPhone.data ?? [];
    const leads = leadsByPhone.data ?? [];
    const clientExact =
      (hasPhone && clients.find((c) => normalizePhone(c.phone) === phoneDigits)) ||
      (target.contactEmail && clients.find((c) => c.email?.toLowerCase() === target.contactEmail!.toLowerCase())) ||
      null;
    const leadExact =
      (hasPhone && leads.find((l) => normalizePhone(l.phone) === phoneDigits)) ||
      (target.contactEmail && leads.find((l) => l.email?.toLowerCase() === target.contactEmail!.toLowerCase())) ||
      null;
    if (clientExact && leadExact) {
      // es ambas: existe como alumna y como lead (caso conversión o import). Mostrar ficha alumna pero indicar lead
      resolvedType = 'alumno';
      resolvedClient = clientExact;
      resolvedLead = leadExact;
    } else if (clientExact) {
      resolvedType = 'alumno';
      resolvedClient = clientExact;
    } else if (leadExact) {
      resolvedType = 'lead';
      resolvedLead = leadExact;
    }
  }

  const titleName = displayName(target, resolvedClient?.name || resolvedLead?.name || undefined);
  const subtitlePhone = resolvedClient?.phone || resolvedLead?.phone || target.contactPhone;
  const subtitleEmail = resolvedClient?.email || resolvedLead?.email || target.contactEmail;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl max-h-[92dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-line shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3 min-w-0">
              <div className="h-11 w-11 rounded-full bg-accent/15 text-accent flex items-center justify-center font-semibold shrink-0">
                {titleName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-lg leading-tight truncate">{titleName}</h3>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      resolvedType === 'alumno'
                        ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/20'
                        : resolvedType === 'lead'
                          ? 'bg-amber-500/15 text-amber-700 border border-amber-500/20'
                          : 'bg-panel-2 text-muted border border-line'
                    }`}
                  >
                    {resolvedType === 'alumno'
                      ? resolvedLead
                        ? 'Alumna · Lead'
                        : 'Alumna'
                      : resolvedType === 'lead'
                        ? 'Lead'
                        : 'Contacto'}
                  </span>
                  {resolvedClient ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-panel-2 border border-line text-muted">
                      {resolvedClient.status.name}
                    </span>
                  ) : null}
                  {resolvedLead ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/20">
                      {resolvedLead.status}
                    </span>
                  ) : null}
                  {clientById.isLoading || clientsByPhone.isLoading || leadsByPhone.isLoading ? (
                    <span className="text-[11px] text-muted">buscando…</span>
                  ) : null}
                </div>
              </div>
            </div>
            <button type="button" className="text-muted hover:text-text text-xl leading-none px-1" onClick={onClose}>
              ×
            </button>
          </div>
          {/* contactos rápidos */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            {subtitlePhone ? (
              <a href={`https://wa.me/${subtitlePhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 hover:bg-panel-2">
                {subtitlePhone}
              </a>
            ) : null}
            {subtitleEmail ? (
              <a href={`mailto:${subtitleEmail}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 hover:bg-panel-2">
                {subtitleEmail}
              </a>
            ) : null}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {resolvedType === 'alumno' && resolvedClient ? (
            <>
              <AlumnoFicha client={resolvedClient} onClose={onClose} />
              {resolvedLead ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted">También es lead</p>
                    <p className="text-sm font-medium">Estado: {resolvedLead.status}</p>
                  </div>
                  <Link href={`/leads/${resolvedLead.id}`} className="text-sm text-accent hover:underline" onClick={onClose}>
                    Ver lead →
                  </Link>
                </div>
              ) : null}
            </>
          ) : resolvedType === 'lead' && resolvedLead ? (
            <LeadFicha lead={resolvedLead} onClose={onClose} />
          ) : (
            <ProspectFicha target={target} phoneDigits={phoneDigits} onClose={onClose} />
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-panel-2/40 flex flex-wrap justify-between items-center gap-2 shrink-0">
          <button type="button" className="text-sm text-muted hover:text-text" onClick={onClose}>
            Cerrar
          </button>
          <div className="flex flex-wrap gap-3">
            {resolvedClient ? (
              <Link
                href={`/clientes?search=${encodeURIComponent(resolvedClient.phone || resolvedClient.id)}`}
                className="text-sm text-accent hover:underline"
                onClick={onClose}
              >
                Alumna →
              </Link>
            ) : null}
            {resolvedLead ? (
              <Link href={`/leads/${resolvedLead.id}`} className="text-sm text-accent hover:underline" onClick={onClose}>
                Lead →
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AlumnoFicha({ client, onClose }: { client: ClientRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showPay, setShowPay] = useState(false);
  const { data: balance, isLoading: balLoading } = useQuery({
    queryKey: ['packs-balance', client.id],
    queryFn: () =>
      api<{
        availableClasses: number;
        hasAvailableClasses: boolean;
        activePacks: Array<{ id: string; remainingClasses: number; totalClasses: number; usedClasses: number; name: string }>;
        allPacks: Array<{ totalClasses: number; usedClasses: number }>;
      }>(`/admin/users/${client.id}/balance`),
  });

  const consumePass = useMutation({
    mutationFn: (passId: string) => api(`/admin/payments/passes/${passId}/use`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['packs-balance', client.id] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['payments-stats'] }),
      ]);
    },
  });

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['client-appointments', client.id],
    queryFn: () =>
      api<Array<{ id: string; startsAt: string; endsAt: string; status: string; service: { name: string } | null }>>(
        `/admin/clients/${client.id}/appointments`,
      ),
  });

  const totalPaid = balance
    ? balance.allPacks.reduce((a, p) => a + p.totalClasses, 0)
    : 0;
  const totalUsed = balance
    ? balance.allPacks.reduce((a, p) => a + p.usedClasses, 0)
    : 0;

  const asistencias = (history ?? []).filter((h) => h.status === 'completed');
  const inasistencias = (history ?? []).filter((h) => h.status === 'no_show');

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Alta</span>
          <span>{new Date(client.createdAt).toLocaleDateString('es-AR')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Clases</span>
          <span>{client.appointments}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Conversaciones</span>
          <span>{client.conversations}</span>
        </div>
        {client.notes ? (
          <div className="rounded-xl border border-line bg-panel-2/50 p-3">
            <p className="text-xs text-muted mb-1">Notas</p>
            <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-line p-3 space-y-2">
        <p className="text-sm font-medium">Packs y créditos</p>
        {balLoading ? (
          <p className="text-sm text-muted">Cargando packs…</p>
        ) : balance ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-semibold tracking-tight">{balance.availableClasses}</p>
                <p className="text-xs text-muted">clases disponibles</p>
              </div>
              <div className="text-right text-xs text-muted">
                <p>{totalPaid} pagadas</p>
                <p>{totalUsed} usadas</p>
              </div>
            </div>
            {balance.activePacks.length ? (
              <ul className="text-xs text-muted space-y-1 pt-1 border-t border-line/60">
                {balance.activePacks.slice(0, 3).map((pack) => (
                  <li key={pack.name + pack.remainingClasses} className="flex justify-between">
                    <span>{pack.name}</span>
                    <span>
                      {pack.remainingClasses}/{pack.totalClasses}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">Sin packs cargados</p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowPay(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3 py-1.5 text-xs font-medium hover:bg-accent/90">
            + Agregar pago
          </button>
          <Link href={`/pagos?clientId=${encodeURIComponent(client.id)}`} className="inline-flex items-center text-xs text-accent hover:underline px-2 py-1" onClick={onClose}>
            Gestionar packs
          </Link>
          {balance?.activePacks?.length ? (
            <button
              type="button"
              className="btn-secondary min-h-8 px-2.5 text-xs"
              disabled={consumePass.isPending}
              onClick={() => consumePass.mutate(balance.activePacks[0].id)}
            >
              {consumePass.isPending ? 'Usando…' : 'Usar clase'}
            </button>
          ) : null}
        </div>
        {consumePass.isError ? (
          <p className="text-xs text-rose">{(consumePass.error as Error).message || 'No se pudo descontar la clase.'}</p>
        ) : null}
      </div>
      {showPay ? <AddPaymentModal clientId={client.id} onClose={() => setShowPay(false)} /> : null}

      <div className="rounded-xl border border-line p-3 space-y-2">
        <p className="text-sm font-medium">Asistencias</p>
        {histLoading ? (
          <p className="text-xs text-muted">Cargando historial…</p>
        ) : !history?.length ? (
          <p className="text-xs text-muted">Sin clases registradas</p>
        ) : (
          <>
            <div className="flex gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> {asistencias.length} asistencias
              </span>
              <span className="inline-flex items-center gap-1.5 text-rose-700">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> {inasistencias.length} inasistencias
              </span>
            </div>
            <ul className="divide-y divide-line/60 max-h-56 overflow-y-auto -mx-1 px-1">
              {history.slice(0, 30).map((h) => {
                const d = new Date(h.startsAt);
                const isCompleted = h.status === 'completed';
                const isNoShow = h.status === 'no_show';
                const label = isCompleted ? 'Asistió' : isNoShow ? 'Faltó' : h.status === 'cancelled' ? 'Cancelada' : 'Pendiente';
                return (
                  <li key={h.id} className="flex items-center justify-between py-1.5 text-xs gap-2">
                    <span className={isCompleted ? 'text-emerald-700' : isNoShow ? 'text-rose-700' : 'text-muted'}>
                      {d.toLocaleDateString('es-AR')} {d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {h.service?.name ?? 'Clase'}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium border ${isCompleted ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : isNoShow ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-panel-2 border-line text-muted'}`}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {history.length > 30 ? <p className="text-[11px] text-muted">Mostrando 30 últimas</p> : null}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {client.phone ? (
          <a
            href={`https://wa.me/${client.phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] text-white px-3 py-1.5 text-sm"
          >
            WhatsApp
          </a>
        ) : null}
        {client.email ? (
          <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm">
            Email
          </a>
        ) : null}
      </div>
    </div>
  );
}

function AddPaymentModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api<CatalogService[]>('/admin/services'),
  });
  const [serviceId, setServiceId] = useState('');
  const [cover, setCover] = useState<'pack' | 'session'>('pack');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const selected = services.find((s) => s.id === serviceId);
  const isPack = (selected?.sessionCount ?? 1) > 1;
  const mutation = useMutation({
    mutationFn: () =>
      api('/admin/payments', {
        method: 'POST',
        body: JSON.stringify({
          userId: clientId,
          amount: Number(amount.replace(',', '.')),
          paidAt,
          notes: notes.trim() || null,
          serviceId: serviceId || null,
          cover: isPack ? cover : undefined,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['packs-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['client-appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['appointment-classes'] }),
      ]);
      onClose();
    },
  });
  const parsed = Number(amount.replace(',', '.'));
  const canSubmit = Number.isFinite(parsed) && parsed > 0 && !!paidAt;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={onClose} />
      <form
        className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit || mutation.isPending) return;
          mutation.mutate();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold">Agregar pago</h4>
            <p className="text-xs text-muted mt-1">Importe y fecha obligatorios. Si es pack, elegí si cubre todo o 1 clase.</p>
          </div>
          <button type="button" className="text-muted text-xl px-1" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Servicio</span>
          <select className="input w-full" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Sin servicio</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.sessionCount > 1 ? ` · pack ${s.sessionCount}` : ''}
              </option>
            ))}
          </select>
        </label>
        {isPack ? (
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted">Este pago cubre</legend>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 text-sm min-h-10 px-3 rounded-full border border-line">
                <input type="radio" checked={cover === 'pack'} onChange={() => setCover('pack')} /> Pack completo ({selected?.sessionCount} clases)
              </label>
              <label className="inline-flex items-center gap-2 text-sm min-h-10 px-3 rounded-full border border-line">
                <input type="radio" checked={cover === 'session'} onChange={() => setCover('session')} /> 1 clase
              </label>
            </div>
          </fieldset>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Importe</span>
            <input className="input w-full" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Fecha</span>
            <input className="input w-full" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Observación</span>
          <textarea className="input w-full min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </label>
        {mutation.isError ? <p className="text-sm text-rose">{(mutation.error as Error).message}</p> : null}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1 min-h-11" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar pago'}
          </button>
          <button type="button" className="btn-secondary min-h-11 px-4" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function LeadFicha({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { data: detail } = useQuery({
    queryKey: ['lead-detail-sheet', lead.id],
    queryFn: () => api<LeadDetail>(`/admin/leads/${lead.id}`),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Estado</span>
          <span className="font-medium">{detail?.status ?? lead.status}</span>
        </div>
        {lead.interest ? (
          <div className="flex justify-between">
            <span className="text-muted">Interés</span>
            <span>{lead.interest}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-muted">Canal</span>
          <span>{lead.channel || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Última actividad</span>
          <span className="text-xs">{lead.lastActivityAt ? new Date(lead.lastActivityAt).toLocaleString('es-AR') : '—'}</span>
        </div>
        {lead.nextFollowUpAt ? (
          <div className="flex justify-between">
            <span className="text-muted">Próximo seguimiento</span>
            <span className="text-xs">{new Date(lead.nextFollowUpAt).toLocaleString('es-AR')}</span>
          </div>
        ) : null}
        {lead.message ? (
          <div className="rounded-xl border border-line bg-panel-2/50 p-3">
            <p className="text-xs text-muted mb-1">Mensaje</p>
            <p className="text-sm whitespace-pre-wrap">{lead.message}</p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3 py-1.5 text-sm" onClick={onClose}>
          Ver ficha lead
        </Link>
        {lead.conversationId ? (
          <Link href={`/conversations?c=${lead.conversationId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" onClick={onClose}>
            Conversación
          </Link>
        ) : null}
      </div>
      {detail?.user?.id ? (
        <p className="text-xs text-muted">
          Vinculado a alumna <span className="font-medium">{detail.user.name}</span>
        </p>
      ) : null}
    </div>
  );
}

function ProspectFicha({ target, phoneDigits, onClose }: { target: PersonTarget; phoneDigits: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createClient = useMutation({
    mutationFn: () =>
      api<ClientRow>('/admin/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: target.contactName?.trim() || null,
          phone: target.contactPhone?.trim() || null,
          email: target.contactEmail?.trim() || null,
          statusSlug: 'visita',
          notes: 'Creada desde calendario',
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['person-clients-search'] });
      onClose();
    },
  });

  const createLead = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/admin/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: target.contactName?.trim() || null,
          phone: target.contactPhone?.trim() || null,
          email: target.contactEmail?.trim() || null,
          channel: 'MANUAL',
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leads'] });
      await queryClient.invalidateQueries({ queryKey: ['person-leads-search'] });
      onClose();
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-line p-4 text-center">
        <p className="text-sm font-medium">Sin ficha registrada</p>
        <p className="text-xs text-muted mt-1">
          {target.contactPhone || target.contactEmail
            ? `No encontramos alumna ni lead con ${target.contactPhone || target.contactEmail}.`
            : 'Contacto sin teléfono ni email.'}
        </p>
      </div>
      {target.contactName ? (
        <p className="text-sm">
          <span className="text-muted">Nombre:</span> <span className="font-medium">{target.contactName}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="w-full rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          disabled={createClient.isPending || !target.contactPhone}
          onClick={() => createClient.mutate()}
        >
          {createClient.isPending ? 'Creando…' : 'Crear alumna'}
        </button>
        <button
          type="button"
          className="w-full rounded-lg border border-line bg-panel px-4 py-2.5 text-sm"
          disabled={createLead.isPending}
          onClick={() => createLead.mutate()}
        >
          {createLead.isPending ? 'Creando…' : 'Crear lead'}
        </button>
        {(createClient.isError || createLead.isError) ? (
          <p className="text-sm text-rose">{(createClient.error as Error)?.message || (createLead.error as Error)?.message}</p>
        ) : null}
      </div>
    </div>
  );
}
