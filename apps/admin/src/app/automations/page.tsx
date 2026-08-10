import { api } from '@/lib/api';
import type { Business } from '@/lib/types';

interface Automation {
  id: string;
  name: string;
  description?: string | null;
  webhookUrl: string;
  enabled: boolean;
}

export default async function AutomationsPage() {
  const businesses = await api<Business[]>('/admin/businesses').catch(() => []);
  const automations = await Promise.all(
    businesses.map(async (business) => ({
      business,
      items: await api<Automation[]>(`/admin/automations/business/${business.id}`).catch(
        () => [],
      ),
    })),
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">08 / AUTOMATIONS</p>
        <h2 className="mt-2 text-3xl font-semibold">Automatizaciones n8n</h2>
        <p className="text-sm text-muted mt-2">
          n8n solo para workflows periféricos. El Agent Core permanece en NestJS.
        </p>
      </header>
      {automations.map(({ business, items }) => (
        <article key={business.id} className="panel rounded-xl p-5">
          <h3 className="font-medium">{business.name}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.id}>
                <span className="mono text-teal">{item.name}</span>
                <span className="text-muted"> · {item.enabled ? 'enabled' : 'disabled'}</span>
                <p className="text-muted text-xs break-all">{item.webhookUrl}</p>
              </li>
            ))}
            {!items.length && <li className="text-muted">Sin automatizaciones</li>}
          </ul>
        </article>
      ))}
    </div>
  );
}
