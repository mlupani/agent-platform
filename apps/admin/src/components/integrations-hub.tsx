'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { GoogleCalendarConfigForm } from '@/components/google-calendar-config-form';
import { InstagramConfigForm } from '@/components/instagram-config-form';
import { WebChatConfigForm } from '@/components/web-chat-config-form';
import { WhatsAppConfigForm } from '@/components/whatsapp-config-form';
import {
  InstagramIconMono,
  WebChannelIcon,
  WhatsAppIcon,
} from '@/components/channel-icons';
import { api } from '@/lib/api';

type Panel = 'list' | 'whatsapp' | 'instagram' | 'web' | 'calendar';

interface WhatsAppPublicConfig {
  status: string;
  displayPhoneNumber?: string | null;
  meId?: string | null;
}

interface InstagramPublicConfig {
  status: string;
  username?: string | null;
}

interface GoogleCalendarPublicConfig {
  status: string;
  enabled: boolean;
  connectedEmail: string | null;
  hasRefreshToken?: boolean;
}

interface WebChatPublicConfig {
  status: string;
  enabled: boolean;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
        ok ? 'badge-success' : 'badge-muted'
      }`}
    >
      {label}
    </span>
  );
}

export function IntegrationsHub() {
  const [panel, setPanel] = useState<Panel>('list');

  const wa = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api<WhatsAppPublicConfig | null>('/admin/whatsapp'),
  });
  const ig = useQuery({
    queryKey: ['instagram-config'],
    queryFn: () => api<InstagramPublicConfig | null>('/admin/instagram'),
  });
  const cal = useQuery({
    queryKey: ['google-calendar-config'],
    queryFn: () =>
      api<GoogleCalendarPublicConfig | null>('/admin/calendar'),
  });
  const web = useQuery({
    queryKey: ['web-chat-config'],
    queryFn: () => api<WebChatPublicConfig | null>('/admin/web-chat'),
  });

  const waConnected = wa.data?.status === 'connected';
  const igConnected = ig.data?.status === 'connected';
  const webConnected =
    web.data?.status === 'connected' || web.data?.enabled === true;
  const calConnected =
    cal.data?.status === 'connected' ||
    (cal.data?.enabled === true && Boolean(cal.data?.hasRefreshToken === true || cal.data?.connectedEmail));

  const title = useMemo(() => {
    if (panel === 'whatsapp') return 'WhatsApp';
    if (panel === 'instagram') return 'Instagram';
    if (panel === 'web') return 'Web';
    if (panel === 'calendar') return 'Google Calendar';
    return 'Integraciones';
  }, [panel]);

  if (panel !== 'list') {
    return (
      <div className="space-y-6 max-w-3xl">
        <header className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPanel('list')}
            className="text-sm text-muted hover:text-text min-h-10 px-2 -ml-2"
          >
            ← Integraciones
          </button>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h2>
        </header>
        {panel === 'whatsapp' ? <WhatsAppConfigForm /> : null}
        {panel === 'instagram' ? <InstagramConfigForm /> : null}
        {panel === 'web' ? <WebChatConfigForm /> : null}
        {panel === 'calendar' ? <GoogleCalendarConfigForm /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Integraciones</h2>
        <p className="text-sm text-muted mt-1">
          Conecta los servicios que el agente usa para operar.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPanel('whatsapp')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#25D366]/15 grid place-items-center text-[#25D366]">
              <WhatsAppIcon className="h-5 w-5" title="WhatsApp" />
            </div>
            <StatusPill
              ok={waConnected}
              label={waConnected ? 'Conectado' : 'Desconectado'}
            />
          </div>
          <h3 className="mt-4 font-medium">WhatsApp</h3>
          <p className="mt-1 text-sm text-muted">
            Recibe mensajes de WhatsApp y deja que el agente responda.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('instagram')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] grid place-items-center text-white">
              <InstagramIconMono className="h-5 w-5" title="Instagram" />
            </div>
            <StatusPill
              ok={igConnected}
              label={igConnected ? 'Conectado' : 'Desconectado'}
            />
          </div>
          <h3 className="mt-4 font-medium">Instagram</h3>
          <p className="mt-1 text-sm text-muted">
            Direct Messages en la misma bandeja que WhatsApp.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('web')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-accent-soft grid place-items-center text-accent">
              <WebChannelIcon className="h-5 w-5" title="Web" />
            </div>
            <StatusPill
              ok={webConnected}
              label={webConnected ? 'Conectado' : 'Desconectado'}
            />
          </div>
          <h3 className="mt-4 font-medium">Web</h3>
          <p className="mt-1 text-sm text-muted">
            Chat embebido en tu landing, con API key propia.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('calendar')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-accent-soft grid place-items-center text-accent text-lg font-bold">
              G
            </div>
            <StatusPill
              ok={Boolean(calConnected)}
              label={calConnected ? 'Conectado' : 'Desconectado'}
            />
          </div>
          <h3 className="mt-4 font-medium">Google Calendar</h3>
          <p className="mt-1 text-sm text-muted">
            Sincroniza citas con tu calendario.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>
      </div>
    </div>
  );
}
