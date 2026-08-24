'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, apiForm } from '@/lib/api';
import { LeadLifecycleForm } from '@/components/lead-lifecycle-form';

type Tab =
  | 'general'
  | 'negocio'
  | 'marca'
  | 'horarios'
  | 'servicios'
  | 'mensajes'
  | 'leads';

interface AgentConfig {
  id: string;
  name: string;
  tone?: string;
  systemPrompt: string;
  customInstructions?: string | null;
  personality?: string | null;
  model?: string;
  provider?: string;
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
  sessionCount?: number;
  capacity?: number;
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
  googleReviewsUrl?: string | null;
  timezone: string;
  allowedModels?: string[];
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
  const [model, setModel] = useState('gpt-4.1-mini');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [googleReviewsUrl, setGoogleReviewsUrl] = useState('');
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [secondaryColor, setSecondaryColor] = useState('#111827');
  const [visualStyle, setVisualStyle] = useState('');
  const [commercialTone, setCommercialTone] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [preferNotes, setPreferNotes] = useState('');
  const [avoidNotes, setAvoidNotes] = useState('');
  const [brandExtra, setBrandExtra] = useState('');
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (data && data.id !== hydratedId) {
    setHydratedId(data.id);
    setName(data.name ?? '');
    setDescription(data.description ?? '');
    setPhone(data.phone ?? '');
    setWhatsapp(data.whatsapp ?? '');
    setEmail(data.email ?? '');
    setAddress(data.address ?? '');
    setWebsite(data.website ?? '');
    setGoogleReviewsUrl(data.googleReviewsUrl ?? '');
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
      setModel(agent.model ?? 'gpt-4.1-mini');
    }
  }

  const saveAssistant = useMutation({
    mutationFn: () =>
      api('/admin/business/assistant', {
        method: 'PATCH',
        body: JSON.stringify({ tone, systemPrompt, model: model.trim() || 'gpt-4.1-mini' }),
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
          googleReviewsUrl,
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
          {tab !== 'servicios' && tab !== 'leads' ? (
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
            ['leads', 'Leads'],
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
            <span className="text-muted">Modelo</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 mono text-sm"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4.1-mini"
              list="model-suggestions"
            />
            <datalist id="model-suggestions">
              <option value="gpt-4.1-mini" />
              <option value="gpt-5-mini" />
              <option value="gpt-4.1" />
              <option value="gpt-4o-mini" />
              <option value="gpt-5" />
            </datalist>
            <span className="block text-xs text-muted mt-1">
              Texto libre — probá <code className="mono text-[11px]">gpt-4.1-mini</code> vs <code className="mono text-[11px]">gpt-5-mini</code>. Se guarda en DB (<code className="mono text-[11px]">agent_configs.model</code>, no en .env). El <code className="mono text-[11px]">.env: OPENAI_DEFAULT_MODEL</code> solo se usa al crear/seedear el negocio y es ignorado después — el input manda. Ver playground debug para confirmar modelo real.
            </span>
            {data?.allowedModels && !data.allowedModels.includes(model.trim()) && model.trim() ? (
              <span className="block text-xs text-amber-700 mt-1">
                Se agregará a <code className="mono text-[11px]">allowedModels</code> al guardar ({data.allowedModels.join(', ')}).
              </span>
            ) : null}
          </label>
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
          {agent ? (
            <p className="text-xs text-muted">
              Actual en DB: <span className="mono">{agent.model}</span> · provider: {agent.provider ?? 'openai'} · {agent.name}
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === 'marca' ? (
        <section className="panel rounded-2xl p-5 grid gap-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm text-muted">
            Guía visual y comercial para el creador de contenido (imágenes y
            copy).
          </p>
          <div className="sm:col-span-2 space-y-3 rounded-xl border border-line bg-panel-2/50 p-4">
            <span className="text-sm font-medium">Logo del negocio</span>

            {logoUrl ? (
              <div className="flex items-start gap-3 rounded-xl border border-line bg-panel p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt="Logo del negocio"
                  className="h-16 w-16 shrink-0 rounded-lg border border-line bg-white object-contain p-1"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs text-muted">{logoUrl}</p>
                  <p className="text-xs text-emerald-700">Logo cargado — se usará en la generación de contenido.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-panel p-4 text-center">
                <p className="text-sm text-muted">Sin logo cargado</p>
                <p className="text-xs text-muted/80">Subí tu logo para que aparezca en las piezas generadas.</p>
              </div>
            )}

            <input
              ref={logoFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setLogoError('');
                setLogoUploading(true);
                try {
                  const form = new FormData();
                  form.append('file', file);
                  const result = await apiForm<{ logoUrl: string }>('/admin/content/branding/logo', form);
                  const newUrl = (result as { logoUrl?: string })?.logoUrl || '';
                  if (newUrl) {
                    setLogoUrl(newUrl);
                    await queryClient.invalidateQueries({ queryKey: ['current-business'] });
                  } else {
                    // fallback: si el backend devuelve el branding completo
                    const urlFromBranding = (result as unknown as { logoUrl?: string })?.logoUrl ?? '';
                    if (urlFromBranding) setLogoUrl(urlFromBranding);
                  }
                } catch (err) {
                  setLogoError(err instanceof Error ? err.message : 'No se pudo subir el logo');
                } finally {
                  setLogoUploading(false);
                  if (logoFileRef.current) logoFileRef.current.value = '';
                }
              }}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => logoFileRef.current?.click()}
                disabled={logoUploading}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-60 min-h-10"
              >
                {logoUploading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                    Subiendo…
                  </>
                ) : logoUrl ? (
                  'Cambiar logo'
                ) : (
                  'Adjuntar logo'
                )}
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogoUrl('');
                    setLogoError('');
                  }}
                  className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm min-h-10"
                >
                  Quitar logo
                </button>
              ) : null}
            </div>

            {logoError ? <p className="text-xs text-red-600">{logoError}</p> : null}
            <p className="text-xs text-muted">
              PNG, JPG, WEBP o SVG — máx. 8MB. Se sube a Cloudinary y se guarda automáticamente. También podés quitarlo y guardar.
            </p>

            <details className="rounded-lg border border-line bg-panel px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-text">Usar URL manualmente</summary>
              <input
                className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm"
                value={logoUrl}
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  if (logoError) setLogoError('');
                }}
                placeholder="https://…"
              />
              <p className="mt-1 text-[11px] text-muted">Si pegás una URL externa, se guardará al hacer clic en Guardar.</p>
            </details>
          </div>
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
            <span className="text-muted">Link de reseñas de Google</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2"
              type="url"
              placeholder="https://g.page/r/.../review"
              value={googleReviewsUrl}
              onChange={(e) => setGoogleReviewsUrl(e.target.value)}
            />
            <span className="block text-xs text-muted">
              Se agrega al email o WhatsApp de confirmación de turno para que
              el alumno deje una reseña. Lo copiás desde Google Maps o Google
              Business Profile.
            </span>
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
        <ServicesPanel services={data?.services ?? []} />
      ) : null}

      {tab === 'leads' ? <LeadLifecycleForm /> : null}

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

