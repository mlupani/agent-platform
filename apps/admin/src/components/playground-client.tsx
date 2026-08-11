'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AgentConfig,
  Business,
  ChatResponse,
  RegisteredTool,
} from '@/lib/types';

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

interface BusinessWithAgents extends Business {
  agentConfigs?: AgentConfig[];
}

function riskBadgeClass(risk: string) {
  if (risk === 'READ') return 'badge-success';
  if (risk === 'SENSITIVE') return 'badge-warn';
  return 'badge-muted';
}

export function PlaygroundClient() {
  const businessQuery = useQuery({
    queryKey: ['business'],
    queryFn: () => api<BusinessWithAgents>('/admin/business'),
  });

  const toolsQuery = useQuery({
    queryKey: ['admin-tools'],
    queryFn: () => api<RegisteredTool[]>('/admin/tools'),
  });

  const business = businessQuery.data;
  const agents = business?.agentConfigs ?? [];
  const defaultAgent =
    agents.find((item) => item.isDefault) ?? agents[0] ?? null;

  const [agentId, setAgentId] = useState<string>('');
  const agent =
    agents.find((item) => item.id === (agentId || defaultAgent?.id)) ??
    defaultAgent;

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
  const enabledSet = useMemo(() => new Set(selectedTools), [selectedTools]);

  const catalogTools = useMemo(() => {
    const list = toolsQuery.data ?? [];
    return [...list].sort((a, b) => {
      const aOn = enabledSet.has(a.name) ? 0 : 1;
      const bOn = enabledSet.has(b.name) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return a.name.localeCompare(b.name);
    });
  }, [toolsQuery.data, enabledSet]);

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
    if (!input.trim() || !business?.id) return;
    setLoading(true);
    setError(null);
    const userMessage = input.trim();
    setMessages((current) => [
      ...current,
      { role: 'user', content: userMessage },
    ]);
    setInput('');
    try {
      const result = await api<ChatResponse>('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          agentConfigId: agent?.id,
          conversationId,
          message: userMessage,
          channel: 'WEB',
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

  if (businessQuery.isLoading) {
    return <p className="text-sm text-muted">Cargando negocio…</p>;
  }

  if (businessQuery.error || !business) {
    return (
      <p className="text-sm text-rose">
        {(businessQuery.error as Error)?.message ??
          'No hay un negocio configurado. Ejecutá el seed.'}
      </p>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] min-w-0">
      <section className="panel rounded-xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">Negocio</p>
            <p className="font-medium truncate">{business.name}</p>
          </div>
          {agents.length > 1 ? (
            <label className="text-sm min-w-[12rem]">
              Agente
              <select
                className="input mt-1 w-full"
                value={agent?.id ?? ''}
                onChange={(event) => {
                  setAgentId(event.target.value);
                  resetSession();
                }}
              >
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="text-sm">
              <p className="text-xs text-muted">Agente</p>
              <p className="font-medium">{agent?.name ?? '—'}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <p className="mono text-xs text-muted break-all min-w-0">
            {agent?.provider}/{agent?.model} · temp {agent?.temperature} · tools{' '}
            {selectedTools.join(', ') || '—'}
            {conversationId ? ` · conv ${conversationId.slice(0, 8)}` : ''}
          </p>
          <button
            type="button"
            className="btn-secondary text-xs min-h-10 px-3"
            onClick={resetSession}
          >
            Nueva sesión
          </button>
        </div>

        <div className="min-h-72 max-h-[28rem] overflow-y-auto space-y-3 min-w-0 rounded-lg border border-line bg-panel-2/40 p-3">
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`rounded-lg px-3 py-2 text-sm break-words ${
                message.role === 'user'
                  ? 'bg-panel ml-6'
                  : 'bg-accent-soft mr-6'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="mono text-[10px] text-muted">
                  {message.role === 'user' ? 'Vos' : 'Agente'}
                </p>
                {message.debug ? (
                  <button
                    type="button"
                    className="mono text-[10px] text-accent min-h-8 px-1"
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
              Todavía no hay mensajes. Probá preguntar horarios, servicios o
              disponibilidad.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1 min-w-0 min-h-11"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Escribí un mensaje"
            disabled={loading || !agent}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !agent || !input.trim()}
            className="btn-primary shrink-0 min-h-11 px-4"
          >
            {loading ? '…' : 'Enviar'}
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
                {debug ? (debug.success === false ? 'error' : 'ok') : '—'}
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
            <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-panel-2 p-3 mono text-[11px] text-muted whitespace-pre-wrap">
              {debug.systemPrompt}
            </pre>
          ) : null}
        </article>

        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">TOOLS DISPONIBLES</p>
          <p className="mt-1 text-xs text-muted">
            Horarios y servicios suelen venir en el prompt (sin tool). Para ver
            el timeline, probá disponibilidad o reservar.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[20rem]">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-2 font-medium">Tool</th>
                  <th className="py-2 pr-2 font-medium">Riesgo</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {catalogTools.map((tool) => {
                  const enabled = enabledSet.has(tool.name);
                  return (
                    <tr
                      key={tool.name}
                      className="border-b border-line/70 align-top"
                    >
                      <td className="py-2 pr-2">
                        <p className="mono text-[11px] font-medium">
                          {tool.name}
                        </p>
                        <p className="text-muted mt-0.5 leading-snug">
                          {tool.description}
                        </p>
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${riskBadgeClass(tool.risk)}`}
                        >
                          {tool.risk}
                        </span>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            enabled ? 'badge-success' : 'badge-muted'
                          }`}
                        >
                          {enabled ? 'ON' : 'OFF'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!catalogTools.length && !toolsQuery.isLoading ? (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted">
                      No se pudieron cargar las tools.
                    </td>
                  </tr>
                ) : null}
                {toolsQuery.isLoading ? (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted">
                      Cargando tools…
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel rounded-xl p-5">
          <p className="mono text-[11px] text-muted">TOOL TIMELINE</p>
          <ol className="mt-3 space-y-2 text-sm">
            {(debug?.tools ?? []).map((tool, index) => (
              <li
                key={`${tool.name}-${index}`}
                className="rounded-md border border-line px-3 py-2"
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
              <li className="text-muted">
                Sin tool calls en este turno
                {debug
                  ? ' (puede haber respondido solo con el prompt)'
                  : ''}
              </li>
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
                <li
                  key={chunk.id}
                  className="rounded-md border border-line p-3"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setExpandedChunk((current) =>
                        current === chunk.id ? null : chunk.id,
                      )
                    }
                  >
                    <p className="mono text-[11px] text-accent">
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
            <p className="mono text-[11px] text-muted">
              HISTORIAL DE EJECUCIONES
            </p>
            <button
              type="button"
              className="text-[11px] text-accent"
              onClick={() => void executionsQuery.refetch()}
            >
              Actualizar
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {(executionsQuery.data ?? []).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2"
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
