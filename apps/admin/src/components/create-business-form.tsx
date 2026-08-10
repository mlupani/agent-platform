'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

export function CreateBusinessForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('OTHER');
  const [systemPrompt, setSystemPrompt] = useState('');

  const mutation = useMutation({
    mutationFn: async () =>
      api('/admin/businesses', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          type,
          systemPrompt: systemPrompt || undefined,
        }),
      }),
    onSuccess: async () => {
      setName('');
      setDescription('');
      setSystemPrompt('');
      setOpen(false);
      await queryClient.invalidateQueries();
      window.location.reload();
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-amber px-4 py-2 text-sm font-medium text-ink"
      >
        Nuevo negocio
      </button>
    );
  }

  return (
    <form
      className="panel rounded-xl p-5 space-y-3 max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <input
        className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm"
        placeholder="Nombre"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <select
        className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm"
        value={type}
        onChange={(event) => setType(event.target.value)}
      >
        {['OTHER', 'HOTEL', 'REAL_ESTATE', 'LABORATORY', 'CLINIC', 'LAW_FIRM', 'GYM', 'RETAIL'].map(
          (item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ),
        )}
      </select>
      <textarea
        className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm min-h-20"
        placeholder="Descripción"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <textarea
        className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm min-h-24"
        placeholder="System prompt (opcional)"
        value={systemPrompt}
        onChange={(event) => setSystemPrompt(event.target.value)}
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-amber px-4 py-2 text-sm text-ink">
          Crear
        </button>
        <button type="button" className="text-sm text-muted" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      {mutation.error ? (
        <p className="text-rose text-sm">{(mutation.error as Error).message}</p>
      ) : null}
    </form>
  );
}
