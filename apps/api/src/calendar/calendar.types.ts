export interface GoogleCalendarPublicConfig {
  id: string;
  businessId: string;
  calendarId: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  connectedEmail: string | null;
  hasRefreshToken: boolean;
  oauthConfigured: boolean;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface AvailableSlot {
  start: string;
  end: string;
  startIso: string;
  endIso: string;
  remaining?: number;
  capacity?: number;
  serviceId?: string;
}

/**
 * Quién originó la acción sobre la cita. Solo `'assistant'` dispara los avisos
 * por email al estudio; las acciones manuales desde el panel no notifican.
 */
export type AppointmentActionSource = 'assistant' | 'manual';

export interface CreateAppointmentInput {
  businessId: string;
  serviceId?: string;
  conversationId?: string;
  userId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  startsAt: Date;
  endsAt?: Date;
  timezone: string;
  notes?: string;
  status?: string;
  isTrial?: boolean;
  /** Recupero: la alumna repone una clase a la que no pudo asistir. */
  isMakeup?: boolean;
  /** Origen de la acción. Sin especificar se trata como `'manual'` (no notifica). */
  source?: AppointmentActionSource;
}
