'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentConfig, Business, RegisteredTool } from '@/lib/types';

interface BusinessWithAgents extends Business {
  agentConfigs?: AgentConfig[];
}

interface PlaygroundToolsPanelProps {
  agentId?: string;
}

const TOOL_GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: 'Consulta',
    names: ['getBusinessInformation', 'getOpeningHours', 'getServices'],
  },
  {
    label: 'Agenda',
    names: [
      'checkAvailability',
      'createAppointment',
      'cancelAppointment',
      'rescheduleAppointment',
    ],
  },
  {
    label: 'Contacto',
    names: ['createLead', 'requestHumanAssistance'],
  },
  {
    label: 'Mensajes',
    names: ['sendEmail', 'sendWhatsAppMessage'],
  },
  {
    label: 'Automatización',
    names: ['triggerAutomation'],
  },
];

function riskBadgeClass(risk: string) {
  if (risk === 'READ') return 'badge-success';
  if (risk === 'SENSITIVE') return 'badge-warn';
  return 'badge-muted';
}

function ToolSwitch({
  name,
  enabled,
  disabled,
  onToggle,
}: {
  name: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Apagar' : 'Prender'} ${name}`}
      disabled={disabled}
      onClick={() => onToggle(name, !enabled)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 active:scale-[0.98] ${
        enabled ? 'bg-accent' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
          enabled ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

export function PlaygroundToolsPanel({ agentId }: PlaygroundToolsPanelProps) {
  const queryClient = useQueryClient();

  const businessQuery = useQuery({
    queryKey: ['business'],
    queryFn: () => api<BusinessWithAgents>('/admin/business'),
  });

  const toolsQuery = useQuery({
    queryKey: ['admin-tools'],
    queryFn: () => api<RegisteredTool[]>('/admin/tools'),
  });

  const agent = businessQuery.data?.agentConfigs?.find(
    (item) => item.id === agentId,
  );
  const enabledTools = agent?.enabledTools ?? [];
  const enabledSet = useMemo(() => new Set(enabledTools), [enabledTools]);

  const mutation = useMutation({
    mutationFn: (next: string[]) =>
      api<AgentConfig>(`/admin/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabledTools: next }),
      }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ['business'] });
      const previous = queryClient.getQueryData<BusinessWithAgents>([
        'business',
      ]);
      queryClient.setQueryData<BusinessWithAgents>(['business'], (current) => {
        if (!current || !agentId) return current;
        return {
          ...current,
          agentConfigs: current.agentConfigs?.map((item) =>
            item.id === agentId ? { ...item, enabledTools: next } : item,
          ),
        };
      });
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['business'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['business'] });
    },
  });

  const catalogByName = useMemo(() => {
    const map = new Map<string, RegisteredTool>();
    for (const tool of toolsQuery.data ?? []) map.set(tool.name, tool);
    return map;
  }, [toolsQuery.data]);

  const grouped = useMemo(() => {
    const used = new Set<string>();
    const sections = TOOL_GROUPS.map((group) => {
      const tools = group.names
        .map((name) => catalogByName.get(name))
        .filter((tool): tool is RegisteredTool => Boolean(tool));
      for (const tool of tools) used.add(tool.name);
      return { label: group.label, tools };
    }).filter((section) => section.tools.length > 0);

    const leftover = (toolsQuery.data ?? []).filter(
      (tool) => !used.has(tool.name),
    );
    if (leftover.length) {
      sections.push({ label: 'Otras', tools: leftover });
    }
    return sections;
  }, [catalogByName, toolsQuery.data]);

  function persist(next: string[]) {
    if (!agentId) return;
    mutation.mutate(next);
  }

  function toggleTool(name: string, enabled: boolean) {
    const next = enabled
      ? [...enabledTools.filter((item) => item !== name), name]
      : enabledTools.filter((item) => item !== name);
    persist(next);
  }

  function setAll(on: boolean) {
    const names = (toolsQuery.data ?? []).map((tool) => tool.name);
    persist(on ? names : []);
  }

  const total = toolsQuery.data?.length ?? 0;
  const active = enabledTools.filter((name) => catalogByName.has(name)).length;
  const busy = mutation.isPending || !agentId;

  return (
    <article className="panel rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono text-[11px] text-muted">TOOLS DEL AGENTE</p>
          <p className="mt-1 text-xs text-muted max-w-md">
            Prendé o apagá lo que este negocio puede hacer. Se guarda en el
            agente y aplica a web, WhatsApp e Instagram, no solo al playground.
          </p>
        </div>
        <p className="mono text-[11px] text-muted shrink-0">
          {total ? `${active} / ${total} activas` : '—'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs min-h-10 px-3"
          disabled={busy || !total}
          onClick={() => setAll(true)}
        >
          Prender todas
        </button>
        <button
          type="button"
          className="btn-secondary text-xs min-h-10 px-3"
          disabled={busy || !enabledTools.length}
          onClick={() => setAll(false)}
        >
          Apagar todas
        </button>
      </div>

      {mutation.error ? (
        <p className="mt-3 text-sm text-rose">
          {(mutation.error as Error).message || 'No se pudieron guardar las tools.'}
        </p>
      ) : null}

      {toolsQuery.isLoading ? (
        <p className="mt-4 text-sm text-muted">Cargando tools…</p>
      ) : null}

      {!toolsQuery.isLoading && !grouped.length ? (
        <p className="mt-4 text-sm text-muted">No se pudieron cargar las tools.</p>
      ) : null}

      <div className="mt-4 space-y-5">
        {grouped.map((section) => (
          <section key={section.label}>
            <p className="text-xs font-medium text-muted mb-2">
              {section.label}
            </p>
            <ul className="divide-y divide-line border-t border-line">
              {section.tools.map((tool) => {
                const enabled = enabledSet.has(tool.name);
                return (
                  <li
                    key={tool.name}
                    className="py-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="mono text-[11px] font-medium">
                          {tool.name}
                        </p>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${riskBadgeClass(tool.risk)}`}
                        >
                          {tool.risk}
                        </span>
                      </div>
                      <p className="text-muted mt-0.5 text-xs leading-snug">
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 min-h-11">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          enabled ? 'badge-success' : 'badge-muted'
                        }`}
                      >
                        {enabled ? 'ON' : 'OFF'}
                      </span>
                      <ToolSwitch
                        name={tool.name}
                        enabled={enabled}
                        disabled={busy}
                        onToggle={toggleTool}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
