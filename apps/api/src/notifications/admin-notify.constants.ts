export const ADMIN_NOTIFY_EVENTS = [
  'appointment.created',
  'appointment.cancelled',
  'appointment.rescheduled',
  'lead.created',
  'client.auto_created',
] as const;

export type AdminNotifyEvent = (typeof ADMIN_NOTIFY_EVENTS)[number];

export const DEFAULT_ADMIN_NOTIFY_EVENTS: AdminNotifyEvent[] = [
  'appointment.created',
  'lead.created',
  'client.auto_created',
];
