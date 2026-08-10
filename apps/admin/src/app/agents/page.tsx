import { api } from '@/lib/api';
import type { Business } from '@/lib/types';

export default async function AgentsPage() {
  const businesses = await api<Business[]>('/admin/businesses').catch(() => []);
  const agents = businesses.flatMap((business) =>
    (business.agentConfigs ?? []).map((agent) => ({ ...agent, businessName: business.name })),
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">03 / AGENTS</p>
        <h2 className="mt-2 text-3xl font-semibold">Agentes</h2>
      </header>
      <div className="space-y-3">
        {agents.map((agent) => (
          <article key={agent.id} className="panel rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">{agent.name}</h3>
                <p className="text-sm text-muted">{agent.businessName}</p>
              </div>
              <p className="mono text-xs text-teal">
                {agent.provider}/{agent.model} · temp {agent.temperature} · maxSteps {agent.maxSteps}
              </p>
            </div>
            <p className="mt-3 text-sm text-muted line-clamp-3">{agent.systemPrompt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
