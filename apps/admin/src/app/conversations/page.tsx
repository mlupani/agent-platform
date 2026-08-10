import { Suspense } from 'react';
import { ConversationsInbox } from '@/components/conversations-inbox';

export default function ConversationsPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted">Cargando bandeja…</p>}
    >
      <ConversationsInbox />
    </Suspense>
  );
}
