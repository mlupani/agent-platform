export const LEAD_STATUSES = [
  'new',
  'contacted',
  'interested',
  'won',
  'lost',
  'inactive',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TERMINAL_LEAD_STATUSES: LeadStatus[] = ['won', 'lost', 'inactive'];

export const LEAD_FOLLOW_UP_STATUSES = [
  'pending',
  'generating',
  'review',
  'sent',
  'cancelled',
  'failed',
  'skipped',
] as const;

export type LeadFollowUpStatus = (typeof LEAD_FOLLOW_UP_STATUSES)[number];

export const LEAD_FOLLOW_UP_SOURCES = ['auto', 'manual', 'agent'] as const;
export type LeadFollowUpSource = (typeof LEAD_FOLLOW_UP_SOURCES)[number];

export const LEAD_FOLLOW_UP_OBJECTIVES = [
  'resume_conversation',
  'complete_contact_data',
  'resolve_objection',
  'book_appointment',
  'confirm_appointment',
  'remind_payment',
  'renew_membership',
] as const;

export type LeadFollowUpObjective = (typeof LEAD_FOLLOW_UP_OBJECTIVES)[number];

export const CONVERSION_MODES = ['manual', 'suggested', 'automatic'] as const;
export type ConversionMode = (typeof CONVERSION_MODES)[number];

export const CONVERSION_TRIGGERS = [
  'payment.created',
  'appointment.confirmed',
] as const;

export const SEND_MODES = ['auto', 'review', 'reminder_only'] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const DEFAULT_FOLLOW_UP_DELAYS_HOURS = [24, 72, 168];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isFollowUpObjective(
  value: string,
): value is LeadFollowUpObjective {
  return (LEAD_FOLLOW_UP_OBJECTIVES as readonly string[]).includes(value);
}
