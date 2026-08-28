import { z } from 'zod';

export const MAX_BEDROOMS = 20;
export const MAX_BATHROOMS = 20;

// z.coerce.number() turns '' into 0 (Number('') === 0), so an emptied field
// would silently pass validation instead of surfacing an error. Preprocess
// '' (and null/undefined) to undefined first so it hits the required error.
const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const bedroomsSchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce
    .number({
      required_error: 'Enter a number of bedrooms',
      invalid_type_error: 'Enter a number of bedrooms',
    })
    .min(0, "Bedrooms can't be negative")
    .max(MAX_BEDROOMS, "That's higher than we support (max 20)")
);

export const bathroomsSchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce
    .number({
      required_error: 'Enter a number of bathrooms',
      invalid_type_error: 'Enter a number of bathrooms',
    })
    .int('Whole numbers only')
    .min(0, "Bathrooms can't be negative")
    .max(MAX_BATHROOMS, "That's higher than we support (max 20)")
);
