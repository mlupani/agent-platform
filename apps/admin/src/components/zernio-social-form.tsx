'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FacebookIcon, InstagramIconMono, TikTokIcon } from '@/components/channel-icons';
import { ChannelAgentRadios } from '@/components/channel-agent-radios';
import { api } from '@/lib/api';

interface SocialConnectionPublic {
  platform: 'instagram' | 'tiktok' | 'facebook';
  status: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  lastError: string | null;
  agentEnabled: boolean;
  updatedAt: string;
}

interface SocialListResponse {
  configured: boolean;
  connections: SocialConnectionPublic[];
}

interface ZernioSocialFormProps {
  platform: 'instagram' | 'tiktok' | 'facebook';
}

const COPY: Record<
  'instagram' | 'tiktok' | 'facebook',
  { title: string; subtitle: string; hint: string }
> = {
  instagram: {
    title: 'Instagram',
    subtitle:
      'Conectá la cuenta para publicar Feed, Stories y Reels, atender Direct en Conversaciones y activar o pausar el asistente.',
    hint: 'Los Direct llegan a Conversaciones. Podés dejar Instagram conectado y el asistente apagado si querés responder vos.',
  },
  facebook: {
    title: 'Facebook',
    subtitle:
      'Conectá una Página de Facebook (no el perfil personal) para publicar Feed, Stories y Reels, y atender Messenger.',
    hint: 'Tenés que ser administrador o editor de al menos una Página. En Meta, aceptá todos los permisos, en especial el de ver las Páginas. Si la Página está en Business Manager, usá la cuenta que la administra.',
  },
  tiktok: {
    title: 'TikTok',
    subtitle:
      'Conectá la cuenta para publicar videos cortos. TikTok no trae mensajes a esta bandeja.',
    hint: 'Al conectar, TikTok pide permiso de vista previa y publicación.',
  },
};

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  revoked: 'Revocado',
  error: 'Error',
};

export function ZernioSocialForm({ platform }: ZernioSocialFormProps) {
  const queryClient = useQueryClient();
  const copy = COPY[platform];

  const { data, isLoading } = useQuery({
    queryKey: ['social-connections'],
    queryFn: () => api<SocialListResponse>('/admin/social'),
  });

  const connect = useMutation({
    mutationFn: async () =>
      api<{ authUrl: string }>('/admin/social/connect', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      }),
    onSuccess: (result) => {
      window.location.href = result.authUrl;
    },
  });

  const disconnect = useMutation({
    mutationFn: async () =>
      api(`/admin/social/${platform}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['social-connections'] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const setAgent = useMutation({
    mutationFn: async (agentEnabled: boolean) =>
      api<SocialConnectionPublic>(`/admin/social/${platform}/agent`, {
        method: 'PATCH',
        body: JSON.stringify({ agentEnabled }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['social-connections'] });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando {copy.title}…</p>;
  }

  const connection = data?.connections.find((item) => item.platform === platform);
  const connected = connection?.status === 'connected';
  const status = connection?.status ?? 'disconnected';

  return (
    <div className="space-y-6">
      <div className="panel rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {platform === 'instagram' ? (
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] grid place-items-center text-white shrink-0">
                <InstagramIconMono className="h-5 w-5" title="Instagram" />
              </div>
            ) : platform === 'facebook' ? (
              <div className="h-10 w-10 rounded-xl bg-[#1877F2] grid place-items-center text-white shrink-0">
                <FacebookIcon className="h-5 w-5" title="Facebook" />
              </div>
            ) : (
              <div className="h-10 w-10 rounded-xl bg-black grid place-items-center text-white shrink-0">
                <TikTokIcon className="h-5 w-5" title="TikTok" />
              </div>
            )}
            <div>
              <h3 className="font-medium">{copy.title}</h3>
              <p className="text-sm text-muted mt-1">{copy.subtitle}</p>
            </div>
          </div>
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              connected
                ? 'badge-success'
                : status === 'error'
                  ? 'badge-warn'
                  : 'badge-muted'
            }`}
          >
            {statusLabel[status] ?? status}
          </span>
        </div>

        {!data?.configured ? (
          <p className="text-sm text-amber-800 bg-amber-500/10 rounded-xl px-3 py-2">
            Falta configurar <code>ZERNIO_API_KEY</code> en el servidor.
          </p>
        ) : null}

        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Usuario</dt>
            <dd className="font-medium">
              {connection?.username ? `@${connection.username}` : '—'}
            </dd>
          </div>
          {connection?.displayName ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Nombre</dt>
              <dd>{connection.displayName}</dd>
            </div>
          ) : null}
        </dl>

        {connection?.lastError ? (
          <p className="text-sm text-rose break-words">{connection.lastError}</p>
        ) : null}

        <p className="text-xs text-muted">{copy.hint}</p>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="btn-primary min-h-10"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || !data?.configured}
          >
            {connected ? 'Reconectar' : 'Conectar con Zernio'}
          </button>
          {connection ? (
            <button
              type="button"
              className="btn-secondary min-h-10 text-rose"
              onClick={() => {
                const ok =
                  platform === 'instagram'
                    ? confirm(
                        'Al desconectar se borran las conversaciones de Instagram de esta bandeja. Cuando vuelvas a conectar, se importan de nuevo.',
                      )
                    : platform === 'facebook'
                      ? confirm(
                          'Al desconectar se borran las conversaciones de Messenger de esta bandeja. Cuando vuelvas a conectar, se importan de nuevo.',
                        )
                      : confirm('¿Desconectar TikTok?');
                if (ok) disconnect.mutate();
              }}
              disabled={disconnect.isPending}
            >
              Desconectar
            </button>
          ) : null}
        </div>

        {connect.error ? (
          <p className="text-sm text-rose break-words">
            {connect.error instanceof Error
              ? connect.error.message
              : 'No se pudo iniciar la conexión'}
          </p>
        ) : null}
        {disconnect.error ? (
          <p className="text-sm text-rose break-words">
            {disconnect.error instanceof Error
              ? disconnect.error.message
              : 'No se pudo desconectar'}
          </p>
        ) : null}
      </div>

      {connection ? (
        <ChannelAgentRadios
          name={`${platform}-agent`}
          value={connection.agentEnabled !== false}
          disabled={setAgent.isPending}
          onChange={(next) => setAgent.mutate(next)}
          hint={
            platform === 'tiktok'
              ? 'TikTok no tiene DMs acá. El valor queda guardado para el canal; Instagram, Facebook y WhatsApp sí responden por inbox.'
              : platform === 'facebook'
                ? 'Facebook puede quedar conectado (publicar + Messenger) sin que el agente conteste los mensajes.'
                : 'Instagram puede quedar conectado (publicar + Direct) sin que el agente conteste los mensajes.'
          }
        />
      ) : (
        <p className="text-sm text-muted rounded-2xl border border-dashed border-line px-4 py-3">
          Conectá la cuenta para elegir si el agente responde en este canal.
        </p>
      )}
      {setAgent.error ? (
        <p className="text-sm text-rose break-words">
          {setAgent.error instanceof Error
            ? setAgent.error.message
            : 'No se pudo guardar el agente'}
        </p>
      ) : null}
    </div>
  );
}
