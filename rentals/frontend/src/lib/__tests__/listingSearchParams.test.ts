import { describe, it, expect } from 'vitest';
import { buildListingSearchParams } from '@/lib/listingSearchParams';
import type { ListingFilters } from '@/types';

function baseFilters(overrides: Partial<ListingFilters> = {}): ListingFilters {
  return {
    keyword: '', city: '', audience: 'all', minBeds: 0, minBaths: 0,
    radiusKm: 5, sort: 'newest',
    furnished: false, parking: false, utilities: false, page: 1,
    ...overrides,
  };
}

describe('buildListingSearchParams', () => {
  it('includes nothing beyond defaults when no filter is active', () => {
    expect(buildListingSearchParams(baseFilters())).toEqual({});
  });

  it('includes keyword when set', () => {
    expect(buildListingSearchParams(baseFilters({ keyword: 'basement' }))).toEqual({ keyword: 'basement' });
  });

  it('includes city when set', () => {
    expect(buildListingSearchParams(baseFilters({ city: 'Toronto' }))).toEqual({ city: 'Toronto' });
  });

  it('excludes audience when "all" (the no-filter sentinel), includes it otherwise', () => {
    expect(buildListingSearchParams(baseFilters({ audience: 'all' }))).toEqual({});
    expect(buildListingSearchParams(baseFilters({ audience: 'FAMILIES' }))).toEqual({ audience: 'FAMILIES' });
  });

  it('includes lat/lng/radiusKm together only when both lat and lng are set', () => {
    expect(buildListingSearchParams(baseFilters({ lat: 43.65, lng: -79.38, radiusKm: 7 })))
      .toEqual({ lat: 43.65, lng: -79.38, radiusKm: 7 });
  });

  it('never includes lat/lng/radiusKm when only radiusKm is set (no location searched yet)', () => {
    expect(buildListingSearchParams(baseFilters({ radiusKm: 7 }))).toEqual({});
  });

  it('never includes lat/lng when lat is set but lng is not (an inconsistent partial state)', () => {
    expect(buildListingSearchParams(baseFilters({ lat: 43.65 }))).toEqual({});
  });

  it('composes keyword + city + location-radius + amenity filters together, none overwriting another', () => {
    const params = buildListingSearchParams(baseFilters({
      keyword: 'basement',
      city: 'Toronto',
      lat: 43.773,
      lng: -79.257,
      radiusKm: 5,
      furnished: true,
      minBeds: 2,
    }));

    expect(params).toEqual({
      keyword: 'basement',
      city: 'Toronto',
      lat: 43.773,
      lng: -79.257,
      radiusKm: 5,
      furnished: true,
      minBeds: 2,
    });
  });

  it('never includes sort, page, or limit -- those stay page-specific', () => {
    const params = buildListingSearchParams(baseFilters({ keyword: 'x' }));
    expect(params).not.toHaveProperty('sort');
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('limit');
  });
});
