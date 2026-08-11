'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Tab = 'general' | 'negocio' | 'marca' | 'horarios' | 'servicios' | 'mensajes';

interface AgentConfig {
  id: string;
  name: string;
  tone?: string;
  systemPrompt: string;
  customInstructions?: string | null;
  personality?: string | null;
}

interface BusinessHour {
  dayOfWeek: number;
  isClosed: boolean;
  ranges: Array<{ start: string; end: string }>;
}

interface ServiceRow {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  price?: string | number | null;
  enabled: boolean;
}

interface BrandingConfig {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  visualStyle?: string | null;
  commercialTone?: string | null;
  targetAudience?: string | null;
  preferNotes?: string | null;
  avoidNotes?: string | null;
  additionalInstructions?: string | null;
}

interface BusinessDetail {
  id: string;
  name: string;
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  timezone: string;
  defaultMessages?: Record<string, string> | null;
  agentConfigs?: AgentConfig[];
  businessHours?: BusinessHour[];
  services?: ServiceRow[];
  brandingConfig?: BrandingConfig | null;
}

const TONE_OPTIONS = [
  { value: 'professional_warm', label: 'profesional y cálido' },
  { value: 'formal', label: 'formal' },
  { value: 'friendly', label: 'amigable' },
  { value: 'casual', label: 'casual' },
  { value: 'custom', label: 'personalizado' },
];

const DAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

const MESSAGE_KEYS = [
  ['welcome', 'Bienvenida'],
  ['offline', 'Fuera de horario'],
  ['handoff', 'Derivación a humano'],
  ['appointmentConfirmation', 'Confirmación de cita'],
  ['appointmentCancellation', 'Cancelación de cita'],
  ['fallback', 'Fallback'],
] as const;

