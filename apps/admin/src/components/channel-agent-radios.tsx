'use client';

interface ChannelAgentRadiosProps {
  name: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}

export function ChannelAgentRadios({
  name,
  value,
  onChange,
  disabled,
  hint,
}: ChannelAgentRadiosProps) {
  return (
    <fieldset
      className="rounded-2xl border border-line bg-panel-2 p-4 space-y-3"
      disabled={disabled}
    >
      <legend className="text-sm font-semibold px-1">Agente en este canal</legend>
      <p className="text-sm text-muted">
        {hint ??
          'El canal puede seguir recibiendo mensajes en Conversaciones. El agente solo responde si está activo.'}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label
          className={`flex items-start gap-3 rounded-xl border px-3 py-3 min-h-12 cursor-pointer transition ${
            value
              ? 'border-accent bg-accent-soft'
              : 'border-line bg-panel hover:border-text/20'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input
            type="radio"
            name={name}
            className="mt-1 accent-accent"
            checked={value}
            disabled={disabled}
            onChange={() => onChange(true)}
          />
          <span>
            <span className="block text-sm font-medium">Activo</span>
            <span className="block text-xs text-muted mt-0.5">
              Responde solo
            </span>
          </span>
        </label>
        <label
          className={`flex items-start gap-3 rounded-xl border px-3 py-3 min-h-12 cursor-pointer transition ${
            !value
              ? 'border-text/25 bg-panel'
              : 'border-line bg-panel hover:border-text/20'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input
            type="radio"
            name={name}
            className="mt-1 accent-accent"
            checked={!value}
            disabled={disabled}
            onChange={() => onChange(false)}
          />
          <span>
            <span className="block text-sm font-medium">Inactivo</span>
            <span className="block text-xs text-muted mt-0.5">
              Solo inbox
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
