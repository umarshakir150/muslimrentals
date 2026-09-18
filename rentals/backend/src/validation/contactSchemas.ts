import { z } from 'zod';

export const CONTACT_SUBJECTS = ['listing', 'account', 'safety', 'report', 'other'] as const;

export const contactSchema = z.object({
  name:    z.string().min(1).max(100).trim(),
  email:   z.string().email().max(254).trim(),
  subject: z.enum(CONTACT_SUBJECTS),
  message: z.string().min(1).max(5000).trim(),
}).strict();
