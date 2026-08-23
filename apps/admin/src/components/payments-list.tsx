'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ClientRow, PaymentRow } from '@/lib/types';

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

function paymentsQueryPath(clientId: string, from: string, to: string) {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/admin/payments${query ? `?${query}` : ''}`;
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('es-AR');
}

export function PaymentsList() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['payments', clientId, from, to],
    queryFn: () => api<PaymentRow[]>(paymentsQueryPath(clientId, from, to)),
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
    await queryClient.invalidateQueries({ queryKey: ['payments'] });
  }

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
          <h2 className="text-2xl font-semibold tracking-tight">Pagos</h2>
          <p className="text-sm text-muted mt-1">
            Registrá lo que pagó cada cliente: importe, fecha y una observación.
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
          <div className="grid gap-3 sm:grid-cols-3 flex-1">
            <label className="space-y-1 text-sm">
              <span className="text-muted">Cliente</span>
              <select
                className="input w-full"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">Todos</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {clientLabel(client)}
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
            Total{hasPeriod ? ' del período' : clientId ? ' del cliente' : ''}:{' '}
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

      {formOpen ? (
        <PaymentForm
          key={editing?.id ?? 'new'}
          payment={editing}
          clients={clients}
          defaultClientId={clientId || editing?.client.id}
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
                ? 'Todavía no hay pagos de este cliente. Registrá el primero.'
                : 'Todavía no hay pagos. Registrá el primero.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted border-b border-line bg-panel-2">
                <tr>
                  <th className="font-medium px-5 py-3">Cliente</th>
                  <th className="font-medium px-5 py-3">Fecha</th>
                  <th className="font-medium px-5 py-3 text-right">Importe</th>
                  <th className="font-medium px-5 py-3">Observación</th>
                  <th className="font-medium px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((payment) => (
                  <tr key={payment.id} className="align-top">
                    <td className="px-5 py-4 font-medium">
                      {clientLabel(payment.client)}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {dateLabel(payment.paidAt)}
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums font-medium whitespace-nowrap">
                      {money(payment.amount)}
                    </td>
                    <td className="px-5 py-4 text-muted max-w-xs">
                      {payment.notes || 'Sin observación'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          className="btn-secondary min-h-10 px-3 text-sm"
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
                              className="min-h-10 px-3 text-sm rounded-lg bg-rose text-white disabled:opacity-50"
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(payment.id)}
                            >
                              {remove.isPending ? 'Eliminando…' : 'Confirmar'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary min-h-10 px-3 text-sm"
                              onClick={() => setConfirmId(null)}
                              disabled={remove.isPending}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary min-h-10 px-3 text-sm text-rose"
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentForm({
  payment,
  clients,
  defaultClientId,
  onCancel,
  onSaved,
}: {
  payment: PaymentRow | null;
  clients: ClientRow[];
  defaultClientId?: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(payment);
  const [userId, setUserId] = useState(
    payment?.client.id ?? defaultClientId ?? '',
  );
  const [amount, setAmount] = useState(
    payment ? String(payment.amount).replace('.', ',') : '',
  );
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? todayIso());
  const [notes, setNotes] = useState(payment?.notes ?? '');

  const mutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        userId,
        amount: Number(amount.replace(',', '.')),
        paidAt,
        notes: notes.trim() || null,
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
          El importe y la fecha son obligatorios.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm sm:col-span-3">
          <span className="text-muted">Cliente</span>
          <select
            className="input w-full"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          >
            <option value="">Elegí un cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {clientLabel(client)}
              </option>
            ))}
          </select>
        </label>
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
