'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiForm } from '@/lib/api';

interface KnowledgeDocument {
  id: string;
  title: string;
  source: string;
  content: string | null;
  category: string | null;
  status: string;
  mimeType: string | null;
  chunkCount: number;
  updatedAt: string;
  isFaq: boolean;
}

interface KnowledgeWorkspace {
  businessId: string;
  knowledgeBase: {
    id: string;
    name: string;
    description: string | null;
    documentCount: number;
    documents: KnowledgeDocument[];
  };
}

const statusLabel: Record<string, string> = {
  ready: 'Listo',
  pending: 'Pendiente',
  processing: 'Procesando',
  failed: 'Error',
};

export function KnowledgeManager() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['knowledge-workspace'],
    queryFn: () => api<KnowledgeWorkspace>('/admin/knowledge'),
  });

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['knowledge-workspace'] });
  };

  const saveFaq = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api(`/admin/knowledge/documents/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, content }),
        });
      }
      return api('/admin/knowledge/faq', {
        method: 'POST',
        body: JSON.stringify({ title, content, category: 'faq' }),
      });
    },
    onSuccess: async () => {
      setTitle('');
      setContent('');
      setEditingId(null);
      setMessage(editingId ? 'FAQ actualizada' : 'FAQ guardada');
      await invalidate();
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : 'No se pudo guardar');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/knowledge/documents/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setMessage('Eliminado');
      if (editingId) {
        setEditingId(null);
        setTitle('');
        setContent('');
      }
      await invalidate();
    },
  });

  const reindex = useMutation({
    mutationFn: (id: string) =>
      api<{ chunks: number }>(`/admin/knowledge/documents/${id}/reindex`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      setMessage(`Reindexado · ${result.chunks} fragmentos`);
      await invalidate();
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : 'Error al reindexar');
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!data?.knowledgeBase.id) throw new Error('Sin base de conocimiento');
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      form.append('category', 'general');
      return apiForm<{ chunks: number }>(
        `/admin/knowledge/bases/${data.knowledgeBase.id}/documents`,
        form,
      );
    },
    onSuccess: async (result) => {
      setMessage(`Archivo cargado · ${result.chunks} fragmentos`);
      await invalidate();
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : 'Error al subir');
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando conocimiento…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-sm text-rose">
        {(error as Error | undefined)?.message ?? 'No se pudo cargar'}
      </p>
    );
  }

  const docs = data.knowledgeBase.documents;

  return (
    <div className="space-y-6">
      <section className="panel rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-medium">
            {editingId ? 'Editar información' : 'Agregar información'}
          </h3>
          <p className="text-sm text-muted mt-1">
            Escribí lo que querés que el asistente sepa: horarios especiales,
            políticas, precios, FAQs. Sin jerga técnica.
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveFaq.mutate();
          }}
        >
          <input
            className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm"
            placeholder="Título (ej. Políticas de cancelación)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="w-full rounded-md bg-ink border border-line px-3 py-2 text-sm min-h-36"
            placeholder={`Podés usar secciones:\n\n## Horarios\n...\n\n## Contacto\n...`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-md bg-amber px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              disabled={saveFaq.isPending}
            >
              {saveFaq.isPending
                ? 'Guardando…'
                : editingId
                  ? 'Actualizar'
                  : 'Guardar'}
            </button>
            {editingId ? (
              <button
                type="button"
                className="text-sm text-muted"
                onClick={() => {
                  setEditingId(null);
                  setTitle('');
                  setContent('');
                }}
              >
                Cancelar edición
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-medium">Subir archivo</h3>
          <p className="text-sm text-muted mt-1">
            PDF, texto o markdown (.pdf, .txt, .md).
          </p>
        </div>
        <label className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm w-full max-w-full overflow-hidden">
          <input
            type="file"
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            className="text-sm max-w-full"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.currentTarget.value = '';
            }}
          />
          {upload.isPending ? (
            <span className="text-muted">Subiendo…</span>
          ) : null}
        </label>
      </section>

      <section className="panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-medium">{data.knowledgeBase.name}</h3>
            <p className="text-sm text-muted mt-1">
              {data.knowledgeBase.documentCount} ítems · lo que usa el asistente
              para responder
            </p>
          </div>
        </div>

        {!docs.length ? (
          <p className="text-sm text-muted">
            Todavía no hay información. Agregá una FAQ o subí un archivo.
          </p>
        ) : (
          <ul className="space-y-3">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="border-b border-line/70 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{doc.title}</p>
                    <p className="mono text-[11px] text-muted mt-1">
                      {statusLabel[doc.status] ?? doc.status}
                      {doc.category ? ` · ${doc.category}` : ''}
                      {` · ${doc.chunkCount} fragmentos`}
                    </p>
                    {doc.content ? (
                      <p className="text-sm text-muted mt-2 line-clamp-2 whitespace-pre-wrap">
                        {doc.content}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {doc.content ? (
                      <button
                        type="button"
                        className="rounded-md border border-line px-3 py-2 min-h-10 text-teal"
                        onClick={() => {
                          setEditingId(doc.id);
                          setTitle(doc.title);
                          setContent(doc.content ?? '');
                          setMessage(null);
                        }}
                      >
                        Editar
                      </button>
                    ) : null}
                    {doc.content ? (
                      <button
                        type="button"
                        className="rounded-md border border-line px-3 py-2 min-h-10 text-muted"
                        disabled={reindex.isPending}
                        onClick={() => reindex.mutate(doc.id)}
                      >
                        Reindexar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-md border border-rose/30 px-3 py-2 min-h-10 text-rose"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`¿Eliminar “${doc.title}”?`)) {
                          remove.mutate(doc.id);
                        }
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message ? <p className="text-sm text-teal">{message}</p> : null}
    </div>
  );
}
