'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

interface CatalogService {
  id: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  enabled: boolean;
}

interface ClassTemplateRow {
  id: string;
  serviceId: string;
  dayOfWeek: number;
  startTime: string;
  capacity: number | null;
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    capacity: number;
  };
}

const DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

function effectiveCapacity(row: ClassTemplateRow) {
  return row.capacity ?? row.service.capacity ?? 1;
}

export function ClassSchedulePanel() {
  const queryClient = useQueryClient();
  const [serviceId, setServiceId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [startTime, setStartTime] = useState('09:00');
  const [capacity, setCapacity] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api<CatalogService[]>('/admin/services'),
  });
  const templatesQuery = useQuery({
    queryKey: ['class-templates'],
    queryFn: () => api<ClassTemplateRow[]>('/admin/class-templates'),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['class-templates'] });
    await queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api('/admin/class-templates', {
        method: 'POST',
        body: JSON.stringify({
          serviceId,
          dayOfWeek: Number(dayOfWeek),
          startTime,
          capacity: capacity.trim() ? Number(capacity) : null,
        }),
      }),
    onSuccess: async () => {
      setCapacity('');
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/class-templates/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      if (editingId) setEditingId(null);
      await invalidate();
    },
  });

  const services = (servicesQuery.data ?? []).filter((item) => item.enabled);
  const templates = templatesQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight">Horarios de clase</h3>
        <p className="text-sm text-muted mt-1">
          Armá y editá la semana modelo. El cupo de cada horario se puede cambiar sin borrar la clase.
        </p>
      </div>

      <form
        className="panel rounded-2xl p-5 grid gap-3 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!serviceId || create.isPending) return;
          create.mutate();
        }}
      >
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Servicio</span>
          <select
            className="input w-full"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            required
          >
            <option value="">Elegí un servicio</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · cupo {service.capacity ?? 1}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Día</span>
          <select
            className="input w-full"
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(event.target.value)}
          >
            {DAYS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Hora</span>
          <input
            className="input w-full"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Cupo</span>
          <input
            className="input w-full"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="Del servicio"
          />
        </label>
        <div className="sm:col-span-4">
          <button
            type="submit"
            className="btn-primary min-h-11 px-4"
            disabled={!serviceId || create.isPending}
          >
            {create.isPending ? 'Guardando…' : 'Agregar horario'}
          </button>
        </div>
        {create.isError ? (
          <p className="text-sm text-rose sm:col-span-4">
            {(create.error as Error).message || 'No se pudo crear el horario.'}
          </p>
        ) : null}
      </form>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {DAYS.map((label, day) => {
          const rows = templates
            .filter((item) => item.dayOfWeek === day)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <section
              key={label}
              className="rounded-xl border border-line bg-panel p-4 space-y-3"
            >
              <h4 className="text-sm font-semibold tracking-wide uppercase text-muted">
                {label}
              </h4>
              {rows.length ? (
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.id}>
                      {editingId === row.id ? (
                        <TemplateEditor
                          row={row}
                          services={services}
                          busy={remove.isPending}
                          onCancel={() => setEditingId(null)}
                          onSaved={async () => {
                            setEditingId(null);
                            await invalidate();
                          }}
                          onDelete={() => {
                            if (confirm('¿Borrar este horario de la grilla?')) {
                              remove.mutate(row.id);
                            }
                          }}
                        />
                      ) : (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                          <div>
                            <p className="font-medium tabular-nums">{row.startTime}</p>
                            <p className="text-xs text-muted">
                              {row.service.name} · cupo {effectiveCapacity(row)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              className="text-xs font-medium text-accent hover:underline"
                              onClick={() => setEditingId(row.id)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="text-xs text-rose hover:underline"
                              onClick={() => {
                                if (confirm('¿Borrar este horario de la grilla?')) {
                                  remove.mutate(row.id);
                                }
                              }}
                            >
                              Borrar
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Sin clases.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TemplateEditor({
  row,
  services,
  busy,
  onCancel,
  onSaved,
  onDelete,
}: {
  row: ClassTemplateRow;
  services: CatalogService[];
  busy: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
  onDelete: () => void;
}) {
  const [serviceId, setServiceId] = useState(row.serviceId);
  const [dayOfWeek, setDayOfWeek] = useState(String(row.dayOfWeek));
  const [startTime, setStartTime] = useState(row.startTime);
  const [capacity, setCapacity] = useState(
    String(row.capacity ?? row.service.capacity ?? 1),
  );

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/class-templates/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          serviceId,
          dayOfWeek: Number(dayOfWeek),
          startTime,
          capacity: capacity.trim() ? Number(capacity) : null,
        }),
      }),
    onSuccess: () => onSaved(),
  });

  return (
    <form
      className="rounded-xl border border-accent/30 bg-accent-soft/30 p-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending) return;
        save.mutate();
      }}
    >
      <label className="block space-y-1 text-xs">
        <span className="text-muted">Servicio</span>
        <select
          className="input w-full"
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
        >
          {(services.some((item) => item.id === row.serviceId)
            ? services
            : [row.service, ...services]
          ).map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1 text-xs col-span-1">
          <span className="text-muted">Día</span>
          <select
            className="input w-full"
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(event.target.value)}
          >
            {DAYS.map((label, index) => (
              <option key={label} value={index}>
                {label.slice(0, 3)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">Hora</span>
          <input
            className="input w-full"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">Cupo</span>
          <input
            className="input w-full"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            min={1}
          />
        </label>
      </div>
      {save.isError ? (
        <p className="text-xs text-rose">
          {(save.error as Error).message || 'No se pudo guardar.'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          className="btn-primary min-h-9 px-3 text-sm"
          disabled={save.isPending || busy}
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="text-xs text-muted hover:text-text"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="ml-auto text-xs text-rose hover:underline"
          onClick={onDelete}
        >
          Borrar
        </button>
      </div>
    </form>
  );
}
