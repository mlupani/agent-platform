'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PersonSheet, type PersonTarget } from '@/components/person-sheet';
import type {
  ClientRow,
  CatalogService,
  PaymentRow,
  PaymentStatsRow,
} from '@/lib/types';

function clientLabel(client: {
  name: string | null;
  phone: string | null;
  email: string | null;
}) {
  return client.name || client.phone || client.email || 'Sin nombre';
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function monthRange(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

function paymentsQueryPath(
  clientId: string,
  serviceId: string,
  from: string,
  to: string,
) {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (serviceId) params.set('serviceId', serviceId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/admin/payments${query ? `?${query}` : ''}`;
}

function statsQueryPath(clientId: string, from: string, to: string) {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/admin/payments/stats${query ? `?${query}` : ''}`;
}

function packLabel(pass: {
  sessionsPaid: number;
  sessionCount: number;
  remaining: number;
  unusedCredits?: number;
}) {
  const remaining = pass.unusedCredits ?? pass.remaining;
  const used = Math.max(0, pass.sessionsPaid - remaining);
  return `${pass.sessionsPaid}/${pass.sessionCount} pagadas · ${used} usadas · ${remaining} quedan por usar`;
}

function canUseClass(pass: { unusedCredits?: number; sessionsPaid: number; sessionsUsed: number }) {
  return (pass.unusedCredits ?? pass.sessionsPaid - pass.sessionsUsed) > 0;
}

function canReturnClass(pass: { sessionsUsed: number }) {
  return pass.sessionsUsed > 0;
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

function ClientSearchSelect({
  value,
  onChange,
  clients,
  placeholder,
  allowClear,
}: {
  value: string;
  onChange: (value: string) => void;
  clients: ClientRow[];
  placeholder: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () =>
      [...clients].sort((a, b) =>
        clientLabel(a).localeCompare(clientLabel(b), 'es', { sensitivity: 'base' }),
      ),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => {
      const label = clientLabel(c).toLowerCase();
      const phone = (c.phone ?? '').toLowerCase();
      const email = (c.email ?? '').toLowerCase();
      return label.includes(q) || phone.includes(q) || email.includes(q);
    });
  }, [sorted, query]);

  const selected = clients.find((c) => c.id === value);
  const displayValue = open ? query : selected ? clientLabel(selected) : '';

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        className="input w-full pr-8"
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onClick={() => setOpen(true)}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-xs">
        ▾
      </span>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-panel shadow-lg">
          {allowClear ? (
            <button
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-panel-2 ${!value ? 'bg-panel-2 font-medium' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange('');
                setOpen(false);
                setQuery('');
              }}
            >
              {placeholder}
            </button>
          ) : null}
          {filtered.length ? (
            filtered.map((client) => (
              <button
                key={client.id}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-panel-2 ${value === client.id ? 'bg-panel-2 font-medium' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(client.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {clientLabel(client)}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted">Sin resultados</p>
          )}
        </div>
      ) : null}
      {selected && allowClear && !open ? (
        <button
          type="button"
          className="absolute right-6 top-1/2 -translate-y-1/2 text-muted hover:text-text text-xs px-1"
          onClick={() => onChange('')}
          aria-label="Limpiar"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('es-AR');
}

export function PaymentsList() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [clientId, setClientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [personTarget, setPersonTarget] = useState<PersonTarget | null>(null);

  useEffect(() => {
    const qs = searchParams.get('clientId');
    if (qs) setClientId(qs);
  }, [searchParams]);

  const today = todayIso();
  const thisMonth = monthRange();
  const periodPreset =
    from === today && to === today
      ? 'hoy'
      : from === thisMonth.from && to === thisMonth.to
        ? 'mes'
        : null;

  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'todos', ''],
    queryFn: () => api<ClientRow[]>('/admin/clients'),
    staleTime: 30_000,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api<CatalogService[]>('/admin/services'),
    staleTime: 30_000,
  });

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['payments', clientId, serviceId, from, to],
    queryFn: () =>
      api<PaymentRow[]>(paymentsQueryPath(clientId, serviceId, from, to)),
    placeholderData: keepPreviousData,
  });

  const { data: ranking = [] } = useQuery({
    queryKey: ['payments-stats', clientId, from, to],
    queryFn: () => api<PaymentStatsRow[]>(statsQueryPath(clientId, from, to)),
    placeholderData: keepPreviousData,
  });

  const total = data.reduce((sum, row) => sum + row.amount, 0);
  const hasPeriod = Boolean(from || to);

  function applyFrom(value: string) {
    setFrom(value);
    if (value && to && value > to) setTo(value);
  }

  function applyTo(value: string) {
    setTo(value);
    if (value && from && value < from) setFrom(value);
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
      queryClient.invalidateQueries({ queryKey: ['payments-stats'] }),
    ]);
  }

  const consumePass = useMutation({
    mutationFn: (passId: string) =>
      api(`/admin/payments/passes/${passId}/use`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });

  const returnPass = useMutation({
    mutationFn: (passId: string) =>
      api(`/admin/payments/passes/${passId}/return`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ id: string }>(`/admin/payments/${id}`, { method: 'DELETE' }),
    onSuccess: async (_data, id) => {
      setConfirmId(null);
      if (editing?.id === id) {
        setEditing(null);
        setFormOpen(false);
      }
      await refresh();
    },
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Pagos y clases</h2>
          <p className="text-sm text-muted mt-1">
            Registrá lo que pagó cada alumno, el servicio que cubre y cuántas clases le quedan por usar.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-11 px-4"
          onClick={() => {
            if (formOpen && !editing) {
              setFormOpen(false);
              return;
            }
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {formOpen && !editing ? 'Cerrar' : 'Registrar pago'}
        </button>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 flex-1">
            <label className="space-y-1 text-sm">
              <span className="text-muted">Alumno</span>
              <ClientSearchSelect
                value={clientId}
                onChange={setClientId}
                clients={clients}
                placeholder="Todos"
                allowClear
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Servicio</span>
              <select
                className="input w-full"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
              >
                <option value="">Todos</option>
                {services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.sessionCount > 1 ? ` (${item.sessionCount} clases)` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Desde</span>
              <input
                className="input w-full"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => applyFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Hasta</span>
              <input
                className="input w-full"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => applyTo(event.target.value)}
              />
            </label>
          </div>
          <p className="text-sm text-muted tabular-nums lg:text-right lg:pb-2">
            Total{hasPeriod ? ' del período' : clientId ? ' del alumno' : ''}:{' '}
            <span className="font-semibold text-text">{money(total)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`min-h-10 rounded-full px-3.5 text-sm border transition ${
              periodPreset === 'hoy'
                ? 'bg-nav-active text-white border-nav-active'
                : 'bg-panel text-muted border-line hover:bg-panel-2 hover:text-text'
            }`}
            aria-pressed={periodPreset === 'hoy'}
            onClick={() => {
              setFrom(today);
              setTo(today);
            }}
          >
            Hoy
          </button>
          <button
            type="button"
            className={`min-h-10 rounded-full px-3.5 text-sm border transition ${
              periodPreset === 'mes'
                ? 'bg-nav-active text-white border-nav-active'
                : 'bg-panel text-muted border-line hover:bg-panel-2 hover:text-text'
            }`}
            aria-pressed={periodPreset === 'mes'}
            onClick={() => {
              setFrom(thisMonth.from);
              setTo(thisMonth.to);
            }}
          >
            Este mes
          </button>
          {hasPeriod ? (
            <button
              type="button"
              className="min-h-10 rounded-full px-3.5 text-sm border border-line bg-panel text-muted hover:bg-panel-2 hover:text-text"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Quitar fechas
            </button>
          ) : null}
        </div>
      </div>

      {ranking.length ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ranking.slice(0, 4).map((row) => (
            <article
              key={row.serviceId ?? 'none'}
              className="panel rounded-2xl px-4 py-3"
            >
              <p className="text-xs text-muted">Más vendido</p>
              <p className="font-medium mt-1 truncate">{row.name}</p>
              <p className="text-sm text-muted mt-1 tabular-nums">
                {row.payments} {row.payments === 1 ? 'pago' : 'pagos'} ·{' '}
                {money(row.amount)}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {formOpen ? (
        <PaymentForm
          key={editing?.id ?? 'new'}
          payment={editing}
          clients={clients}
          services={services}
          defaultClientId={clientId || editing?.client.id}
          defaultServiceId={serviceId || editing?.service?.id}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setFormOpen(false);
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <section className="panel rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="p-5 text-sm text-muted">Cargando pagos…</p>
        ) : !data.length ? (
          <p className="p-5 text-sm text-muted">
            {hasPeriod
              ? 'No hay pagos en este período.'
              : clientId
                ? 'Todavía no hay pagos de este alumno. Registrá el primero.'
                : 'Todavía no hay pagos. Registrá el primero.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted border-b border-line bg-panel-2">
                <tr>
                  <th className="font-medium px-5 py-3">Alumno</th>
                  <th className="font-medium px-5 py-3">Servicio</th>
                  <th className="font-medium px-5 py-3">Fecha</th>
                  <th className="font-medium px-5 py-3 text-right">Importe</th>
                  <th className="font-medium px-5 py-3">Pack</th>
                  <th className="font-medium px-5 py-3">Observación</th>
                  <th className="font-medium px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((payment) => {
                  const remaining = payment.pass ? (payment.pass.unusedCredits ?? payment.pass.sessionsPaid - payment.pass.sessionsUsed) : null;
                  const low = remaining !== null && remaining <= 2 && remaining > 0;
                  const empty = remaining === 0;
                  return (
                  <tr key={payment.id} className="align-top">
                    <td className="px-5 py-4 font-medium">
                      <button
                        type="button"
                        className="text-left hover:text-accent hover:underline underline-offset-2"
                        onClick={() =>
                          setPersonTarget({
                            userId: payment.client.id,
                            contactName: payment.client.name,
                            contactPhone: payment.client.phone,
                            contactEmail: payment.client.email,
                          })
                        }
                        title="Ver ficha del alumno"
                      >
                        {clientLabel(payment.client)}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {payment.service?.name ?? 'Sin servicio'}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {dateLabel(payment.paidAt)}
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums font-medium whitespace-nowrap">
                      {money(payment.amount)}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-xs">
                      {payment.pass ? (
                        <span className={empty ? 'text-rose font-semibold' : low ? 'text-amber-700 font-medium' : 'text-muted'}>
                          {packLabel(payment.pass)}
                          {low ? ' · renovar' : empty ? ' · vencido' : ''}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted max-w-xs">
                      {payment.notes || 'Sin observación'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-nowrap items-center gap-1.5 justify-end">
                        {payment.pass && canUseClass(payment.pass) ? (
                          <button
                            type="button"
                            className="btn-secondary shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs"
                            disabled={consumePass.isPending || returnPass.isPending}
                            onClick={() => consumePass.mutate(payment.pass!.id)}
                          >
                            Usar clase
                          </button>
                        ) : null}
                        {payment.pass && canReturnClass(payment.pass) ? (
                          <button
                            type="button"
                            className="btn-secondary shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs"
                            disabled={consumePass.isPending || returnPass.isPending}
                            onClick={() => returnPass.mutate(payment.pass!.id)}
                            title="Devolver una clase usada por error"
                          >
                            Devolver clase
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs"
                          onClick={() => {
                            setEditing(payment);
                            setFormOpen(true);
                          }}
                        >
                          Editar
                        </button>
                        {confirmId === payment.id ? (
                          <>
                            <button
                              type="button"
                              className="shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs rounded-lg bg-rose text-white disabled:opacity-50"
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(payment.id)}
                            >
                              {remove.isPending ? 'Eliminando…' : 'Confirmar'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs"
                              onClick={() => setConfirmId(null)}
                              disabled={remove.isPending}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary shrink-0 whitespace-nowrap min-h-8 px-2.5 text-xs text-rose"
                            onClick={() => setConfirmId(payment.id)}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                      {remove.isError && confirmId === payment.id ? (
                        <p className="text-sm text-rose mt-2 text-right">
                          {(remove.error as Error).message ||
                            'No se pudo eliminar el pago.'}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PersonSheet target={personTarget} open={!!personTarget} onClose={() => setPersonTarget(null)} />
    </div>
  );
}

function PaymentForm({
  payment,
  clients,
  services,
  defaultClientId,
  defaultServiceId,
  onCancel,
  onSaved,
}: {
  payment: PaymentRow | null;
  clients: ClientRow[];
  services: CatalogService[];
  defaultClientId?: string;
  defaultServiceId?: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(payment);
  const [userId, setUserId] = useState(
    payment?.client.id ?? defaultClientId ?? '',
  );
  const [serviceId, setServiceId] = useState(
    payment?.service?.id ?? defaultServiceId ?? '',
  );
  const [cover, setCover] = useState<'pack' | 'session'>(
    payment ? (payment.sessionsGranted > 1 ? 'pack' : 'session') : 'pack',
  );
  const [amount, setAmount] = useState(
    payment ? String(payment.amount).replace('.', ',') : '',
  );
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? todayIso());
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const selected = services.find((item) => item.id === serviceId);
  const isPack = (selected?.sessionCount ?? 1) > 1;

  const mutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        userId,
        amount: Number(amount.replace(',', '.')),
        paidAt,
        notes: notes.trim() || null,
        serviceId: serviceId || null,
        cover: isPack ? cover : undefined,
      });
      if (payment) {
        return api<PaymentRow>(`/admin/payments/${payment.id}`, {
          method: 'PATCH',
          body,
        });
      }
      return api<PaymentRow>('/admin/payments', {
        method: 'POST',
        body,
      });
    },
    onSuccess: async () => {
      await onSaved();
    },
  });

  const parsedAmount = Number(amount.replace(',', '.'));
  const canSubmit =
    Boolean(userId) && Number.isFinite(parsedAmount) && parsedAmount > 0 && Boolean(paidAt);

  return (
    <form
      className="panel rounded-2xl p-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || mutation.isPending) return;
        mutation.mutate();
      }}
    >
      <div>
        <h3 className="font-medium">
          {isEdit ? 'Editar pago' : 'Nuevo pago'}
        </h3>
        <p className="text-xs text-muted mt-1">
          El importe y la fecha son obligatorios. Si es un pack, elegí si paga
          todas las clases o una sola.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm sm:col-span-3">
          <span className="text-muted">Alumno</span>
          <ClientSearchSelect
            value={userId}
            onChange={setUserId}
            clients={clients}
            placeholder="Elegí un alumno — escribí para buscar"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-3">
          <span className="text-muted">Servicio</span>
          <select
            className="input w-full"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            <option value="">Sin servicio</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.sessionCount > 1 ? ` · pack de ${item.sessionCount}` : ''}
              </option>
            ))}
          </select>
        </label>
        {isPack ? (
          <fieldset className="sm:col-span-3 space-y-2">
            <legend className="text-sm text-muted">Este pago cubre</legend>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 text-sm min-h-10 px-3 rounded-full border border-line">
                <input
                  type="radio"
                  name="cover"
                  checked={cover === 'pack'}
                  onChange={() => setCover('pack')}
                />
                Pack completo ({selected?.sessionCount} clases)
              </label>
              <label className="inline-flex items-center gap-2 text-sm min-h-10 px-3 rounded-full border border-line">
                <input
                  type="radio"
                  name="cover"
                  checked={cover === 'session'}
                  onChange={() => setCover('session')}
                />
                1 clase
              </label>
            </div>
          </fieldset>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="text-muted">Importe</span>
          <input
            className="input w-full"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0,00"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Fecha</span>
          <input
            className="input w-full"
            type="date"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
            required
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Observación</span>
        <textarea
          className="input w-full min-h-24"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
        />
      </label>
      {mutation.isError ? (
        <p className="text-sm text-rose">
          {(mutation.error as Error).message || 'No se pudo guardar el pago.'}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn-primary min-h-11 px-4"
          disabled={!canSubmit || mutation.isPending}
        >
          {mutation.isPending
            ? 'Guardando…'
            : isEdit
              ? 'Guardar cambios'
              : 'Guardar pago'}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-11 px-4"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
