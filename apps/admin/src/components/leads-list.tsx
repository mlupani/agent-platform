'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChannelBadge } from '@/components/channel-icons';
import type { LeadRow } from '@/lib/types';

type LeadChannel = 'MANUAL' | 'WEB' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';
type StatusFilter = 'all' | LeadRow['status'] | string;
type ContactableFilter = 'all' | 'yes' | 'no';

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Chat web',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Messenger',
  TELEGRAM: 'Telegram',
  PLAYGROUND: 'Playground',
  MANUAL: 'Carga manual',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  interested: 'Interesado',
  won: 'Convertido',
  lost: 'Perdido',
  inactive: 'Inactivo',
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'new', label: 'Nuevo' },
  { value: 'contacted', label: 'Contactado' },
  { value: 'interested', label: 'Interesado' },
  { value: 'won', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
  { value: 'inactive', label: 'Inactivo' },
];

const ORIGIN_OPTIONS: Array<{ value: LeadChannel; label: string }> = [
  { value: 'MANUAL', label: 'Carga manual' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'FACEBOOK', label: 'Messenger' },
  { value: 'WEB', label: 'Chat web' },
];

function channelLabel(channel: string | null) {
  if (!channel) return 'Sin canal';
  return CHANNEL_LABEL[channel.toUpperCase()] ?? channel;
}

function statusClass(status: string) {
  if (status === 'won') return 'badge-success';
  if (status === 'interested') return 'badge-warn';
  if (status === 'lost' || status === 'inactive') return 'badge-muted';
  return 'badge-muted';
}

function formatWhen(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function leadsPath(status: StatusFilter, contactable: ContactableFilter) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (contactable === 'yes') params.set('contactable', 'true');
  if (contactable === 'no') params.set('contactable', 'false');
  const query = params.toString();
  return `/admin/leads${query ? `?${query}` : ''}`;
}

export function LeadsList() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [contactable, setContactable] = useState<ContactableFilter>('all');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['leads', status, contactable],
    queryFn: () => api<LeadRow[]>(leadsPath(status, contactable)),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Leads</h2>
          <p className="text-sm text-muted mt-1">
            Oportunidades del asistente y las que cargás a mano.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-11 px-4"
          onClick={() => setFormOpen((open) => !open)}
        >
          {formOpen ? 'Cerrar' : 'Cargar lead'}
        </button>
      </header>

      {formOpen ? (
        <CreateLeadForm
          onCancel={() => setFormOpen(false)}
          onCreated={async () => {
            setFormOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['leads'] });
            await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={`rounded-lg border px-3 py-2 text-sm min-h-10 ${
                status === option.value
                  ? 'border-accent bg-accent text-white'
                  : 'border-line text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['all', 'Contactabilidad'],
              ['yes', 'Contactable'],
              ['no', 'Sin canal'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setContactable(value)}
              className={`rounded-lg border px-3 py-2 text-sm min-h-10 ${
                contactable === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-line text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <section className="panel rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="p-5 text-sm text-muted">Cargando leads…</p>
        ) : !data.length ? (
          <p className="p-5 text-sm text-muted">
            Todavía no hay leads con estos filtros. Cargá uno a mano o esperá a
            que el asistente registre un contacto.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((lead) => (
              <li key={lead.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium hover:text-accent"
                      >
                        {lead.name || lead.phone || lead.email || 'Sin nombre'}
                      </Link>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${statusClass(lead.status)}`}
                      >
                        {STATUS_LABEL[lead.status] ?? lead.status}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          lead.isContactable ? 'badge-success' : 'badge-muted'
                        }`}
                      >
                        {lead.isContactable ? 'Contactable' : 'Sin canal'}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1 inline-flex items-center gap-1.5">
                      <ChannelBadge channel={lead.channel ?? undefined} />
                      {channelLabel(lead.channel)}
                      {lead.interest ? ` · ${lead.interest}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {lead.conversationId ? (
                      <Link
                        href={`/conversations?c=${lead.conversationId}`}
                        className="text-accent hover:underline min-h-10 inline-flex items-center"
                      >
                        Conversación
                      </Link>
                    ) : null}
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-accent hover:underline min-h-10 inline-flex items-center"
                    >
                      Ver detalle
                    </Link>
                  </div>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Contacto</dt>
                    <dd>{lead.phone || lead.email || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Última actividad</dt>
                    <dd>{formatWhen(lead.lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Próximo seguimiento</dt>
                    <dd>{formatWhen(lead.nextFollowUpAt)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateLeadForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState('');
  const [channel, setChannel] = useState<LeadChannel>('MANUAL');
  const [message, setMessage] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/admin/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          interest: interest.trim() || undefined,
          message: message.trim() || undefined,
          channel,
        }),
      }),
    onSuccess: async () => {
      await onCreated();
    },
  });

  const canSubmit = Boolean(name.trim() || phone.trim() || email.trim());

  return (
    <form
      className="panel rounded-2xl p-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || mutation.isPending) return;
        mutation.mutate();
      }}
    >
      <div>
        <h3 className="font-medium">Nuevo lead</h3>
        <p className="text-xs text-muted mt-1">
          Completá al menos un dato de contacto.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Nombre</span>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Teléfono</span>
          <input
            className="input w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Email</span>
          <input
            className="input w-full"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Origen</span>
          <select
            className="input w-full"
            value={channel}
            onChange={(event) => setChannel(event.target.value as LeadChannel)}
          >
            {ORIGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Interés</span>
          <input
            className="input w-full"
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
            placeholder="Ej. clases 2 veces por semana"
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Nota</span>
        <textarea
          className="input w-full min-h-24"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
        />
      </label>
      {mutation.isError ? (
        <p className="text-sm text-rose">
          {(mutation.error as Error).message || 'No se pudo guardar el lead.'}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn-primary min-h-11 px-4"
          disabled={!canSubmit || mutation.isPending}
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar lead'}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-11 px-4"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
