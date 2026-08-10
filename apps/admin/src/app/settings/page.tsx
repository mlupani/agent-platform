export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <p className="mono text-xs tracking-[0.24em] text-amber">11 / SETTINGS</p>
        <h2 className="mt-2 text-3xl font-semibold">Settings</h2>
      </header>
      <article className="panel rounded-xl p-5 space-y-3 text-sm text-muted">
        <p>
          El panel usa <span className="mono text-text">x-api-key</span> contra NestJS. Configurá{' '}
          <span className="mono text-text">NEXT_PUBLIC_ADMIN_API_KEY</span> y{' '}
          <span className="mono text-text">NEXT_PUBLIC_API_URL</span>.
        </p>
        <p>
          Secrets de integraciones se cifran con <span className="mono text-text">ENCRYPTION_KEY</span>{' '}
          y nunca se exponen al modelo.
        </p>
        <p>
          Redis se usa para rate limits, locks e idempotencia. BullMQ queda preparado para colas.
        </p>
      </article>
    </div>
  );
}
