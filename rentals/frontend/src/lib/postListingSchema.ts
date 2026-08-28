import { z } from 'zod';
import { bedroomsSchema, bathroomsSchema } from './listingValidation';

// Mirrors the backend's listingCreateSchema (rentals/backend/src/routes/listings.ts)
// so posters get fast client-side feedback -- this is UX only, the backend
// Zod schema is the real security/validation boundary.
export const postListingSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(20, 'Description too short').max(5000),
  price: z.coerce.number().positive('Enter a valid price').max(50000),
  bedrooms: bedroomsSchema,
  bathrooms: bathroomsSchema,
  audience: z.enum(['BROTHERS', 'SISTERS', 'COUPLES', 'FAMILIES', 'ALL']),
  city: z.string().min(1, 'Select a city'),
  town: z.string().optional(),
  // Required for every new listing so coordinates can be resolved at
  // neighbourhood-level instead of falling back to the city's center point.
  // Existing listings created before this change may still have a null
  // neighbourhood -- see rentals/backend/src/routes/listings.ts for why the
  // DB column itself stays nullable while this is required at the API layer.
  neighbourhood: z.string().trim().min(1, 'Please select a neighbourhood').max(100),
  contactInfo: z.string().min(5, 'Add contact info').max(300),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
});

export type PostListingFormData = z.infer<typeof postListingSchema>;
