import { redirect } from 'next/navigation';

export default async function ConversationDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/conversations?c=${id}`);
}
