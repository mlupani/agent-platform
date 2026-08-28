import type { AdminNotifyEvent } from './admin-notify.constants';

export interface AdminNotifyPublicConfig {
  enabled: boolean;
  email: string | null;
  events: AdminNotifyEvent[];
  emailConfigured: boolean;
}

export interface AppointmentNotifyInput {
  businessId: string;
  id: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  startsAt: Date;
  timezone?: string | null;
  notes?: string | null;
  isTrial?: boolean | null;
  status?: string | null;
  previousStartsAt?: Date | null;
  service?: { name?: string | null } | null;
}

export interface LeadNotifyInput {
  businessId: string;
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  interest?: string | null;
  message?: string | null;
  status?: string | null;
}

export interface ClientAutoCreatedNotifyInput {
  businessId: string;
  leadId: string;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
}
