'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChannelBadge } from '@/components/channel-icons';

interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  channel: string | null;
  conversationId: string | null;
  createdAt: string;
}

type LeadChannel = 'MANUAL' | 'WEB' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Chat web',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Messenger',
  TELEGRAM: 'Telegram',
  PLAYGROUND: 'Playground',
  MANUAL: 'Carga manual',
};

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

export function LeadsList() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['leads'],
    queryFn: () => api<LeadRow[]>('/admin/leads'),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Leads</h2>
          <p className="text-sm text-muted mt-1">
            Contactos del asistente y los que cargás a mano.
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

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <section className="panel rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="p-5 text-sm text-muted">Cargando leads…</p>
        ) : !data.length ? (
          <p className="p-5 text-sm text-muted">
            Todavía no hay leads. Cargá uno a mano o esperá a que el asistente
            registre un contacto.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((lead) => (
              <li key={lead.id} className="p-5 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {lead.name || lead.phone || lead.email || 'Sin nombre'}
                    </p>
                    <p className="text-xs text-muted mt-1 inline-flex items-center gap-1.5">
                      <ChannelBadge channel={lead.channel ?? undefined} />
                      {channelLabel(lead.channel)}
                      {' · '}
                      {new Date(lead.createdAt).toLocaleString('es-AR')}
                    </p>
                  </div>
                  {lead.conversationId ? (
                    <Link
                      href={`/conversations?c=${lead.conversationId}`}
                      className="text-sm text-accent hover:underline min-h-10 inline-flex items-center"
                    >
                      Ver conversación
                    </Link>
                  ) : null}
                </div>
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  {lead.phone ? (
                    <div>
                      <dt className="text-xs text-muted">Teléfono</dt>
                      <dd>{lead.phone}</dd>
                    </div>
                  ) : null}
                  {lead.email ? (
                    <div>
                      <dt className="text-xs text-muted">Email</dt>
                      <dd className="break-all">{lead.email}</dd>
                    </div>
                  ) : null}
                </dl>
                {lead.message ? (
                  <p className="text-sm text-muted whitespace-pre-wrap">
                    {lead.message}
                  </p>
                ) : null}
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
