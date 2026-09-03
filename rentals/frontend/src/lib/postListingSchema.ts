import { z } from 'zod';
import { bedroomsSchema, bathroomsSchema } from './listingValidation';

// Mirrors the backend's listingCreateSchema (rentals/backend/src/validation/listingSchemas.ts)
// so posters get fast client-side feedback -- this is UX only, the backend
// Zod schema is the real security/validation boundary.
//
// Location model: the landlord enters the real property address; the
// backend geocodes it server-side into precise coordinates (never trusts a
// client-supplied lat/lng, so this schema doesn't even have those fields).
// `unit` is optional, private, and kept separate from `address` since it's
// never used for geocoding. There is no `neighbourhood` field any more --
// the dropdown and its centroid-based positioning were removed; existing
// listings' neighbourhood values (display-only elsewhere) are unaffected.
export const postListingSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(20, 'Description too short').max(5000),
  price: z.coerce.number().positive('Enter a valid price').max(50000),
  bedrooms: bedroomsSchema,
  bathrooms: bathroomsSchema,
  audience: z.enum(['BROTHERS', 'SISTERS', 'COUPLES', 'FAMILIES', 'ALL']),
  city: z.string().min(1, 'Select a city'),
  town: z.string().optional(),
  province: z.string().optional(),
  address: z.string().trim().min(3, 'Enter the property\'s street address').max(200),
  unit: z.string().trim().max(50).optional(),
  contactInfo: z.string().min(5, 'Add contact info').max(300),
});

export type PostListingFormData = z.infer<typeof postListingSchema>;
