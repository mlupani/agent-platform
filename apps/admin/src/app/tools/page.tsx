import { api } from '@/lib/api';
import type { RegisteredTool } from '@/lib/types';

export default async function ToolsPage() {
  const tools = await api<RegisteredTool[]>('/admin/tools').catch(() => []);

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">06 / TOOLS</p>
        <h2 className="mt-2 text-3xl font-semibold">Tool registry</h2>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {tools.map((tool) => (
          <article key={tool.name} className="panel rounded-xl p-5">
            <div className="flex items-center justify-between">
              <h3 className="mono text-sm">{tool.name}</h3>
              <span className="mono text-[11px] text-amber">{tool.risk}</span>
            </div>
            <p className="mt-3 text-sm text-muted">{tool.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
