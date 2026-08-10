'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface AppointmentRow {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  timezone: string;
  service: { id: string; name: string; durationMinutes: number } | null;
}

export function AppointmentsPanel() {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => api<AppointmentRow[]>('/admin/appointments'),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      api(`/admin/appointments/${id}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const upcoming = data.filter((item) => item.status !== 'cancelled');

  return (
    <section className="panel rounded-xl p-5 space-y-4">
      <div>
        <h3 className="font-medium">Próximas citas</h3>
        <p className="text-sm text-muted mt-1">
          Vista rápida del calendario local del negocio.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : !upcoming.length ? (
        <p className="text-sm text-muted">No hay citas todavía.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {upcoming.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2"
            >
              <div>
                <p className="font-medium">
                  {item.service?.name ?? 'Cita'} ·{' '}
                  {item.contactName || item.contactPhone || 'Sin contacto'}
                </p>
                <p className="mono text-xs text-muted mt-1">
                  {new Date(item.startsAt).toLocaleString('es-AR', {
                    timeZone: item.timezone,
                  })}{' '}
                  · {item.status}
                </p>
              </div>
              {item.status !== 'cancelled' ? (
                <button
                  type="button"
                  className="text-xs text-rose"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(item.id)}
                >
                  Cancelar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
