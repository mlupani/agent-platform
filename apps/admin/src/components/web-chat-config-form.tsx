'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { WebChannelIcon } from '@/components/channel-icons';
import { api } from '@/lib/api';

interface WebChatPublicConfig {
  id: string;
  businessId: string;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  apiKeyPrefix: string | null;
  allowedOrigins: string[];
  lastError: string | null;
  lastUsedAt: string | null;
  widgetUrl: string;
  conversationsUrl: string;
  apiKey?: string;
}

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
};

function snippetFor(config: WebChatPublicConfig, apiKey: string) {
  return `const res = await fetch("${config.widgetUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${apiKey}"
  },
  body: JSON.stringify({
    message: "Quiero conocer los horarios",
    conversationId: localStorage.getItem("nlw_web_conversation") || undefined,
    source: "website"
  })
});
const data = await res.json();
localStorage.setItem("nlw_web_conversation", data.conversationId);
console.log(data.message);`;
}

export function WebChatConfigForm() {
  const queryClient = useQueryClient();
  const [originsText, setOriginsText] = useState<string | null>(null);
  const [plainApiKey, setPlainApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<'key' | 'snippet' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['web-chat-config'],
    queryFn: () => api<WebChatPublicConfig>('/admin/web-chat'),
  });

  const originsValue =
    originsText ?? (data?.allowedOrigins ?? []).join('\n');

  const save = useMutation({
    mutationFn: async (payload: {
      enabled?: boolean;
      allowedOrigins?: string[];
    }) =>
      api<WebChatPublicConfig>('/admin/web-chat', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setOriginsText(null);
      await queryClient.invalidateQueries({ queryKey: ['web-chat-config'] });
    },
  });

  const generateKey = useMutation({
    mutationFn: async () =>
      api<WebChatPublicConfig>('/admin/web-chat/api-key', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async (result) => {
      setPlainApiKey(result.apiKey ?? null);
      await queryClient.invalidateQueries({ queryKey: ['web-chat-config'] });
    },
  });

  const snippet = useMemo(() => {
    if (!data) return '';
    return snippetFor(data, plainApiKey || 'nlw_TU_API_KEY');
  }, [data, plainApiKey]);

  async function copy(kind: 'key' | 'snippet', value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (isLoading || !data) {
    return <p className="text-sm text-muted">Cargando canal Web…</p>;
  }

  const connected = data.status === 'connected' && data.enabled;
  const parsedOrigins = originsValue
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="panel rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-accent-soft grid place-items-center text-accent shrink-0">
              <WebChannelIcon className="h-5 w-5" title="Web" />
            </div>
            <div>
              <h3 className="font-medium">Web</h3>
              <p className="text-sm text-muted mt-1">
                Widget de chat para tu landing. Al conectar este canal, el
                agente ya responde: no hay un interruptor aparte.
              </p>
            </div>
          </div>
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              connected ? 'badge-success' : 'badge-muted'
            }`}
          >
            {statusLabel[data.status] ?? data.status}
          </span>
        </div>
        {data.lastError ? (
          <p className="text-sm text-rose">{data.lastError}</p>
        ) : null}
      </div>

      <section className="panel rounded-xl p-5 space-y-4">
        <div>
          <h4 className="font-medium">API key</h4>
          <p className="text-sm text-muted mt-1">
            El widget la envía en <code className="text-xs">x-api-key</code>.
            Guardamos solo el hash: copiá la clave ahora, no se vuelve a
            mostrar.
          </p>
        </div>

        {plainApiKey ? (
          <div className="rounded-lg border border-line bg-panel-2 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted">
              Clave nueva (una sola vez)
            </p>
            <code className="block text-sm break-all">{plainApiKey}</code>
            <button
              type="button"
              className="text-xs rounded-lg border border-line px-2.5 py-1.5 hover:bg-panel"
              onClick={() => void copy('key', plainApiKey)}
            >
              {copied === 'key' ? 'Copiada' : 'Copiar clave'}
            </button>
          </div>
        ) : data.hasApiKey ? (
          <p className="text-sm text-muted">
            Clave activa: <span className="font-mono">{data.apiKeyPrefix}…</span>
          </p>
        ) : (
          <p className="text-sm text-muted">Todavía no hay una API key.</p>
        )}

        <button
          type="button"
          className="rounded-lg bg-accent text-white px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
          disabled={generateKey.isPending}
          onClick={() => {
            if (
              data.hasApiKey &&
              !confirm('Esto invalida la clave anterior. ¿Generar una nueva?')
            ) {
              return;
            }
            generateKey.mutate();
          }}
        >
          {generateKey.isPending
            ? 'Generando…'
            : data.hasApiKey
              ? 'Regenerar API key'
              : 'Generar API key'}
        </button>
        {generateKey.error ? (
          <p className="text-sm text-rose">
            {(generateKey.error as Error).message}
          </p>
        ) : null}
      </section>

      <section className="panel rounded-xl p-5 space-y-4">
        <div>
          <h4 className="font-medium">Orígenes permitidos</h4>
          <p className="text-sm text-muted mt-1">
            Un origen por línea, p.ej. <code>https://midominio.com</code>.
            Vacío = cualquier origen (la API key sigue siendo obligatoria).
          </p>
        </div>
        <textarea
          value={originsValue}
          onChange={(event) => setOriginsText(event.target.value)}
          rows={4}
          className="w-full min-h-24 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-mono"
          placeholder={'https://midominio.com\nhttps://www.midominio.com'}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={!data.hasApiKey || save.isPending}
              onChange={(event) =>
                save.mutate({ enabled: event.target.checked })
              }
            />
            Canal activo
          </label>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-panel-2"
            disabled={save.isPending}
            onClick={() => save.mutate({ allowedOrigins: parsedOrigins })}
          >
            {save.isPending ? 'Guardando…' : 'Guardar orígenes'}
          </button>
        </div>
        {save.error ? (
          <p className="text-sm text-rose">{(save.error as Error).message}</p>
        ) : null}
      </section>

      <section className="panel rounded-xl p-5 space-y-3">
        <div>
          <h4 className="font-medium">Cómo llamarlo</h4>
          <p className="text-sm text-muted mt-1">
            POST {data.widgetUrl}. Guardá <code>conversationId</code> para
            continuar el mismo chat.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-line bg-panel-2 p-3 text-xs leading-5">
          {snippet}
        </pre>
        <button
          type="button"
          className="text-xs rounded-lg border border-line px-2.5 py-1.5 hover:bg-panel"
          onClick={() => void copy('snippet', snippet)}
        >
          {copied === 'snippet' ? 'Copiado' : 'Copiar snippet'}
        </button>
      </section>
    </div>
  );
}
