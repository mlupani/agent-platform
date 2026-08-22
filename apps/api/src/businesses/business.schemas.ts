import { z } from 'zod';
import { assistantTones, businessTypes } from '../common/constants';

export const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const businessHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean().default(false),
  ranges: z.array(timeRangeSchema).default([]),
});

export const configuredMessagesSchema = z.object({
  welcome: z.string().max(2000).optional(),
  offline: z.string().max(2000).optional(),
  handoff: z.string().max(2000).optional(),
  appointmentConfirmation: z.string().max(2000).optional(),
  appointmentCancellation: z.string().max(2000).optional(),
  error: z.string().max(2000).optional(),
  fallback: z.string().max(2000).optional(),
});

export const updateBusinessProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  type: z.enum(businessTypes).optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  website: z.string().url().optional().nullable().or(z.literal('')),
  instagram: z.string().max(120).optional().nullable(),
  googleReviewsUrl: z.string().url().optional().nullable().or(z.literal('')),
  additionalInfo: z.string().max(4000).optional().nullable(),
  rules: z.record(z.unknown()).optional(),
  defaultMessages: configuredMessagesSchema.optional(),
});

export const updateAssistantSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  tone: z.enum(assistantTones).optional(),
  customInstructions: z.string().max(8000).optional().nullable(),
  systemPrompt: z.string().max(16000).optional(),
  personality: z.string().max(2000).optional().nullable(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabledTools: z.array(z.string()).optional(),
});

export const replaceHoursSchema = z.object({
  hours: z.array(businessHourSchema).min(1).max(7),
});

export const createServiceSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  price: z.number().nonnegative().optional().nullable(),
  priceDescription: z.string().max(200).optional().nullable(),
  enabled: z.boolean().optional(),
  requiresAppointment: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateServiceSchema = createServiceSchema.partial();
