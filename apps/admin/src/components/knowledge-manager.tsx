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
  vectorsEnabled: boolean;
  knowledgeBase: {
    id: string;
    name: string;
    description: string | null;
    documentCount: number;
    documents: KnowledgeDocument[];
  };
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Indexado',
  pending: 'Guardado',
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
  const [dragOver, setDragOver] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['knowledge-workspace'] });
  };

  const saveFaq = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api<{ chunks: number; indexed?: boolean }>(
          `/admin/knowledge/documents/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ title, content }),
          },
        );
      }
      return api<{ chunks: number; indexed?: boolean }>(
        '/admin/knowledge/faq',
        {
          method: 'POST',
          body: JSON.stringify({ title, content, category: 'faq' }),
        },
      );
    },
    onSuccess: async (result) => {
      setTitle('');
      setContent('');
      setEditingId(null);
      setMessage(resultMessage(editingId ? 'Nota actualizada' : 'Nota guardada', result));
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
      api<{ chunks: number; indexed?: boolean }>(
        `/admin/knowledge/documents/${id}/reindex`,
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      setMessage(resultMessage('Reindexado', result));
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
      return apiForm<{ chunks: number; indexed?: boolean }>(
        `/admin/knowledge/bases/${data.knowledgeBase.id}/documents`,
        form,
      );
    },
    onSuccess: async (result) => {
      setMessage(resultMessage('Archivo cargado', result));
      await invalidate();
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : 'Error al subir');
    },
  });

  function handleFiles(files: FileList | File[] | null) {
    const file = files?.[0];
    if (!file) return;
    upload.mutate(file);
  }

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
  const vectorsOn = data.vectorsEnabled;

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Conocimiento</h2>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Notas, políticas y archivos extra que el asistente consulta además de
          la ficha del negocio. Pensado para catálogos o documentos largos.
        </p>
      </header>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          vectorsOn
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-line bg-panel-2 text-muted'
        }`}
      >
        {vectorsOn ? (
          <p>
            Los vectores están activos: al guardar se indexa para búsqueda
            semántica.
          </p>
        ) : (
          <p>
            Podés cargar todo ahora. El texto queda guardado; los vectores se
            generan cuando pases a modo OpenAI y pulses Reindexar.
          </p>
        )}
      </div>

      <section className="panel rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="font-medium">
            {editingId ? 'Editar nota' : 'Nueva nota'}
          </h3>
          <p className="text-sm text-muted mt-1">
            Políticas, precios, FAQs, excepciones. Lo que no entra en la ficha
            del negocio.
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveFaq.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Título</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 min-h-10"
              placeholder="Políticas de cancelación"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Contenido</span>
            <textarea
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 min-h-36"
              placeholder={'Horarios especiales, condiciones, precios…'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-nav-active text-white px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
              disabled={saveFaq.isPending}
            >
              {saveFaq.isPending
                ? 'Guardando…'
                : editingId
                  ? 'Actualizar'
                  : 'Guardar nota'}
            </button>
            {editingId ? (
              <button
                type="button"
                className="rounded-lg border border-line px-4 py-2.5 text-sm min-h-10 text-muted"
                onClick={() => {
                  setEditingId(null);
                  setTitle('');
                  setContent('');
                }}
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="font-medium">Subir archivo</h3>
          <p className="text-sm text-muted mt-1">PDF, texto o markdown.</p>
        </div>
        <label
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-sm cursor-pointer transition ${
            dragOver
              ? 'border-nav-active bg-accent-soft'
              : 'border-line bg-panel-2 text-muted'
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            handleFiles(event.dataTransfer.files);
          }}
        >
          <span>
            {upload.isPending
              ? 'Subiendo…'
              : 'Arrastrá un archivo o hacé clic para elegir'}
          </span>
          <span className="text-xs">.pdf · .txt · .md</span>
          <input
            type="file"
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            className="sr-only"
            disabled={upload.isPending}
            onChange={(event) => {
              handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
      </section>

      <section className="panel rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="font-medium">{data.knowledgeBase.name}</h3>
          <p className="text-sm text-muted mt-1">
            {data.knowledgeBase.documentCount}{' '}
            {data.knowledgeBase.documentCount === 1 ? 'ítem' : 'ítems'}
          </p>
        </div>

        {!docs.length ? (
          <p className="text-sm text-muted">
            Todavía no hay documentos. Agregá una nota o subí un archivo.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((doc) => (
              <li key={doc.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{doc.title}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          doc.status === 'ready'
                            ? 'bg-emerald-50 text-emerald-800'
                            : doc.status === 'failed'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-panel-2 text-muted'
                        }`}
                      >
                        {STATUS_LABEL[doc.status] ?? doc.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {doc.category ? `${doc.category} · ` : ''}
                      {doc.chunkCount}{' '}
                      {doc.chunkCount === 1 ? 'fragmento' : 'fragmentos'}
                    </p>
                    {doc.content ? (
                      <p className="text-sm text-muted mt-2 line-clamp-2 whitespace-pre-wrap">
                        {doc.content}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {doc.content ? (
                      <button
                        type="button"
                        className="rounded-lg border border-line px-3 py-2 min-h-10"
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
                    <button
                      type="button"
                      className="rounded-lg border border-line px-3 py-2 min-h-10 text-muted"
                      disabled={reindex.isPending}
                      onClick={() => reindex.mutate(doc.id)}
                    >
                      Reindexar
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose/30 px-3 py-2 min-h-10 text-rose"
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

      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}

function resultMessage(
  prefix: string,
  result: { chunks: number; indexed?: boolean },
): string {
  const parts = [`${prefix} · ${result.chunks} fragmentos`];
  if (result.indexed === false) {
    parts.push('vectores pendientes (modo free)');
  }
  return parts.join(' · ');
}