function ServicesPanel({ services }: { services: ServiceRow[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [price, setPrice] = useState('');
  const [sessionCount, setSessionCount] = useState('1');
  const [capacity, setCapacity] = useState('1');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDuration, setEditDuration] = useState('30');
  const [editPrice, setEditPrice] = useState('');
  const [editSessionCount, setEditSessionCount] = useState('1');
  const [editCapacity, setEditCapacity] = useState('1');
  const [editEnabled, setEditEnabled] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api('/admin/services', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          durationMinutes: Number(durationMinutes) || 30,
          price: price.trim() ? Number(price.replace(',', '.')) : null,
          sessionCount: Math.max(1, Number(sessionCount) || 1),
          capacity: Math.max(1, Number(capacity) || 1),
        }),
      }),
    onSuccess: async () => {
      setName('');
      setDurationMinutes('30');
      setPrice('');
      setSessionCount('1');
      setCapacity('1');
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
      await queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const updateCount = useMutation({
    mutationFn: ({
      id,
      sessionCount: count,
      capacity: cupo,
    }: {
      id: string;
      sessionCount?: number;
      capacity?: number;
    }) =>
      api(`/admin/services/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(count !== undefined ? { sessionCount: count } : {}),
          ...(cupo !== undefined ? { capacity: cupo } : {}),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
      await queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const updateService = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api(`/admin/services/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
      await queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const deleteService = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/services/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      setDeleteConfirmId(null);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['current-business'] });
      await queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  function startEdit(service: ServiceRow) {
    setEditingId(service.id);
    setEditName(service.name ?? '');
    setEditDescription(service.description ?? '');
    setEditDuration(String(service.durationMinutes ?? 30));
    setEditPrice(service.price !== null && service.price !== undefined ? String(service.price) : '');
    setEditSessionCount(String(service.sessionCount ?? 1));
    setEditCapacity(String(service.capacity ?? 1));
    setEditEnabled(service.enabled);
    setDeleteConfirmId(null);
  }

  return (
    <section className="panel rounded-2xl p-5 space-y-5">
      <p className="text-sm text-muted">
        1 clase = se paga y se usa una sola vez. 8 = pack de 8 clases.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || create.isPending) return;
          create.mutate();
        }}
      >
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Nuevo servicio</span>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Pack 8 clases"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Duración (min)</span>
          <input
            className="input w-full"
            inputMode="numeric"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Precio</span>
          <input
            className="input w-full"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Opcional"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Clases del pack</span>
          <input
            className="input w-full"
            inputMode="numeric"
            value={sessionCount}
            onChange={(event) => setSessionCount(event.target.value)}
            placeholder="1"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Cupo de la clase</span>
          <input
            className="input w-full"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="1"
          />
        </label>
        <div className="sm:col-span-5">
          <button
            type="submit"
            className="btn-primary min-h-11 px-4"
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? 'Agregando…' : 'Agregar servicio'}
          </button>
        </div>
        {create.isError ? (
          <p className="text-sm text-rose sm:col-span-5">
            {(create.error as Error).message || 'No se pudo crear el servicio.'}
          </p>
        ) : null}
      </form>
      <ul className="divide-y divide-line">
        {services.map((service) => {
          const count = counts[service.id] ?? String(service.sessionCount ?? 1);
          const cupo = capacities[service.id] ?? String(service.capacity ?? 1);
          const isEditing = editingId === service.id;
          const isDeleting = deleteConfirmId === service.id;
          return (
            <li
              key={service.id}
              className="py-4 space-y-3 text-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{service.name}</p>
                  {service.description ? (
                    <p className="text-xs text-muted line-clamp-2 mt-0.5">{service.description}</p>
                  ) : null}
                  <p className="text-xs text-muted mt-1">
                    {service.durationMinutes} min
                    {service.price !== null && service.price !== undefined && String(service.price).trim() !== ''
                      ? ` · $${service.price}`
                      : ''}
                    {(service.sessionCount ?? 1) > 1
                      ? ` · pack de ${service.sessionCount} clases`
                      : ' · servicio único'}
                    {(service.capacity ?? 1) > 1
                      ? ` · cupo ${service.capacity}`
                      : ' · turno exclusivo'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Pack
                    <input
                      className="input w-14 h-8 px-2 py-1 text-xs"
                      inputMode="numeric"
                      value={count}
                      onChange={(event) =>
                        setCounts((prev) => ({
                          ...prev,
                          [service.id]: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        const next = Math.max(1, Number(count) || 1);
                        if (next === (service.sessionCount ?? 1)) return;
                        updateCount.mutate({ id: service.id, sessionCount: next });
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Cupo
                    <input
                      className="input w-14 h-8 px-2 py-1 text-xs"
                      inputMode="numeric"
                      value={cupo}
                      onChange={(event) =>
                        setCapacities((prev) => ({
                          ...prev,
                          [service.id]: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        const next = Math.max(1, Number(cupo) || 1);
                        if (next === (service.capacity ?? 1)) return;
                        updateCount.mutate({ id: service.id, capacity: next });
                      }}
                    />
                  </label>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      service.enabled ? 'badge-success' : 'badge-muted'
                    }`}
                  >
                    {service.enabled ? 'Activo' : 'Off'}
                  </span>
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => startEdit(service)}
                      className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium hover:bg-panel-2"
                    >
                      Editar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(service.id)}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {isEditing ? (
                <div className="rounded-xl border border-line bg-panel-2/50 p-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs sm:col-span-2">
                      <span className="text-muted">Nombre</span>
                      <input
                        className="input w-full"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Nombre del servicio"
                      />
                    </label>
                    <label className="space-y-1 text-xs sm:col-span-2">
                      <span className="text-muted">Descripción</span>
                      <textarea
                        className="input w-full min-h-16"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Descripción opcional"
                        rows={2}
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted">Duración (min)</span>
                      <input
                        className="input w-full"
                        inputMode="numeric"
                        value={editDuration}
                        onChange={(e) => setEditDuration(e.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted">Precio</span>
                      <input
                        className="input w-full"
                        inputMode="decimal"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        placeholder="Opcional"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted">Clases del pack</span>
                      <input
                        className="input w-full"
                        inputMode="numeric"
                        value={editSessionCount}
                        onChange={(e) => setEditSessionCount(e.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted">Cupo</span>
                      <input
                        className="input w-full"
                        inputMode="numeric"
                        value={editCapacity}
                        onChange={(e) => setEditCapacity(e.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs sm:col-span-2 pt-1">
                      <input
                        type="checkbox"
                        checked={editEnabled}
                        onChange={(e) => setEditEnabled(e.target.checked)}
                        className="rounded border-line"
                      />
                      <span className="text-muted">Servicio activo (visible para reservas)</span>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!editName.trim() || updateService.isPending}
                      onClick={() => {
                        const payload: Record<string, unknown> = {
                          name: editName.trim(),
                          description: editDescription.trim() || null,
                          durationMinutes: Math.max(5, Number(editDuration) || 30),
                          price: editPrice.trim() === '' ? null : Number(editPrice.replace(',', '.')),
                          sessionCount: Math.max(1, Number(editSessionCount) || 1),
                          capacity: Math.max(1, Number(editCapacity) || 1),
                          enabled: editEnabled,
                        };
                        if (!payload.name) return;
                        if (payload.price !== null && (Number.isNaN(payload.price as number) || (payload.price as number) < 0)) {
                          return;
                        }
                        updateService.mutate({ id: service.id, payload });
                      }}
                      className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
                    >
                      {updateService.isPending && editingId === service.id ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-line bg-panel px-4 py-2 text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                  {updateService.isError && editingId === service.id ? (
                    <p className="text-xs text-red-600">
                      {(updateService.error as Error).message || 'No se pudo actualizar.'}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isDeleting ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-red-800">
                    ¿Eliminar <span className="font-semibold">{service.name}</span>? Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs"
                      disabled={deleteService.isPending}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteService.mutate(service.id)}
                      disabled={deleteService.isPending}
                      className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                    >
                      {deleteService.isPending ? 'Eliminando…' : 'Sí, eliminar'}
                    </button>
                  </div>
                </div>
              ) : null}
              {deleteService.isError && deleteConfirmId === service.id ? (
                <p className="text-xs text-red-600">
                  {(deleteService.error as Error).message || 'No se pudo eliminar.'}
                </p>
              ) : null}
            </li>
          );
        })}
        {!services.length ? (
          <li className="py-4 text-sm text-muted">
            No hay servicios todavía.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
