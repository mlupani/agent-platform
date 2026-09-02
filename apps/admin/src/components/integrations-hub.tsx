'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoogleCalendarConfigForm } from '@/components/google-calendar-config-form';
import { VapiCallConfigForm } from '@/components/vapi-call-config-form';
import { WebChatConfigForm } from '@/components/web-chat-config-form';
import { WhatsAppConfigForm } from '@/components/whatsapp-config-form';
import { ZernioSocialForm } from '@/components/zernio-social-form';
import {
  FacebookIcon,
  InstagramIconMono,
  TikTokIcon,
  VoiceChannelIcon,
  WebChannelIcon,
  WhatsAppIcon,
} from '@/components/channel-icons';
import { api } from '@/lib/api';

type Panel =
  | 'list'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'web'
  | 'calendar'
  | 'calls';

interface WhatsAppPublicConfig {
  status: string;
  displayPhoneNumber?: string | null;
  meId?: string | null;
  agentEnabled?: boolean;
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

interface SocialListResponse {
  configured: boolean;
  connections: Array<{
    platform: 'instagram' | 'tiktok' | 'facebook';
    status: string;
    agentEnabled?: boolean;
  }>;
}

function socialPanelFromQuery(value: string | null): Panel | null {
  if (value === 'facebook' || value === 'instagram' || value === 'tiktok') {
    return value;
  }
  return null;
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
  const searchParams = useSearchParams();
  const connectedBanner = searchParams.get('connected');
  const socialError = searchParams.get('socialError');
  const [panel, setPanel] = useState<Panel>(
    () =>
      socialPanelFromQuery(searchParams.get('socialPlatform')) ??
      socialPanelFromQuery(connectedBanner) ??
      'list',
  );

  const wa = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api<WhatsAppPublicConfig | null>('/admin/whatsapp'),
  });
  const social = useQuery({
    queryKey: ['social-connections'],
    queryFn: () => api<SocialListResponse>('/admin/social'),
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
  const calls = useQuery({
    queryKey: ['vapi-call-config'],
    queryFn: () =>
      api<{ status: string; enabled: boolean; agentEnabled: boolean } | null>(
        '/admin/calls',
      ),
  });
  const callsConnected = calls.data?.status === 'connected';

  const waConnected = wa.data?.status === 'connected';
  const igConnection = social.data?.connections.find(
    (item) => item.platform === 'instagram',
  );
  const facebookConnection = social.data?.connections.find(
    (item) => item.platform === 'facebook',
  );
  const tiktokConnection = social.data?.connections.find(
    (item) => item.platform === 'tiktok',
  );
  const igConnected = igConnection?.status === 'connected';
  const facebookConnected = facebookConnection?.status === 'connected';
  const tiktokConnected = tiktokConnection?.status === 'connected';
  const webConnected =
    web.data?.status === 'connected' || web.data?.enabled === true;
  const calConnected =
    cal.data?.status === 'connected' ||
    (cal.data?.enabled === true && Boolean(cal.data?.hasRefreshToken === true || cal.data?.connectedEmail));

  const title = useMemo(() => {
    if (panel === 'whatsapp') return 'WhatsApp';
    if (panel === 'instagram') return 'Instagram';
    if (panel === 'facebook') return 'Facebook';
    if (panel === 'tiktok') return 'TikTok';
    if (panel === 'web') return 'Web';
    if (panel === 'calendar') return 'Google Calendar';
    if (panel === 'calls') return 'Llamadas';
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
        {socialError ? (
          <p className="text-sm rounded-xl bg-rose-500/10 text-rose px-4 py-3 break-words">
            {socialError}
          </p>
        ) : null}
        {panel === 'whatsapp' ? <WhatsAppConfigForm /> : null}
        {panel === 'instagram' ? (
          <ZernioSocialForm platform="instagram" />
        ) : null}
        {panel === 'facebook' ? (
          <ZernioSocialForm platform="facebook" />
        ) : null}
        {panel === 'tiktok' ? <ZernioSocialForm platform="tiktok" /> : null}
        {panel === 'web' ? <WebChatConfigForm /> : null}
        {panel === 'calendar' ? <GoogleCalendarConfigForm /> : null}
        {panel === 'calls' ? <VapiCallConfigForm /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Integraciones</h2>
        <p className="text-sm text-muted mt-1">
          Conectá cada canal para publicar, atender mensajes y manejar el
          asistente.
        </p>
      </header>

      {connectedBanner ? (
        <p className="text-sm rounded-xl bg-emerald-500/12 text-emerald-900 px-4 py-3">
          {connectedBanner === 'tiktok'
            ? 'TikTok quedó conectado para publicar.'
            : connectedBanner === 'facebook'
              ? 'Facebook quedó conectado para publicar y recibir Messenger.'
              : 'Instagram quedó conectado para publicar y recibir Direct.'}
        </p>
      ) : null}
      {socialError ? (
        <p className="text-sm rounded-xl bg-rose-500/10 text-rose px-4 py-3 break-words">
          {socialError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPanel('whatsapp')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#25D366]/15 grid place-items-center text-[#25D366]">
              <WhatsAppIcon className="h-5 w-5" title="WhatsApp" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill
                ok={waConnected}
                label={waConnected ? 'Conectado' : 'Desconectado'}
              />
              {waConnected ? (
                <StatusPill
                  ok={wa.data?.agentEnabled !== false}
                  label={
                    wa.data?.agentEnabled !== false
                      ? 'Agente activo'
                      : 'Agente inactivo'
                  }
                />
              ) : null}
            </div>
          </div>
          <h3 className="mt-4 font-medium">WhatsApp</h3>
          <p className="mt-1 text-sm text-muted">
            Conectá WhatsApp, atendé mensajes, publicá Estados y activá o
            pausá el asistente.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('instagram')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] grid place-items-center text-white">
              <InstagramIconMono className="h-5 w-5" title="Instagram" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill
                ok={Boolean(igConnected)}
                label={igConnected ? 'Conectado' : 'Desconectado'}
              />
              {igConnected ? (
                <StatusPill
                  ok={igConnection?.agentEnabled !== false}
                  label={
                    igConnection?.agentEnabled !== false
                      ? 'Agente activo'
                      : 'Agente inactivo'
                  }
                />
              ) : null}
            </div>
          </div>
          <h3 className="mt-4 font-medium">Instagram</h3>
          <p className="mt-1 text-sm text-muted">
            Conectá Instagram, publicá Feed, Stories y Reels, contestá mensajes y
            activá o pausá el asistente.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('facebook')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#1877F2] grid place-items-center text-white">
              <FacebookIcon className="h-5 w-5" title="Facebook" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill
                ok={Boolean(facebookConnected)}
                label={facebookConnected ? 'Conectado' : 'Desconectado'}
              />
              {facebookConnected ? (
                <StatusPill
                  ok={facebookConnection?.agentEnabled !== false}
                  label={
                    facebookConnection?.agentEnabled !== false
                      ? 'Agente activo'
                      : 'Agente inactivo'
                  }
                />
              ) : null}
            </div>
          </div>
          <h3 className="mt-4 font-medium">Facebook</h3>
          <p className="mt-1 text-sm text-muted">
            Conectá una Página (no el perfil personal) para publicar y atender
            Messenger.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('tiktok')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-black grid place-items-center text-white">
              <TikTokIcon className="h-5 w-5" title="TikTok" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill
                ok={Boolean(tiktokConnected)}
                label={tiktokConnected ? 'Conectado' : 'Desconectado'}
              />
              {tiktokConnected ? (
                <StatusPill
                  ok={tiktokConnection?.agentEnabled !== false}
                  label={
                    tiktokConnection?.agentEnabled !== false
                      ? 'Agente activo'
                      : 'Agente inactivo'
                  }
                />
              ) : null}
            </div>
          </div>
          <h3 className="mt-4 font-medium">TikTok</h3>
          <p className="mt-1 text-sm text-muted">
            Conectá TikTok y publicá videos cortos. No trae mensajes a
            Conversaciones.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('web')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
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
            Conectá el chat en tu web para que el asistente atienda a quien
            entre a la landing.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('calendar')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
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
            Conectá tu agenda para que el asistente pueda ver disponibilidad, reservar turnos y evitar
            choques de citas.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel('calls')}
          className="panel rounded-2xl p-5 text-left hover:border-text/20 transition group cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl bg-accent-soft grid place-items-center text-accent">
              <VoiceChannelIcon className="h-5 w-5" title="Llamadas" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill
                ok={callsConnected}
                label={callsConnected ? 'Conectado' : 'Desconectado'}
              />
              {callsConnected ? (
                <StatusPill
                  ok={calls.data?.agentEnabled !== false}
                  label={
                    calls.data?.agentEnabled !== false
                      ? 'Asistente activo'
                      : 'Asistente inactivo'
                  }
                />
              ) : null}
            </div>
          </div>
          <h3 className="mt-4 font-medium">Llamadas</h3>
          <p className="mt-1 text-sm text-muted">
            Conectá un número de Vapi para que el asistente atienda llamadas
            entrantes.
          </p>
          <div className="mt-4 flex justify-end text-muted group-hover:text-text">
            →
          </div>
        </button>
      </div>
    </div>
  );
}
