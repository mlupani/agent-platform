'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MailIcon, WhatsAppIcon } from '@/components/channel-icons';
import type { ClientRow, ClientStatus } from '@/lib/types';

type StatusSlug = 'activo' | 'inactivo' | 'visita';
type FilterSlug = 'todos' | StatusSlug;

const FALLBACK_STATUSES: ClientStatus[] = [
  { id: 'status-activo', slug: 'activo', name: 'Activo', sortOrder: 1 },
  { id: 'status-inactivo', slug: 'inactivo', name: 'Inactivo', sortOrder: 2 },
  { id: 'status-visita', slug: 'visita', name: 'Visita', sortOrder: 3 },
];

function statusBadgeClass(slug: string) {
  if (slug === 'activo') return 'badge-success';
  if (slug === 'visita') return 'badge-warn';
  return 'badge-muted';
}

function displayName(client: ClientRow) {
  return client.name || client.phone || client.email || 'Sin nombre';
}

function waMeUrl(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function isWhatsAppConnected(config?: {
  status?: string | null;
  sessionStatus?: string | null;
} | null) {
  return (
    config?.status === 'connected' || config?.sessionStatus === 'WORKING'
  );
}

function clientsQueryPath(filter: FilterSlug, name: string) {
  const params = new URLSearchParams();
  if (filter !== 'todos') params.set('status', filter);
  if (name) params.set('name', name);
  const query = params.toString();
  return `/admin/clients${query ? `?${query}` : ''}`;
}

export function ClientsList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterSlug>('todos');
  const [nameInput, setNameInput] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const nameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: statuses = FALLBACK_STATUSES } = useQuery({
    queryKey: ['client-statuses'],
    queryFn: () => api<ClientStatus[]>('/admin/clients/statuses'),
  });

  const { data: whatsapp } = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () =>
      api<{ status: string; sessionStatus?: string | null } | null>(
        '/admin/whatsapp',
      ),
    staleTime: 30_000,
  });
  const waConnected = isWhatsAppConnected(whatsapp);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['clients', filter, nameQuery],
    queryFn: () => api<ClientRow[]>(clientsQueryPath(filter, nameQuery)),
    placeholderData: keepPreviousData,
  });

  function onNameChange(value: string) {
    setNameInput(value);
    if (nameDebounce.current) clearTimeout(nameDebounce.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setNameQuery('');
      return;
    }
    nameDebounce.current = setTimeout(() => setNameQuery(trimmed), 250);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['clients'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ id: string }>(`/admin/clients/${id}`, { method: 'DELETE' }),
    onSuccess: async (_data, id) => {
      setConfirmId(null);
      if (editing?.id === id) {
        setEditing(null);
        setFormOpen(false);
      }
      await refresh();
    },
  });

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(client: ClientRow) {
    setEditing(client);
    setFormOpen(true);
  }

  const openWhatsApp = useMutation({
    mutationFn: (id: string) =>
      api<{ conversationId?: string; webUrl?: string }>(
        `/admin/clients/${id}/whatsapp`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      if (data.conversationId) {
        router.push(`/conversations?c=${data.conversationId}`);
        return;
      }
      if (data.webUrl) {
        window.open(data.webUrl, '_blank', 'noopener,noreferrer');
      }
    },
  });

  function mailtoHref(email: string) {
    return `mailto:${email.trim()}`;
  }

  return (
    <div className="space-y-6 w-full max-w-none">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Alumnos</h2>
          <p className="text-sm text-muted mt-1">
            Contactos del negocio: los que llegan por el asistente y los que
            cargás a mano.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-11 px-4 shrink-0"
          onClick={() => {
            if (formOpen && !editing) {
              setFormOpen(false);
              return;
            }
            openCreate();
          }}
        >
          {formOpen && !editing ? 'Cerrar' : 'Nuevo alumno'}
        </button>
      </header>

      <div className="space-y-3">
        <label className="block">
          <span className="sr-only">Buscar por nombre</span>
          <input
            id="client-search"
            type="search"
            className="input w-full"
            placeholder="Buscar por nombre"
            value={nameInput}
            onChange={(event) => onNameChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
          {[{ slug: 'todos', name: 'Todos' }, ...statuses].map((item) => {
            const slug = item.slug as FilterSlug;
            const active = filter === slug;
            return (
              <button
                key={slug}
                type="button"
                role="tab"
                aria-selected={active}
                className={`min-h-10 rounded-full px-3.5 text-sm border transition ${
                  active
                    ? 'bg-nav-active text-white border-nav-active'
                    : 'bg-panel text-muted border-line hover:bg-panel-2 hover:text-text'
                }`}
                onClick={() => setFilter(slug)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      {formOpen ? (
        <ClientForm
          key={editing?.id ?? 'new'}
          client={editing}
          statuses={statuses}
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
          <p className="p-5 text-sm text-muted">Cargando alumnos…</p>
        ) : !data.length ? (
          <p className="p-5 text-sm text-muted">
            {nameQuery
              ? 'No hay alumnos que coincidan con esa búsqueda.'
              : filter === 'todos'
                ? 'Todavía no hay alumnos. Cargá uno a mano o esperá a que el asistente registre un contacto.'
                : 'No hay alumnos con este estado.'}
          </p>
        ) : (
          <>
            {/* Mobile: cards (actual, te gusta) */}
            <ul className="divide-y divide-line lg:hidden">
              {data.map((client) => (
                <li key={client.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{displayName(client)}</p>
                      <p className="text-xs text-muted mt-1">
                        {new Date(client.createdAt).toLocaleString('es-AR')}
                        {client.conversations > 0
                          ? ` · ${client.conversations} conv.`
                          : ''}
                        {client.appointments > 0
                          ? ` · ${client.appointments} turnos`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {waConnected && client.phone ? (
                        <button
                          type="button"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white hover:opacity-90 disabled:opacity-50"
                          aria-label="Abrir chat de WhatsApp"
                          title="Abrir chat de WhatsApp"
                          disabled={
                            openWhatsApp.isPending &&
                            openWhatsApp.variables === client.id
                          }
                          onClick={() => openWhatsApp.mutate(client.id)}
                        >
                          <WhatsAppIcon className="h-4 w-4" title="WhatsApp" />
                        </button>
                      ) : waMeUrl(client.phone ?? '') ? (
                        <a
                          href={waMeUrl(client.phone ?? '') ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white hover:opacity-90"
                          aria-label="Abrir WhatsApp Web"
                          title="Abrir WhatsApp Web"
                        >
                          <WhatsAppIcon className="h-4 w-4" title="WhatsApp" />
                        </a>
                      ) : null}
                      {client.email ? (
                        <a
                          href={mailtoHref(client.email)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white hover:opacity-90"
                          aria-label={`Enviar email a ${client.email}`}
                          title="Enviar email"
                        >
                          <MailIcon className="h-4 w-4" title="Email" />
                        </a>
                      ) : null}
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                          client.status.slug,
                        )}`}
                      >
                        {client.status.name}
                      </span>
                    </div>
                  </div>
                  {openWhatsApp.isError &&
                  openWhatsApp.variables === client.id ? (
                    <p className="text-sm text-rose">
                      {(openWhatsApp.error as Error).message ||
                        'No se pudo abrir WhatsApp.'}
                    </p>
                  ) : null}
                  <dl className="grid gap-1 text-sm sm:grid-cols-2">
                    {client.phone ? (
                      <div>
                        <dt className="text-xs text-muted">Teléfono</dt>
                        <dd>{client.phone}</dd>
                      </div>
                    ) : null}
                    {client.email ? (
                      <div>
                        <dt className="text-xs text-muted">Email</dt>
                        <dd className="break-all">{client.email}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {client.notes ? (
                    <p className="text-sm text-muted whitespace-pre-wrap">
                      {client.notes}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary min-h-10 px-3 text-sm"
                      onClick={() => openEdit(client)}
                    >
                      Editar
                    </button>
                    {confirmId === client.id ? (
                      <>
                        <button
                          type="button"
                          className="min-h-10 px-3 text-sm rounded-lg bg-rose text-white disabled:opacity-50"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(client.id)}
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
                        onClick={() => setConfirmId(client.id)}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                  {remove.isError && confirmId === client.id ? (
                    <p className="text-sm text-rose">
                      {(remove.error as Error).message ||
                        'No se pudo eliminar el alumno.'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* Desktop: tabla full-width */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-panel-2/60 text-xs text-muted border-b border-line">
                  <tr>
                    <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Alumno</th>
                    <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Contacto</th>
                    <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Estado</th>
                    <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Actividad</th>
                    <th className="text-right font-medium px-4 py-3 whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.map((client) => (
                    <tr
                      key={client.id}
                      className="hover:bg-panel-2/40 transition group"
                    >
                      <td className="px-4 py-3 align-top min-w-[220px]">
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[280px]" title={displayName(client)}>
                            {displayName(client)}
                          </p>
                          <p className="text-xs text-muted mt-0.5 whitespace-nowrap">
                            {new Date(client.createdAt).toLocaleDateString('es-AR')}
                          </p>
                          {client.notes ? (
                            <p className="text-xs text-muted truncate max-w-[280px] mt-1" title={client.notes}>
                              {client.notes}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top min-w-[220px]">
                        <div className="space-y-1">
                          {client.phone ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted shrink-0">Tel</span>
                              <span className="truncate max-w-[180px]" title={client.phone}>
                                {client.phone}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                          {client.email ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted shrink-0">Mail</span>
                              <span className="truncate max-w-[220px] break-all" title={client.email}>
                                {client.email}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                            client.status.slug,
                          )}`}
                        >
                          {client.status.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-1">
                            {client.conversations} conv.
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-1">
                            {client.appointments} turnos
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {waConnected && client.phone ? (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white hover:opacity-90 disabled:opacity-50"
                              aria-label="WhatsApp"
                              title="WhatsApp"
                              disabled={
                                openWhatsApp.isPending &&
                                openWhatsApp.variables === client.id
                              }
                              onClick={() => openWhatsApp.mutate(client.id)}
                            >
                              <WhatsAppIcon className="h-3.5 w-3.5" title="WhatsApp" />
                            </button>
                          ) : waMeUrl(client.phone ?? '') ? (
                            <a
                              href={waMeUrl(client.phone ?? '') ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white hover:opacity-90"
                              title="WhatsApp Web"
                            >
                              <WhatsAppIcon className="h-3.5 w-3.5" title="WhatsApp" />
                            </a>
                          ) : null}
                          {client.email ? (
                            <a
                              href={mailtoHref(client.email)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white hover:opacity-90"
                              title="Email"
                            >
                              <MailIcon className="h-3.5 w-3.5" title="Email" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex h-8 px-2.5 items-center justify-center rounded-full border border-line bg-panel hover:bg-panel-2 text-xs"
                            onClick={() => openEdit(client)}
                          >
                            Editar
                          </button>
                          {confirmId === client.id ? (
                            <>
                              <button
                                type="button"
                                className="inline-flex h-8 px-2.5 items-center justify-center rounded-full bg-rose text-white text-xs disabled:opacity-50"
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(client.id)}
                              >
                                {remove.isPending ? '…' : 'Sí'}
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-8 px-2.5 items-center justify-center rounded-full border border-line bg-panel text-xs"
                                onClick={() => setConfirmId(null)}
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex h-8 px-2.5 items-center justify-center rounded-full border border-line bg-panel text-rose hover:bg-rose/10 text-xs"
                              onClick={() => setConfirmId(client.id)}
                              title="Eliminar"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                        {openWhatsApp.isError &&
                        openWhatsApp.variables === client.id ? (
                          <p className="text-xs text-rose mt-1 text-right">
                            {(openWhatsApp.error as Error).message}
                          </p>
                        ) : null}
                        {remove.isError && confirmId === client.id ? (
                          <p className="text-xs text-rose mt-1 text-right">
                            {(remove.error as Error).message}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ClientForm({
  client,
  statuses,
  onCancel,
  onSaved,
}: {
  client: ClientRow | null;
  statuses: ClientStatus[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(client);
  const [name, setName] = useState(client?.name ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [statusSlug, setStatusSlug] = useState<StatusSlug>(
    (client?.status.slug as StatusSlug) ?? 'visita',
  );

  const mutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: name.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
        statusSlug,
      });
      if (client) {
        return api<ClientRow>(`/admin/clients/${client.id}`, {
          method: 'PATCH',
          body,
        });
      }
      return api<ClientRow>('/admin/clients', {
        method: 'POST',
        body,
      });
    },
    onSuccess: async () => {
      await onSaved();
    },
  });

  const canSubmit = Boolean(name.trim() || phone.trim() || email.trim());

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
          {isEdit ? 'Editar alumno' : 'Nuevo alumno'}
        </h3>
        <p className="text-xs text-muted mt-1">
          Completá al menos un dato de contacto.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Nombre</span>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Teléfono</span>
          <input
            className="input w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Email</span>
          <input
            className="input w-full"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Estado</span>
          <select
            className="input w-full"
            value={statusSlug}
            onChange={(event) =>
              setStatusSlug(event.target.value as StatusSlug)
            }
          >
            {statuses.map((status) => (
              <option key={status.id} value={status.slug}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Nota</span>
        <textarea
          className="input w-full min-h-24"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
        />
      </label>
      {mutation.isError ? (
        <p className="text-sm text-rose">
          {(mutation.error as Error).message || 'No se pudo guardar el alumno.'}
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
              : 'Guardar alumno'}
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
