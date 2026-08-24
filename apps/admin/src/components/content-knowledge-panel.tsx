'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiForm } from '@/lib/api';

interface ContentKnowledgeDocument {
  id: string;
  title: string;
  source: string;
  content: string | null;
  category: string | null;
  status: string;
  mimeType: string | null;
  chunkCount: number;
  updatedAt: string;
  isNote: boolean;
}

interface ContentKnowledgeWorkspace {
  businessId: string;
  vectorsEnabled: boolean;
  knowledgeBase: {
    id: string;
    name: string;
    description: string | null;
    documentCount: number;
    documents: ContentKnowledgeDocument[];
  };
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Indexado',
  pending: 'Guardado',
  processing: 'Procesando',
  failed: 'Error',
};

function resultMessage(
  prefix: string,
  result: { chunks?: number; indexed?: boolean },
) {
  if (result.indexed === false) {
    return `${prefix}. Guardado (indexación vectorial desactivada en modo free).`;
  }
  return `${prefix}${result.chunks != null ? ` · ${result.chunks} fragmentos` : ''}`;
}

export function ContentKnowledgePanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['content-knowledge'],
    queryFn: () => api<ContentKnowledgeWorkspace>('/admin/content/knowledge'),
  });

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['content-knowledge'] });
  };

  const saveNote = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api<{ chunks: number; indexed?: boolean }>(
          `/admin/content/knowledge/documents/${editingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ title, content }),
          },
        );
      }
      return api<{ chunks: number; indexed?: boolean }>(
        '/admin/content/knowledge/notes',
        {
          method: 'POST',
          body: JSON.stringify({ title, content, category: 'content' }),
        },
      );
    },
    onSuccess: async (result) => {
      setTitle('');
      setContent('');
      setEditingId(null);
      setMessage(
        resultMessage(editingId ? 'Nota actualizada' : 'Nota guardada', result),
      );
      await invalidate();
    },
    onError: (err) => {
      setMessage((err as Error)?.message || 'No se pudo guardar');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/content/knowledge/documents/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setMessage('Documento eliminado');
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
        `/admin/content/knowledge/documents/${id}/reindex`,
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      setMessage(resultMessage('Reindexado', result));
      await invalidate();
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      return apiForm<{ chunks: number; indexed?: boolean }>(
        '/admin/content/knowledge/upload',
        form,
      );
    },
    onSuccess: async (result) => {
      setMessage(resultMessage('Archivo subido', result));
      await invalidate();
    },
    onError: (err) => {
      setMessage((err as Error)?.message || 'No se pudo subir el archivo');
    },
  });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    upload.mutate(file);
  };

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando lineamientos…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-sm text-red-600">
        No se pudieron cargar los lineamientos de contenido.
      </p>
    );
  }

  const docs = data.knowledgeBase.documents;

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="panel rounded-2xl p-6 space-y-3">
        <h3 className="font-medium">Lineamientos de contenido</h3>
        <p className="text-sm text-muted">
          Subí notas o archivos sobre el público, el tono, qué tipo de piezas
          querés (educativo, comedia, venta) y qué evitar. Se usan al armar el
          guion y generar la pieza, además del brief que escribas.
        </p>
        <p className="text-xs text-muted">
          Esta base es solo para Contenido: no alimenta el chat del agente.
          {!data.vectorsEnabled
            ? ' Indexación vectorial desactivada (modo free): igual se inyecta el texto completo.'
            : null}
        </p>
        {message ? (
          <p className="text-sm text-accent bg-accent/10 rounded-lg px-3 py-2">
            {message}
          </p>
        ) : null}
      </section>

      <section className="panel rounded-2xl p-6 space-y-4">
        <h3 className="font-medium">
          {editingId ? 'Editar nota' : 'Nueva nota'}
        </h3>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveNote.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Título</span>
            <input
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 min-h-10"
              placeholder="Público objetivo · tono · ejemplos"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Contenido</span>
            <textarea
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 min-h-40"
              placeholder={
                'Ej. Público: mujeres 30–50 en CABA.\nTono: cercano, sin corporativo.\nEducativo: tips de postura.\nComedia: situaciones de oficina.\nVenta: clase de prueba gratis.\nEvitar: promesas médicas.'
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
              disabled={saveNote.isPending}
            >
              {saveNote.isPending
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

      <section className="panel rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="font-medium">Subir archivo</h3>
          <p className="text-sm text-muted mt-1">
            PDF, texto o markdown con brand kit, guías de audiencia o ejemplos.
          </p>
        </div>
        <label
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-sm cursor-pointer transition ${
            dragOver
              ? 'border-accent bg-accent/10'
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
          <input
            type="file"
            accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </section>

      <section className="panel rounded-2xl p-6 space-y-4">
        <h3 className="font-medium">
          Documentos ({data.knowledgeBase.documentCount})
        </h3>
        {docs.length === 0 ? (
          <p className="text-sm text-muted">
            Todavía no hay lineamientos. Agregá una nota o subí un archivo.
          </p>
        ) : (
          <ul className="space-y-3">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="rounded-xl border border-line p-4 space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{doc.title}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {STATUS_LABEL[doc.status] ?? doc.status}
                      {doc.chunkCount ? ` · ${doc.chunkCount} fragmentos` : ''}
                      {doc.isNote ? ' · nota' : ` · ${doc.source}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {doc.content ? (
                      <button
                        type="button"
                        className="text-xs text-accent underline-offset-2 hover:underline"
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
                      className="text-xs text-muted underline-offset-2 hover:underline"
                      disabled={reindex.isPending}
                      onClick={() => reindex.mutate(doc.id)}
                    >
                      Reindexar
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 underline-offset-2 hover:underline"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(doc.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                {doc.content ? (
                  <p className="text-xs text-muted line-clamp-3 whitespace-pre-wrap">
                    {doc.content}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
