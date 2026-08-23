'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChannelBadge } from '@/components/channel-icons';
import type { LeadDetail, LeadFollowUpRow } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  interested: 'Interesado',
  won: 'Convertido',
  lost: 'Perdido',
  inactive: 'Inactivo',
};

const FOLLOW_UP_STATUS: Record<string, string> = {
  pending: 'Pendiente',
  generating: 'Generando',
  review: 'Para revisar',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  failed: 'Falló',
  skipped: 'Omitido',
};

const OBJECTIVE_OPTIONS = [
  { value: 'resume_conversation', label: 'Retomar conversación' },
  { value: 'complete_contact_data', label: 'Completar datos' },
  { value: 'resolve_objection', label: 'Resolver objeción' },
  { value: 'book_appointment', label: 'Reservar turno' },
  { value: 'confirm_appointment', label: 'Confirmar turno' },
  { value: 'remind_payment', label: 'Recordar pago' },
  { value: 'renew_membership', label: 'Renovar membresía' },
];

const EVENT_LABEL: Record<string, string> = {
  captured: 'Lead capturado',
  status_changed: 'Estado actualizado',
  conversion_suggested: 'Conversión sugerida',
  converted: 'Convertido a alumno',
  follow_up_scheduled: 'Seguimiento programado',
  follow_up_rescheduled: 'Seguimiento reprogramado',
  follow_up_cancelled: 'Seguimiento cancelado',
  follow_up_sent: 'Seguimiento enviado',
};

function statusClass(status: string) {
  if (status === 'won') return 'badge-success';
  if (status === 'interested' || status === 'review') return 'badge-warn';
  return 'badge-muted';
}