export function PersonalizationEditor() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('general');
  const { data, isLoading } = useQuery({
    queryKey: ['current-business'],
    queryFn: () => api<BusinessDetail>('/admin/business'),
  });

  const agent = data?.agentConfigs?.[0];
  const [tone, setTone] = useState('professional_warm');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [secondaryColor, setSecondaryColor] = useState('#111827');
  const [visualStyle, setVisualStyle] = useState('');
  const [commercialTone, setCommercialTone] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [preferNotes, setPreferNotes] = useState('');
  const [avoidNotes, setAvoidNotes] = useState('');
  const [brandExtra, setBrandExtra] = useState('');

  useEffect(() => {
    if (!data) return;
    setName(data.name ?? '');
    setDescription(data.description ?? '');
    setPhone(data.phone ?? '');
    setWhatsapp(data.whatsapp ?? '');
    setEmail(data.email ?? '');
    setAddress(data.address ?? '');
    setWebsite(data.website ?? '');
    setMessages(
      (data.defaultMessages as Record<string, string> | null) ?? {},
    );
    const brand = data.brandingConfig;
    setLogoUrl(brand?.logoUrl ?? '');
    setPrimaryColor(brand?.primaryColor ?? '#2563eb');
    setSecondaryColor(brand?.secondaryColor ?? '#111827');
    setVisualStyle(brand?.visualStyle ?? '');
    setCommercialTone(brand?.commercialTone ?? '');
    setTargetAudience(brand?.targetAudience ?? '');
    setPreferNotes(brand?.preferNotes ?? '');
    setAvoidNotes(brand?.avoidNotes ?? '');
    setBrandExtra(brand?.additionalInstructions ?? '');
    if (data.businessHours?.length) {
      setHours(data.businessHours);
    } else {
      setHours(
        Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          isClosed: dayOfWeek >= 5,
          ranges: dayOfWeek >= 5 ? [] : [{ start: '09:00', end: '18:00' }],
        })),
      );
    }
    if (agent) {
      setTone(agent.tone ?? 'professional_warm');
      setSystemPrompt(agent.systemPrompt ?? '');
    }
  }, [data, agent]);

  const saveAssistant = useMutation({
    mutationFn: () =>
      api('/admin/business/assistant', {
        method: 'PATCH',
        body: JSON.stringify({ tone, systemPrompt }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
    },
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      api('/admin/business', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description,
          phone,
          whatsapp,
          email,
          address,
          website,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
    },
  });

  const saveHours = useMutation({
    mutationFn: () =>
      api('/admin/business/hours', {
        method: 'PUT',
        body: JSON.stringify({ hours }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
    },
  });

  const saveMessages = useMutation({
    mutationFn: () =>
      api('/admin/business', {
        method: 'PATCH',
        body: JSON.stringify({ defaultMessages: messages }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
    },
  });

  const saveBranding = useMutation({
    mutationFn: () =>
      api('/admin/content/branding', {
        method: 'PATCH',
        body: JSON.stringify({
          logoUrl: logoUrl.trim() || null,
          primaryColor: primaryColor.trim() || null,
          secondaryColor: secondaryColor.trim() || null,
          visualStyle: visualStyle.trim() || null,
          commercialTone: commercialTone.trim() || null,
          targetAudience: targetAudience.trim() || null,
          preferNotes: preferNotes.trim() || null,
          avoidNotes: avoidNotes.trim() || null,
          additionalInstructions: brandExtra.trim() || null,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
    },
  });

  function saveCurrent() {
    if (tab === 'general') saveAssistant.mutate();
    if (tab === 'negocio') saveProfile.mutate();
    if (tab === 'marca') saveBranding.mutate();
    if (tab === 'horarios') saveHours.mutate();
    if (tab === 'mensajes') saveMessages.mutate();
  }

  const saving =
    saveAssistant.isPending ||
    saveProfile.isPending ||
    saveHours.isPending ||
    saveMessages.isPending ||
    saveBranding.isPending;

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando personalización…</p>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          Personalización
        </h2>
        <div className="flex gap-2 shrink-0">
          <Link
            href="/playground"
            className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm min-h-10 inline-flex items-center"
          >
            Probar agente
          </Link>
          {tab !== 'servicios' ? (
            <button
              type="button"
              onClick={saveCurrent}
              disabled={saving}
              className="rounded-lg bg-accent text-white px-3 py-2.5 text-sm font-medium disabled:opacity-60 min-h-10"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-nowrap gap-1 border-b border-line pb-px overflow-x-auto -mx-1 px-1">
        {(
          [
            ['general', 'General'],
            ['negocio', 'Negocio'],
            ['marca', 'Marca'],
            ['horarios', 'Horarios'],
            ['servicios', 'Servicios'],
            ['mensajes', 'Mensajes'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`shrink-0 px-3 py-2.5 text-sm rounded-t-lg min-h-10 ${
              tab === id
                ? 'bg-nav-active text-white'
                : 'text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' ? (
        <section className="panel rounded-2xl p-5 space-y-4">
          <h3 className="font-medium">Identidad del agente</h3>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Tono</span>
            <select
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">System prompt</span>
            <textarea
              className="w-full min-h-48 rounded-lg border border-line bg-panel px-3 py-2"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </label>
        </section>
      ) : null}

      {tab === 'marca' ? (
        <section className="panel rounded-2xl p-5 grid gap-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm text-muted">
            Guía visual y comercial para el creador de contenido (imágenes y
            copy).
          </p>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">URL del logo</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Color primario</span>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                className="h-10 w-12 rounded border border-line bg-panel"
                value={primaryColor || '#2563eb'}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-line bg-panel px-3 py-2"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
            </div>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Color secundario</span>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                className="h-10 w-12 rounded border border-line bg-panel"
                value={secondaryColor || '#111827'}
                onChange={(e) => setSecondaryColor(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-line bg-panel px-3 py-2"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
              />
            </div>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Estilo visual</span>
            <textarea
              className="w-full min-h-20 rounded-lg border border-line bg-panel px-3 py-2"
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
              placeholder="Ej. limpio, fotográfico, tipografía bold…"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Tono comercial</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={commercialTone}
              onChange={(e) => setCommercialTone(e.target.value)}
              placeholder="cercano, premium, divertido…"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Público objetivo</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Preferir</span>
            <textarea
              className="w-full min-h-20 rounded-lg border border-line bg-panel px-3 py-2"
              value={preferNotes}
              onChange={(e) => setPreferNotes(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Evitar</span>
            <textarea
              className="w-full min-h-20 rounded-lg border border-line bg-panel px-3 py-2"
              value={avoidNotes}
              onChange={(e) => setAvoidNotes(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Instrucciones adicionales</span>
            <textarea
              className="w-full min-h-20 rounded-lg border border-line bg-panel px-3 py-2"
              value={brandExtra}
              onChange={(e) => setBrandExtra(e.target.value)}
            />
          </label>
        </section>
      ) : null}

      {tab === 'negocio' ? (
        <section className="panel rounded-2xl p-5 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Nombre</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Descripción</span>
            <textarea
              className="w-full min-h-24 rounded-lg border border-line bg-panel px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Teléfono</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">WhatsApp</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Email</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Web</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Dirección</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        </section>
      ) : null}

      {tab === 'horarios' ? (
        <section className="panel rounded-2xl p-5 space-y-4">
          <p className="text-sm text-muted">
            Podés cargar varios tramos por día (ej. mañana y tarde).
          </p>
          {hours.map((day) => (
            <div
              key={day.dayOfWeek}
              className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-3">
                <p className="w-28 text-sm font-medium">
                  {DAY_LABELS[day.dayOfWeek]}
                </p>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={!day.isClosed}
                    onChange={(e) => {
                      const open = e.target.checked;
                      setHours((prev) =>
                        prev.map((item) =>
                          item.dayOfWeek === day.dayOfWeek
                            ? {
                                ...item,
                                isClosed: !open,
                                ranges: open
                                  ? item.ranges.length
                                    ? item.ranges
                                    : [{ start: '09:00', end: '18:00' }]
                                  : [],
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                  Abierto
                </label>
                {day.isClosed ? (
                  <span className="text-sm text-muted">Cerrado</span>
                ) : null}
              </div>

              {!day.isClosed ? (
                <div className="ml-0 sm:ml-28 space-y-2">
                  {(day.ranges.length
                    ? day.ranges
                    : [{ start: '09:00', end: '18:00' }]
                  ).map((range, rangeIndex) => (
                    <div
                      key={`${day.dayOfWeek}-${rangeIndex}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="time"
                        className="rounded-lg border border-line px-2 py-1 text-sm"
                        value={range.start}
                        onChange={(e) =>
                          setHours((prev) =>
                            prev.map((item) => {
                              if (item.dayOfWeek !== day.dayOfWeek) return item;
                              const ranges = [...item.ranges];
                              if (!ranges.length) {
                                ranges.push({
                                  start: e.target.value,
                                  end: '18:00',
                                });
                              } else {
                                ranges[rangeIndex] = {
                                  ...ranges[rangeIndex],
                                  start: e.target.value,
                                };
                              }
                              return { ...item, ranges };
                            }),
                          )
                        }
                      />
                      <span className="text-muted text-sm">a</span>
                      <input
                        type="time"
                        className="rounded-lg border border-line px-2 py-1 text-sm"
                        value={range.end}
                        onChange={(e) =>
                          setHours((prev) =>
                            prev.map((item) => {
                              if (item.dayOfWeek !== day.dayOfWeek) return item;
                              const ranges = [...item.ranges];
                              if (!ranges.length) {
                                ranges.push({
                                  start: '09:00',
                                  end: e.target.value,
                                });
                              } else {
                                ranges[rangeIndex] = {
                                  ...ranges[rangeIndex],
                                  end: e.target.value,
                                };
                              }
                              return { ...item, ranges };
                            }),
                          )
                        }
                      />
                      {day.ranges.length > 1 ? (
                        <button
                          type="button"
                          className="text-sm text-muted underline-offset-2 hover:underline"
                          onClick={() =>
                            setHours((prev) =>
                              prev.map((item) =>
                                item.dayOfWeek === day.dayOfWeek
                                  ? {
                                      ...item,
                                      ranges: item.ranges.filter(
                                        (_, idx) => idx !== rangeIndex,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          Quitar
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-sm text-accent underline-offset-2 hover:underline"
                    onClick={() =>
                      setHours((prev) =>
                        prev.map((item) => {
                          if (item.dayOfWeek !== day.dayOfWeek) return item;
                          const last = item.ranges[item.ranges.length - 1];
                          return {
                            ...item,
                            ranges: [
                              ...item.ranges,
                              {
                                start: last?.end || '14:00',
                                end: '18:00',
                              },
                            ],
                          };
                        }),
                      )
                    }
                  >
                    + Agregar tramo
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {tab === 'servicios' ? (
        <section className="panel rounded-2xl p-5 space-y-3">
          <p className="text-sm text-muted">
            Servicios que el agente puede ofrecer al agendar citas.
          </p>
          <ul className="divide-y divide-line">
            {(data?.services ?? []).map((service) => (
              <li
                key={service.id}
                className="py-3 flex items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-medium">{service.name}</p>
                  <p className="text-xs text-muted">
                    {service.durationMinutes} min
                    {service.price != null ? ` · $${service.price}` : ''}
                  </p>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${
                    service.enabled ? 'badge-success' : 'badge-muted'
                  }`}
                >
                  {service.enabled ? 'Activo' : 'Off'}
                </span>
              </li>
            ))}
            {!data?.services?.length ? (
              <li className="py-4 text-sm text-muted">
                No hay servicios todavía.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === 'mensajes' ? (
        <section className="panel rounded-2xl p-5 space-y-4">
          {MESSAGE_KEYS.map(([key, label]) => (
            <label key={key} className="block space-y-1 text-sm">
              <span className="text-muted">{label}</span>
              <textarea
                className="w-full min-h-20 rounded-lg border border-line bg-panel px-3 py-2"
                value={messages[key] ?? ''}
                onChange={(e) =>
                  setMessages((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </section>
      ) : null}
    </div>
  );
}
