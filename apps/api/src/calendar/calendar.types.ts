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
}