function formatWhen(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalInput(iso?: string | null) {
  const date = iso ? new Date(iso) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function objectiveLabel(value: string) {
  return OBJECTIVE_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function LeadDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api<LeadDetail>(`/admin/leads/${id}`),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['lead', id] });
    await queryClient.invalidateQueries({ queryKey: ['leads'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando lead…</p>;
  }
  if (error || !data) {
    return (
      <p className="text-sm text-rose">
        {(error as Error)?.message || 'No se pudo cargar el lead.'}
      </p>
    );
  }

  const suggested = data.events.some(
    (event) => event.type === 'conversion_suggested',
  );
  const openFollowUps = data.followUps.filter((item) =>
    ['pending', 'generating', 'review', 'failed'].includes(item.status),
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/leads" className="text-sm text-accent hover:underline">
            ← Leads
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              {data.name || data.phone || data.email || 'Sin nombre'}
            </h2>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${statusClass(data.status)}`}
            >
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                data.isContactable ? 'badge-success' : 'badge-muted'
              }`}
            >
              {data.isContactable ? 'Contactable' : 'Sin canal outbound'}
            </span>
          </div>
          <p className="text-sm text-muted mt-1 inline-flex items-center gap-1.5">
            <ChannelBadge channel={data.channel ?? undefined} />
            {data.channel || 'Sin canal'}
            {data.interest ? ` · ${data.interest}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.conversationId ? (
            <Link
              href={`/conversations?c=${data.conversationId}`}
              className="btn-secondary min-h-11 px-4 inline-flex items-center"
            >
              Ver conversación
            </Link>
          ) : null}
          {data.user?.id ? (
            <Link
              href="/clientes"
              className="btn-secondary min-h-11 px-4 inline-flex items-center"
            >
              Ver alumno
            </Link>
          ) : null}
        </div>
      </header>

      {suggested && data.status !== 'won' ? (
        <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm">
          Hay una señal de conversión pendiente. Revisá si este lead ya es
          alumno y confirmalo a mano.
        </div>
      ) : null}

      <LeadFacts lead={data} onSaved={refresh} />
      <LeadActions lead={data} onSaved={refresh} />
      <FollowUpPanel
        leadId={id}
        followUps={data.followUps}
        openCount={openFollowUps.length}
        onSaved={refresh}
      />
      <section className="panel rounded-2xl p-5 space-y-3">
        <h3 className="font-medium">Actividad</h3>
        {!data.events.length ? (
          <p className="text-sm text-muted">Todavía no hay eventos.</p>
        ) : (
          <ol className="space-y-3">
            {data.events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="font-medium">
                  {EVENT_LABEL[event.type] ?? event.type}
                </p>
                <p className="text-xs text-muted">
                  {formatWhen(event.createdAt)} · {event.actor}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function LeadFacts({
  lead,
  onSaved,
}: {
  lead: LeadDetail;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(lead.name ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [email, setEmail] = useState(lead.email ?? '');
  const [interest, setInterest] = useState(lead.interest ?? '');
  const [objections, setObjections] = useState(lead.objections ?? '');
  const [status, setStatus] = useState(lead.status);

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          interest: interest.trim() || null,
          objections: objections.trim() || null,
          status,
        }),
      }),
    onSuccess: onSaved,
  });

  return (
    <section className="panel rounded-2xl p-5 space-y-4">
      <h3 className="font-medium">Datos</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Nombre</span>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Estado</span>
          <select
            className="input w-full"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Teléfono</span>
          <input
            className="input w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Email</span>
          <input
            className="input w-full"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Interés</span>
          <input
            className="input w-full"
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Objeciones</span>
          <textarea
            className="input w-full min-h-20"
            value={objections}
            onChange={(event) => setObjections(event.target.value)}
          />
        </label>
      </div>
      {lead.missingFields.length ? (
        <p className="text-sm text-muted">
          Falta para contactar: {lead.missingFields.join(', ')}.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Canales: {lead.contactChannels.join(', ') || 'ninguno'}.
        </p>
      )}
      {save.isError ? (
        <p className="text-sm text-rose">{(save.error as Error).message}</p>
      ) : null}
      <button
        type="button"
        className="btn-primary min-h-11 px-4"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Guardando…' : 'Guardar datos'}
      </button>
    </section>
  );
}

function LeadActions({
  lead,
  onSaved,
}: {
  lead: LeadDetail;
  onSaved: () => Promise<void>;
}) {
  const [lostReason, setLostReason] = useState(lead.lostReason ?? '');
  const convert = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${lead.id}/convert`, { method: 'POST' }),
    onSuccess: onSaved,
  });
  const lost = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${lead.id}/lost`, {
        method: 'POST',
        body: JSON.stringify({ reason: lostReason.trim() || undefined }),
      }),
    onSuccess: onSaved,
  });

  if (lead.status === 'won') {
    return (
      <section className="panel rounded-2xl p-5 text-sm text-muted">
        Este lead ya se convirtió
        {lead.user?.name ? ` en ${lead.user.name}` : ' en alumno'}.
        {lead.user?.status?.name ? ` Estado: ${lead.user.status.name}.` : ''}
      </section>
    );
  }

  return (
    <section className="panel rounded-2xl p-5 space-y-4">
      <h3 className="font-medium">Conversión</h3>
      <p className="text-sm text-muted">
        Convertir vincula o crea el alumno y deja la conversación intacta.
      </p>
      {convert.isError ? (
        <p className="text-sm text-rose">{(convert.error as Error).message}</p>
      ) : null}
      <button
        type="button"
        className="btn-primary min-h-11 px-4"
        disabled={convert.isPending || lead.status === 'lost'}
        onClick={() => convert.mutate()}
      >
        {convert.isPending ? 'Convirtiendo…' : 'Convertir a alumno'}
      </button>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Marcar como perdido</span>
          <input
            className="input w-full"
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            placeholder="Motivo opcional"
          />
        </label>
        <button
          type="button"
          className="btn-secondary min-h-11 px-4 text-rose"
          disabled={lost.isPending || lead.status === 'lost'}
          onClick={() => lost.mutate()}
        >
          {lost.isPending ? 'Guardando…' : 'Perdido'}
        </button>
      </div>
      {lost.isError ? (
        <p className="text-sm text-rose">{(lost.error as Error).message}</p>
      ) : null}
    </section>
  );
}

function FollowUpPanel({
  leadId,
  followUps,
  openCount,
  onSaved,
}: {
  leadId: string;
  followUps: LeadFollowUpRow[];
  openCount: number;
  onSaved: () => Promise<void>;
}) {
  const [scheduledAt, setScheduledAt] = useState(toLocalInput());
  const [objective, setObjective] = useState('resume_conversation');
  const [note, setNote] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${leadId}/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({
          scheduledAt: new Date(scheduledAt).toISOString(),
          objective,
          objectiveNote: note.trim() || undefined,
        }),
      }),
    onSuccess: async () => {
      setNote('');
      await onSaved();
    },
  });

  return (
    <section className="panel rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-medium">Seguimientos</h3>
        <p className="text-sm text-muted mt-1">
          {openCount
            ? `${openCount} pendiente${openCount === 1 ? '' : 's'}.`
            : 'No hay seguimientos abiertos.'}
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (create.isPending) return;
          create.mutate();
        }}
      >
        <label className="space-y-1 text-sm">
          <span className="text-muted">Cuándo</span>
          <input
            type="datetime-local"
            className="input w-full"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Objetivo</span>
          <select
            className="input w-full"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          >
            {OBJECTIVE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Nota</span>
          <input
            className="input w-full"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {create.isError ? (
          <p className="text-sm text-rose sm:col-span-2">
            {(create.error as Error).message}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="btn-primary min-h-11 px-4"
            disabled={create.isPending}
          >
            {create.isPending ? 'Programando…' : 'Programar seguimiento'}
          </button>
        </div>
      </form>
      <ul className="divide-y divide-line">
        {followUps.map((item) => (
          <FollowUpRow
            key={item.id}
            leadId={leadId}
            item={item}
            onSaved={onSaved}
          />
        ))}
        {!followUps.length ? (
          <li className="py-3 text-sm text-muted">
            Todavía no hay seguimientos.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function FollowUpRow({
  leadId,
  item,
  onSaved,
}: {
  leadId: string;
  item: LeadFollowUpRow;
  onSaved: () => Promise<void>;
}) {
  const [when, setWhen] = useState(toLocalInput(item.scheduledAt));
  const [draft, setDraft] = useState(item.draftMessage ?? '');
  const canAct = ['pending', 'review', 'failed'].includes(item.status);

  const reschedule = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${leadId}/follow-ups/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: new Date(when).toISOString() }),
      }),
    onSuccess: onSaved,
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${leadId}/follow-ups/${item.id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: onSaved,
  });
  const send = useMutation({
    mutationFn: () =>
      api(`/admin/leads/${leadId}/follow-ups/${item.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ message: draft.trim() || undefined }),
      }),
    onSuccess: onSaved,
  });

  return (
    <li className="py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {objectiveLabel(item.objective)}
          </p>
          <p className="text-xs text-muted">
            {formatWhen(item.scheduledAt)} · {item.source} · intento{' '}
            {item.attemptNumber}
          </p>
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${statusClass(item.status)}`}
        >
          {FOLLOW_UP_STATUS[item.status] ?? item.status}
        </span>
      </div>
      {item.objectiveNote ? (
        <p className="text-sm text-muted">{item.objectiveNote}</p>
      ) : null}
      {item.sentMessage ? (
        <p className="text-sm whitespace-pre-wrap">{item.sentMessage}</p>
      ) : null}
      {canAct ? (
        <div className="space-y-3">
          {(item.status === 'review' || item.draftMessage) && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Borrador</span>
              <textarea
                className="input w-full min-h-24"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted">Reprogramar</span>
              <input
                type="datetime-local"
                className="input"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-secondary min-h-11 px-3 text-sm"
              disabled={reschedule.isPending}
              onClick={() => reschedule.mutate()}
            >
              Guardar fecha
            </button>
            {item.status === 'review' || item.draftMessage ? (
              <button
                type="button"
                className="btn-primary min-h-11 px-3 text-sm"
                disabled={send.isPending || !draft.trim()}
                onClick={() => send.mutate()}
              >
                {send.isPending ? 'Enviando…' : 'Enviar'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary min-h-11 px-3 text-sm text-rose"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar
            </button>
          </div>
          {reschedule.isError || cancel.isError || send.isError ? (
            <p className="text-sm text-rose">
              {(reschedule.error as Error)?.message ||
                (cancel.error as Error)?.message ||
                (send.error as Error)?.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
