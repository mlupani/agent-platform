import Link from 'next/link';
import { CreateBusinessForm } from '@/components/create-business-form';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';

export default async function BusinessesPage() {
  let businesses: Business[] = [];
  try {
    businesses = await api<Business[]>('/admin/businesses');
  } catch {
    businesses = [];
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="mono text-xs tracking-[0.24em] text-amber">02 / BUSINESSES</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold">Negocios</h2>
        </div>
        <CreateBusinessForm />
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {businesses.map((business) => (
          <Link
            key={business.id}
            href={`/businesses/${business.id}`}
            className="panel rounded-xl p-5 hover:border-teal/50 transition"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{business.name}</h3>
              <span className="mono text-xs text-teal">{business.type}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{business.description}</p>
            <p className="mono mt-4 text-xs text-muted">
              {business._count?.conversations ?? 0} conversaciones · {business.language} ·{' '}
              {business.timezone}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
