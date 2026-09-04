import { ListingFilters } from '@/types';

/**
 * Builds the GET /listings query params shared between /browse and /map --
 * extracted so both pages compose keyword/city/location-radius/other
 * filters identically (the founder's explicit "Browse and Map results
 * should remain consistent with each other" requirement) instead of each
 * page re-implementing its own conditional-inclusion logic that could
 * silently drift apart. Deliberately excludes `sort`/`page`/`limit` --
 * each page's own pagination/ordering needs differ (browse paginates at
 * 24/page; map fetches up to 200 at once with no pagination UI), so those
 * stay page-specific rather than forced into one shared shape here.
 */
export function buildListingSearchParams(filters: ListingFilters): Record<string, any> {
  return {
    ...(filters.keyword && { keyword: filters.keyword }),
    ...(filters.city && { city: filters.city }),
    ...(filters.audience && filters.audience !== 'all' && { audience: filters.audience }),
    ...(filters.minBeds && { minBeds: filters.minBeds }),
    ...(filters.minBaths && { minBaths: filters.minBaths }),
    ...(filters.maxPrice && { maxPrice: filters.maxPrice }),
    ...(filters.furnished && { furnished: true }),
    ...(filters.parking && { parking: true }),
    ...(filters.utilities && { utilities: true }),
    // lat/lng/radiusKm (the location-radius search) only ever composes in
    // together as a trio -- radiusKm alone with no lat/lng would be a
    // meaningless filter, and the backend requires lat+lng+radiusKm
    // together to do anything with them anyway.
    ...(filters.lat != null && filters.lng != null && {
      lat: filters.lat,
      lng: filters.lng,
      radiusKm: filters.radiusKm,
    }),
  };
}
