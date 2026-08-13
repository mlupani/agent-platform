import type { BusinessType } from '../../src/common/constants';

export const SEED_INDUSTRIES = [
  'estetica',
  'peluqueria',
  'inmobiliaria',
  'clinica-dental',
] as const;

export type SeedIndustry = (typeof SEED_INDUSTRIES)[number];

export interface HourRange {
  start: string;
  end: string;
}

export interface WeeklyDay {
  dayOfWeek: number;
  isClosed: boolean;
  ranges: HourRange[];
}

export interface SeedService {
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  priceDescription: string;
  enabled?: boolean;
  requiresAppointment?: boolean;
  sortOrder: number;
}

export interface IndustrySeed {
  slug: SeedIndustry;
  type: BusinessType;
  business: {
    name: string;
    slug: string;
    description: string;
    timezone: string;
    language: string;
    address: string;
    phone: string;
    whatsapp: string;
    email: string;
    website: string;
    instagram: string;
    additionalInfo: string;
    defaultMessages: {
      welcome: string;
      appointmentConfirmation: string;
      appointmentCancellation: string;
      handoff: string;
    };
    rules: Record<string, boolean>;
  };
  weeklyHours: WeeklyDay[];
  services: SeedService[];
  faq: string;
  knowledgeBase: {
    name: string;
    description: string;
  };
  agent: {
    name: string;
    description: string;
    tone: string;
    customInstructions: string;
    personality: string;
    systemPrompt: string;
  };
  automation: {
    name: string;
    description: string;
    webhookUrl: string;
  };
  integration: {
    type: string;
    name: string;
    config: Record<string, string>;
  };
  memory: {
    key: string;
    content: string;
  };
}

export function weeklyHours(
  spec: Partial<Record<number, HourRange[] | 'closed'>>,
): WeeklyDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
    const value = spec[dayOfWeek];
    if (!value || value === 'closed') {
      return { dayOfWeek, isClosed: true, ranges: [] };
    }
    return { dayOfWeek, isClosed: false, ranges: value };
  });
}
