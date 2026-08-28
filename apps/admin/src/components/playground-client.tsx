'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentConfig, Business, ChatResponse } from '@/lib/types';
import { PlaygroundToolsPanel } from '@/components/playground-tools-panel';

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
  brandingConfig?: { logoUrl?: string | null } | null;
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

let _ctx: AudioContext | null = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  if (_ctx) return _ctx;
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  if (!Ctx) return null;
  _ctx = new Ctx();
  return _ctx;
}
function tone(freq: number, t0: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function playSendSound() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(900, t, 0.08, 0.18, 'sine');
  } catch {}
}
function playReceiveSound() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(700, t, 0.09, 0.2, 'sine');
    tone(1050, t + 0.12, 0.14, 0.2, 'sine');
  } catch {}
}

export function PlaygroundClient() {
  const businessQuery = useQuery({
    queryKey: ['business'],
    queryFn: () => api<BusinessWithAgents>('/admin/business'),
  });

  const business = businessQuery.data;
  const agents = business?.agentConfigs ?? [];
  const defaultAgent = agents.find((item) => item.isDefault) ?? agents[0] ?? null;

  const [agentId, setAgentId] = useState<string>('');
  const agent = agents.find((item) => item.id === (agentId || defaultAgent?.id)) ?? defaultAgent;

  const [input, setInput] = useState('Hola, quiero sacar un turno');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Array<{ role: string; content: string; debug?: ChatResponse['debug']; at: string }>>([]);
  const [debug, setDebug] = useState<ChatResponse['debug']>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);
  const [openDebug, setOpenDebug] = useState(false);
  const [openTools, setOpenTools] = useState(false);
  const [openTimeline, setOpenTimeline] = useState(false);
  const [openRag, setOpenRag] = useState(false);
  const [openHist, setOpenHist] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const executionsQuery = useQuery({
    queryKey: ['executions', conversationId],
    queryFn: () =>
      api<ExecutionListItem[]>(
        conversationId ? `/admin/executions?limit=12&conversationId=${conversationId}` : '/admin/executions?limit=12',
      ),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  function resetSession() {
    setConversationId(undefined);
    setMessages([]);
    setDebug(undefined);
    setError(null);
    setExpandedChunk(null);
    setExpandedTool(null);
    setShowPrompt(false);
  }

  async function send(override?: string) {
    const raw = override ?? input;
    if (!raw.trim() || !business?.id) return;
    const userMessage = raw.trim();
    playSendSound();
    setLoading(true);
    setError(null);
    const now = formatTime();
    setMessages((current) => [...current, { role: 'user', content: userMessage, at: now }]);
    setInput('');
    try {
      const result = await api<ChatResponse>('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          agentConfigId: agent?.id,
          conversationId,
          message: userMessage,
          channel: 'PLAYGROUND',
          debug: true,
          metadata: { source: 'playground' },
        }),
      });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { role: 'assistant', content: result.message, debug: result.debug, at: formatTime() }]);
      setDebug(result.debug);
      playReceiveSound();
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
    return <p className="text-sm text-rose">{(businessQuery.error as Error)?.message ?? 'No hay un negocio configurado. Ejecutá el seed.'}</p>;
  }

  return (
    <div className="flex flex-col items-center gap-6 min-w-0">
      <div className="w-full flex justify-center">
        <div className="w-full max-w-[390px] flex flex-col items-center min-w-0">
          <div className="w-full flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="hidden sm:inline text-[11px] tracking-wide text-muted truncate">{business.name} ·</span>
              {agents.length > 1 ? (
                <select
                  value={agent?.id ?? ''}
                  onChange={(e) => {
                    setAgentId(e.target.value);
                    resetSession();
                  }}
                  className="text-xs border border-line rounded-full bg-white px-2.5 py-1.5 outline-none focus:border-accent"
                >
                  {agents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted truncate">{agent?.name ?? '—'}</span>
              )}
              <span className="hidden sm:inline mono text-[10px] text-muted">{agent?.provider}/{agent?.model}</span>
            </div>
            <button type="button" className="text-xs rounded-full border border-line bg-white px-3 py-1.5 hover:bg-panel-2 shrink-0" onClick={resetSession}>
              Nueva sesión
            </button>
          </div>

          <div className="w-full bg-[#0B0F14] p-2 sm:p-2.5 rounded-[44px] shadow-[0_25px_80px_rgba(0,0,0,0.35),0_10px_30px_rgba(0,0,0,0.25)]">
            <div
              className="w-full bg-white rounded-[36px] overflow-hidden flex flex-col h-[740px] sm:h-[800px] sm:max-h-[min(800px,78vh)] border border-white/10"
              style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}
            >
              <div className="h-6 bg-white flex items-center justify-between px-6 pt-2 shrink-0">
                <span className="text-[11px] font-semibold text-[#111827]">9:41</span>
                <div className="w-20 h-5 bg-[#0B0F14] rounded-full" />
                <div className="flex items-center gap-1 text-[#111827]">
                  <svg viewBox="0 0 24 12" className="h-3 w-5" fill="currentColor"><path d="M1 6.5h2.5v3H1zM5 4h2.5v5.5H5zM9 2h2.5v7.5H9zM13 5h2.5v4.5H13z" opacity=".9" /><path d="M17.5 4.2h5.2a1.8 1.8 0 011.8 1.8v1a1.8 1.8 0 01-1.8 1.8h-5.2a1.8 1.8 0 01-1.8-1.8v-1a1.8 1.8 0 011.8-1.8Z" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
                </div>
              </div>

              <div className="flex items-center gap-3 px-4 py-3 bg-[#F8FAF8] border-b border-[#EDEEF0] shrink-0">
                <button type="button" className="h-8 w-8 grid place-items-center -ml-1 text-[#6B7280] hidden sm:grid">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <div className="relative shrink-0">
                  {business.brandingConfig?.logoUrl ? (
                    <img src={business.brandingConfig.logoUrl} alt={business.name} className="h-9 w-9 rounded-full object-cover bg-white border border-black/5 shadow-sm" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-[#0B1A2A] flex items-center justify-center text-white shadow-sm">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
                        <path d="M7 4c1.2 2.2 1.8 4.2 1.8 6.2 0 3.1-1.6 5.8 1.2 8.3 1-.9 2-1.6 3-1.6s2 .7 3 1.6c2.8-2.5 1.2-5.2 1.2-8.3C17.2 8.2 17.8 6.2 19 4c-1.1-.6-2.4-1-4-1-1 1.3-2 2-3 2s-2-.7-3-2c-1.6 0-2.9.4-4 1Z" />
                        <path d="M9 9.5h.01M15 9.5h.01" strokeLinecap="round" />
                      </svg>
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#25D366] border-2 border-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-none text-[#111827] truncate">{business.name}</p>
                  <p className="text-[11.5px] leading-none mt-1 flex items-center gap-1.5 text-[#667085]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#25D366]" />
                    Asistente virtual · En línea
                  </p>
                </div>
                <div className="flex items-center gap-0.5 text-[#99A1AF] shrink-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.04]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M14 3.5a2.5 2.5 0 013.5 3.5l-7 7-3 1 1-3 5.5-7a2.5 2.5 0 013-1.5Z" /><path d="M13 6l3 3" /></svg>
                  </span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.04]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="12" cy="12" r="1.6" /><circle cx="19.5" cy="12" r="1.6" /><circle cx="4.5" cy="12" r="1.6" /></svg>
                  </span>
                </div>
              </div>

              <div ref={scrollRef} className="pg-chat-bg flex-1 overflow-y-auto px-3.5 py-4 space-y-0.5 scroll-smooth min-h-0">
                <div className="flex justify-center mb-4">
                  <span className="rounded-full bg-white border border-black/5 shadow-sm px-3 py-1 text-[11px] font-medium text-muted tracking-wide">Hoy</span>
                </div>
                <div className="flex justify-center mb-4">
                  <span className="rounded-full bg-[#FFF8DC] border border-[#FDE68A]/50 px-3 py-1 text-[11px] text-[#92400E] text-center max-w-[85%]">🔒 Los mensajes están cifrados de extremo a extremo</span>
                </div>

                {!messages.length ? (
                  <div className="space-y-2.5">
                    <div className="pg-bubble-in flex justify-start">
                      <div className="max-w-[78%] rounded-[18px] rounded-bl-[6px] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.06)] px-3.5 py-2.5">
                        <p className="text-[14.5px] leading-[20px] text-[#111827]">Hola 👋 Soy el asistente de <b>{business.name}</b></p>
                        <p className="text-[14.5px] leading-[20px] text-[#111827] mt-1">¿En qué puedo ayudarte hoy?</p>
                        <span className="block text-right mono text-[10px] text-[#99A1AF] mt-1 -mb-0.5">{formatTime()}</span>
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[78%] flex flex-wrap gap-1.5 mt-1">
                        {['Quiero sacar un turno', '¿Qué servicios tienen?', 'Horarios de atención'].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => void send(q)}
                            className="rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs text-[#1F2937] hover:border-[#111827]/20 hover:bg-[#F9FAFB] transition text-left active:scale-[0.98]"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {messages.map((m, i) => {
                  const isUser = m.role === 'user';
                  return (
                    <div key={`${m.role}-${i}`} className={`pg-bubble-in flex ${isUser ? 'justify-end' : 'justify-start'} mt-2.5`} style={{ animationDelay: `${i * 18}ms` }}>
                      <div
                        className={`relative max-w-[78%] px-3.5 py-2.5 text-[14.5px] leading-[20px] break-words ${
                          isUser
                            ? 'bg-[#DCF8C6] text-[#111827] rounded-[18px] rounded-br-[6px] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                            : 'bg-white text-[#111827] rounded-[18px] rounded-bl-[6px] border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        <span className={`flex items-center gap-1 justify-end mt-1 -mb-0.5 mono text-[10px] ${isUser ? 'text-[#6B7C65]' : 'text-[#99A1AF]'}`}>
                          {m.at}
                          {isUser ? (
                            <svg viewBox="0 0 16 10" className="h-3 w-4 text-[#53BDEB]" fill="none"><path d="M2.5 5.5 5 8l3.5-5M7 8l3.5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {loading ? (
                  <div className="pg-bubble-in flex justify-start mt-2.5">
                    <div className="rounded-[18px] rounded-bl-[6px] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.06)] px-4 py-3.5">
                      <div className="flex items-center gap-1">
                        <span className="pg-typing-dot h-1.5 w-1.5 rounded-full bg-[#99A1AF]" />
                        <span className="pg-typing-dot h-1.5 w-1.5 rounded-full bg-[#99A1AF]" />
                        <span className="pg-typing-dot h-1.5 w-1.5 rounded-full bg-[#99A1AF]" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="bg-white border-t border-[#EDEEF0] px-3 py-3 shrink-0">
                <div className="flex items-end gap-2">
                  <div className="flex-1 flex items-center gap-1.5 bg-[#F0F2F5] rounded-[24px] px-2.5 py-1.5 border border-transparent focus-within:bg-white focus-within:border-[#E5E7EB] focus-within:shadow-sm transition">
                    <button type="button" aria-label="Emoji" className="h-8 w-8 grid place-items-center text-[#7D8698] hover:text-[#111827] shrink-0">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="8.5" /><path d="M8 14c1 1.2 2.3 1.8 4 1.8s3-.6 4-1.8" /><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" /></svg>
                    </button>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="Escribí un mensaje..."
                      disabled={loading || !agent}
                      className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px] placeholder:text-[#99A1AF] text-[#111827] py-1"
                    />
                    <button type="button" aria-label="Adjuntar" className="h-8 w-8 grid place-items-center text-[#7D8698] hover:text-[#111827] shrink-0 hidden sm:grid">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M12 18a4 4 0 0 0 4-4V8a3 3 0 0 0-6 0v8a2 2 0 0 0 4 0V9" /></svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={loading || !agent || !input.trim()}
                    className="h-10 w-10 rounded-full bg-[#111827] text-white grid place-items-center shrink-0 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98] shadow-sm"
                    aria-label="Enviar"
                  >
                    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 translate-x-[1px]" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7Z" strokeLinejoin="round" /></svg>
                  </button>
                </div>
                {error ? <p className="text-rose text-xs mt-2 whitespace-pre-wrap">{error}</p> : null}
              </div>

              <div className="flex justify-center pt-2 pb-1 bg-white">
                <div className="h-[5px] w-32 rounded-full bg-[#0B0F14]" />
              </div>
            </div>
          </div>

          {conversationId ? <p className="mono text-[10px] text-muted mt-2">conv {conversationId.slice(0, 8)}</p> : null}
        </div>
      </div>

      <div className="w-full max-w-[720px] space-y-3">
        <div className="panel rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpenDebug((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-panel-2/60 transition">
            <span className="mono text-[11px] text-muted">DEBUG {debug?.executionId ? `· ${debug.executionId.slice(0, 8)}` : ''}</span>
            <span className={`shrink-0 transition ${openDebug ? 'rotate-180' : ''}`}><svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {openDebug ? (
            <div className="px-5 pb-5 border-t border-line">
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted">Modelo</dt><dd className="mono text-xs">{debug ? `${debug.provider}/${debug.model}` : '—'}</dd></div>
                <div><dt className="text-muted">Estado</dt><dd className={`mono ${debug?.success === false ? 'text-rose' : 'text-teal'}`}>{debug ? (debug.success === false ? 'error' : 'ok') : '—'}</dd></div>
                <div><dt className="text-muted">Pasos</dt><dd className="mono">{debug?.steps ?? '—'}</dd></div>
                <div><dt className="text-muted">Latencia</dt><dd className="mono">{debug?.latencyMs !== undefined && debug.latencyMs !== null ? `${debug.latencyMs} ms` : '—'}</dd></div>
                <div><dt className="text-muted">Tokens in/out</dt><dd className="mono">{debug ? `${debug.inputTokens} / ${debug.outputTokens}` : '—'}</dd></div>
                <div><dt className="text-muted">Costo</dt><dd className="mono text-amber">{debug ? `$${debug.estimatedCost.toFixed(6)}` : '—'}</dd></div>
              </dl>
              {debug?.error ? <p className="mt-3 text-sm text-rose whitespace-pre-wrap">{debug.error}</p> : null}
              <label className="mt-4 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showPrompt} onChange={(e) => setShowPrompt(e.target.checked)} disabled={!debug?.systemPrompt} /> Ver system prompt</label>
              {showPrompt && debug?.systemPrompt ? <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-panel-2 p-3 mono text-[11px] text-muted whitespace-pre-wrap">{debug.systemPrompt}</pre> : null}
            </div>
          ) : null}
        </div>

        <div className="panel rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpenTools((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-panel-2/60 transition">
            <span className="mono text-[11px] text-muted">TOOLS DEL AGENTE</span>
            <span className={`shrink-0 transition ${openTools ? 'rotate-180' : ''}`}><svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {openTools ? <div className="px-5 pb-5 border-t border-line"><PlaygroundToolsPanel agentId={agent?.id} /></div> : null}
        </div>

        <div className="panel rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpenTimeline((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-panel-2/60 transition">
            <span className="mono text-[11px] text-muted">TOOL TIMELINE</span>
            <span className={`shrink-0 transition ${openTimeline ? 'rotate-180' : ''}`}><svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {openTimeline ? (
            <div className="px-5 pb-5 border-t border-line">
              <ol className="mt-4 space-y-2 text-sm">
                {(debug?.tools ?? []).map((tool, index) => (
                  <li key={`${tool.name}-${index}`} className="rounded-md border border-line px-3 py-2">
                    <button type="button" className="w-full text-left" onClick={() => setExpandedTool((c) => (c === index ? null : index))}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className={tool.success ? 'text-teal' : 'text-rose'}>{tool.step !== undefined && tool.step !== null ? `#${tool.step} · ` : ''}{tool.name}</span><span className="mono text-[11px] text-muted">{tool.durationMs !== undefined && tool.durationMs !== null ? `${tool.durationMs} ms` : '—'}</span></div>
                      {tool.error ? <p className="text-xs text-rose mt-1">{tool.error}</p> : null}
                    </button>
                    {expandedTool === index ? <pre className="mono text-[11px] text-muted whitespace-pre-wrap mt-2 max-h-48 overflow-auto">{JSON.stringify({ input: tool.input, output: tool.output }, null, 2)}</pre> : null}
                  </li>
                ))}
                {!debug?.tools?.length && <li className="text-muted">Sin tool calls en este turno{debug ? ' (puede haber respondido solo con el prompt)' : ''}</li>}
              </ol>
            </div>
          ) : null}
        </div>

        <div className="panel rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpenRag((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-panel-2/60 transition">
            <span className="mono text-[11px] text-muted">CONOCIMIENTO (RAG)</span>
            <span className={`shrink-0 transition ${openRag ? 'rotate-180' : ''}`}><svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {openRag ? (
            <div className="px-5 pb-5 border-t border-line">
              <ul className="mt-4 space-y-3 text-sm">
                {(debug?.ragChunks ?? []).map((chunk) => {
                  const title = (chunk.metadata?.title as string | undefined) || (chunk.metadata?.source as string | undefined) || chunk.id.slice(0, 8);
                  const open = expandedChunk === chunk.id;
                  return (
                    <li key={chunk.id} className="rounded-md border border-line p-3">
                      <button type="button" className="w-full text-left" onClick={() => setExpandedChunk((c) => (c === chunk.id ? null : chunk.id))}>
                        <p className="mono text-[11px] text-accent">{title} · score {chunk.score.toFixed(3)}</p>
                        <p className="text-muted mt-1">{open ? chunk.content : `${chunk.content.slice(0, 180)}${chunk.content.length > 180 ? '…' : ''}`}</p>
                      </button>
                    </li>
                  );
                })}
                {!debug?.ragChunks?.length && <li className="text-muted">Sin fragmentos recuperados</li>}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="panel rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpenHist((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-panel-2/60 transition">
            <span className="mono text-[11px] text-muted">HISTORIAL DE EJECUCIONES</span>
            <span className={`shrink-0 transition ${openHist ? 'rotate-180' : ''}`}><svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {openHist ? (
            <div className="px-5 pb-5 border-t border-line">
              <div className="mt-2 flex justify-end"><button type="button" className="text-[11px] text-accent" onClick={() => void executionsQuery.refetch()}>Actualizar</button></div>
              <ul className="mt-3 space-y-2 text-sm">
                {(executionsQuery.data ?? []).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div><p className={item.success ? 'text-teal' : 'text-rose'}>{item.success ? 'OK' : 'Error'} · {item.model}</p><p className="mono text-[11px] text-muted">{new Date(item.createdAt).toLocaleString('es-AR')} · {item.durationMs} ms · {item._count.toolExecutions} tools{item.error ? ` · ${item.error}` : ''}</p></div>
                    <span className="mono text-[10px] text-muted">{item.id.slice(0, 8)}</span>
                  </li>
                ))}
                {!executionsQuery.data?.length && <li className="text-muted">Sin ejecuciones todavía</li>}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
