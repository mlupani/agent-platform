import { LeadDetailView } from '@/components/lead-detail';

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadDetailView id={id} />;
}
