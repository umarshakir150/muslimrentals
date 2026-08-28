import { z } from 'zod';

export const MAX_BEDROOMS = 20;
export const MAX_BATHROOMS = 20;

export const bedroomsSchema = z.coerce
  .number({ invalid_type_error: 'Enter a number of bedrooms' })
  .min(0, "Bedrooms can't be negative")
  .max(MAX_BEDROOMS, "That's higher than we support (max 20)");

export const bathroomsSchema = z.coerce
  .number({ invalid_type_error: 'Enter a number of bathrooms' })
  .int('Whole numbers only')
  .min(0, "Bathrooms can't be negative")
  .max(MAX_BATHROOMS, "That's higher than we support (max 20)");
