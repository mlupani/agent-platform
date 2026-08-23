'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Chat web',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  TELEGRAM: 'Telegram',
  PLAYGROUND: 'Playground',
};

function channelLabel(channel: string | null) {
  if (!channel) return 'Sin canal';
  return CHANNEL_LABEL[channel.toUpperCase()] ?? channel;
}

export function LeadsList() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['leads'],
    queryFn: () => api<LeadRow[]>('/admin/leads'),
  });

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Leads</h2>
        <p className="text-sm text-muted mt-1">
          Contactos que el asistente guardó desde las conversaciones.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <section className="panel rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="p-5 text-sm text-muted">Cargando leads…</p>
        ) : !data.length ? (
          <p className="p-5 text-sm text-muted">
            Todavía no hay leads. Se guardan al reservar un turno o cuando el
            asistente registra un contacto.
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
                    <p className="text-xs text-muted mt-1">
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
