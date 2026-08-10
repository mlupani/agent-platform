'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Business, ChatResponse } from '@/lib/types';

interface PlaygroundClientProps {
  businesses: Business[];
}

interface ExecutionListItem {
  id: string;
  conversationId: string | null;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  durationMs: number;
  steps: number;
  success: boolean;
  error: string | null;
  createdAt: string;
  _count: { toolExecutions: number };
}

export function PlaygroundClient({ businesses }: PlaygroundClientProps) {
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? '');
  const business = businesses.find((item) => item.id === businessId);
  const agents = business?.agentConfigs ?? [];
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const agent = agents.find((item) => item.id === agentId) ?? agents[0];
  const [input, setInput] = useState('Hola, ¿cuál es el horario?');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string; debug?: ChatResponse['debug'] }>
  >([]);
  const [debug, setDebug] = useState<ChatResponse['debug']>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);

  const selectedTools = useMemo(() => agent?.enabledTools ?? [], [agent]);

  const executionsQuery = useQuery({
    queryKey: ['executions', conversationId],
    queryFn: () =>
      api<ExecutionListItem[]>(
        conversationId
          ? `/admin/executions?limit=12&conversationId=${conversationId}`
          : '/admin/executions?limit=12',
      ),
    refetchInterval: 15_000,
  });

  function resetSession() {
    setConversationId(undefined);
    setMessages([]);
    setDebug(undefined);
    setError(null);
    setExpandedChunk(null);
    setExpandedTool(null);
    setShowPrompt(false);
  }

  async function send() {
    if (!businessId || !input.trim()) return;
    setLoading(true);
    setError(null);
    const userMessage = input.trim();
    setMessages((current) => [...current, { role: 'user', content: userMessage }]);
    setInput('');
    try {
      const result = await api<ChatResponse>('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          businessId,
          agentConfigId: agent?.id,
          conversationId,
          message: userMessage,
          debug: true,
        }),
      });
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.message, debug: result.debug },
      ]);
      setDebug(result.debug);
      await executionsQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al chatear');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] min-w-0">
      <section className="panel rounded-xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Negocio
            <select
              className="mt-1 w-full rounded-md bg-ink border border-line px-3 py-2"
              value={businessId}
              onChange={(event) => {
                setBusinessId(event.target.value);
                resetSession();
                const next = businesses.find(
                  (item) => item.id === event.target.value,
                );
                setAgentId(next?.agentConfigs?.[0]?.id ?? '');
              }}
            >
              {businesses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Agente
            <select
              className="mt-1 w-full rounded-md bg-ink border border-line px-3 py-2"
              value={agent?.id ?? ''}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <p className="mono text-xs text-muted break-all min-w-0">
            {agent?.provider}/{agent?.model} · temp {agent?.temperature} · tools{' '}
            {selectedTools.join(', ') || '—'}
            {conversationId ? ` · conv ${conversationId.slice(0, 8)}` : ''}
          </p>
          <button
            type="button"
            className="text-xs text-muted hover:text-text min-h-10 px-2"
            onClick={resetSession}
          >
            Nueva sesión
          </button>
        </div>
        <div className="min-h-72 max-h-[28rem] overflow-y-auto space-y-3 min-w-0">
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`rounded-lg px-3 py-2 text-sm break-words ${
                message.role === 'user' ? 'bg-white/5' : 'bg-teal/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="mono text-[10px] text-muted">{message.role}</p>
                {message.debug ? (
                  <button
                    type="button"
                    className="mono text-[10px] text-teal min-h-8 px-1"
                    onClick={() => setDebug(message.debug)}
                  >
                    ver debug
                  </button>
                ) : null}
              </div>
              {message.content}
            </article>
          ))}
          {!messages.length && (
            <p className="text-sm text-muted">
              Todavía no hay mensajes en esta sesión.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 rounded-md bg-ink border border-line px-3 py-3 text-sm min-h-11"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Escribí un mensaje"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading}
            className="shrink-0 rounded-md bg-amber px-4 py-3 text-sm text-ink disabled:opacity-50 min-h-11"
          >
            {loading ? '...' : 'Enviar'}
          </button>
        </div>
        {error ? (
          <p className="text-rose text-sm whitespace-pre-wrap">{error}</p>
        ) : null}
      </section>

      <aside className="space-y-4">
        <article className="panel rounded-xl p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="mono text-[11px] text-muted">DEBUG</p>
            {debug?.executionId ? (
              <span className="mono text-[10px] text-muted">
                {debug.executionId.slice(0, 8)}
              </span>
            ) : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Modelo</dt>
              <dd className="mono text-xs">
                {debug ? `${debug.provider}/${debug.model}` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Estado</dt>
              <dd
                className={`mono ${
                  debug?.success === false ? 'text-rose' : 'text-teal'
                }`}
              >
                {debug
                  ? debug.success === false
                    ? 'error'
                    : 'ok'
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Pasos</dt>
              <dd className="mono">{debug?.steps ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Latencia</dt>
              <dd className="mono">
                {debug?.latencyMs != null ? `${debug.latencyMs} ms` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Tokens in/out</dt>
              <dd className="mono">
                {debug
                  ? `${debug.inputTokens} / ${debug.outputTokens}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Costo</dt>
              <dd className="mono text-amber">
                {debug ? `$${debug.estimatedCost.toFixed(6)}` : '—'}
              </dd>
            </div>
          </dl>
          {debug?.error ? (
            <p className="mt-3 text-sm text-rose whitespace-pre-wrap">
              {debug.error}
            </p>
          ) : null}
          <label className="mt-4 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showPrompt}
              onChange={(event) => setShowPrompt(event.target.checked)}
              disabled={!debug?.systemPrompt}
            />
            Ver system prompt
          </label>
          {showPrompt && debug?.systemPrompt ? (
            <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-ink/60 p-3 mono text-[11px] text-muted whitespace-pre-wrap">
              {debug.systemPrompt}
            </pre>
          ) : null}
        </article>

        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">TOOL TIMELINE</p>
          <ol className="mt-3 space-y-2 text-sm">
            {(debug?.tools ?? []).map((tool, index) => (
              <li
                key={`${tool.name}-${index}`}
                className="rounded-md border border-line/70 px-3 py-2"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() =>
                    setExpandedTool((current) =>
                      current === index ? null : index,
                    )
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={tool.success ? 'text-teal' : 'text-rose'}
                    >
                      {tool.step != null ? `#${tool.step} · ` : ''}
                      {tool.name}
                    </span>
                    <span className="mono text-[11px] text-muted">
                      {tool.durationMs != null ? `${tool.durationMs} ms` : '—'}
                    </span>
                  </div>
                  {tool.error ? (
                    <p className="text-xs text-rose mt-1">{tool.error}</p>
                  ) : null}
                </button>
                {expandedTool === index ? (
                  <pre className="mono text-[11px] text-muted whitespace-pre-wrap mt-2 max-h-48 overflow-auto">
                    {JSON.stringify(
                      { input: tool.input, output: tool.output },
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
              </li>
            ))}
            {!debug?.tools?.length && (
              <li className="text-muted">Sin tool calls en este turno</li>
            )}
          </ol>
        </article>

        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">CONOCIMIENTO (RAG)</p>
          <ul className="mt-3 space-y-3 text-sm">
            {(debug?.ragChunks ?? []).map((chunk) => {
              const title =
                (chunk.metadata?.title as string | undefined) ||
                (chunk.metadata?.source as string | undefined) ||
                chunk.id.slice(0, 8);
              const open = expandedChunk === chunk.id;
              return (
                <li key={chunk.id} className="rounded-md border border-line/70 p-3">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setExpandedChunk((current) =>
                        current === chunk.id ? null : chunk.id,
                      )
                    }
                  >
                    <p className="mono text-[11px] text-teal">
                      {title} · score {chunk.score.toFixed(3)}
                    </p>
                    <p className="text-muted mt-1">
                      {open
                        ? chunk.content
                        : `${chunk.content.slice(0, 180)}${
                            chunk.content.length > 180 ? '…' : ''
                          }`}
                    </p>
                  </button>
                </li>
              );
            })}
            {!debug?.ragChunks?.length && (
              <li className="text-muted">Sin fragmentos recuperados</li>
            )}
          </ul>
        </article>

        <article className="panel rounded-xl p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="mono text-[11px] text-muted">HISTORIAL DE EJECUCIONES</p>
            <button
              type="button"
              className="text-[11px] text-teal"
              onClick={() => void executionsQuery.refetch()}
            >
              Actualizar
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {(executionsQuery.data ?? []).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2"
              >
                <div>
                  <p className={item.success ? 'text-teal' : 'text-rose'}>
                    {item.success ? 'OK' : 'Error'} · {item.model}
                  </p>
                  <p className="mono text-[11px] text-muted">
                    {new Date(item.createdAt).toLocaleString('es-AR')} ·{' '}
                    {item.durationMs} ms · {item._count.toolExecutions} tools
                    {item.error ? ` · ${item.error}` : ''}
                  </p>
                </div>
                <span className="mono text-[10px] text-muted">
                  {item.id.slice(0, 8)}
                </span>
              </li>
            ))}
            {!executionsQuery.data?.length && (
              <li className="text-muted">Sin ejecuciones todavía</li>
            )}
          </ul>
        </article>
      </aside>
    </div>
  );
}
