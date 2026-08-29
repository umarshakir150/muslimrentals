import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MapPage from './page';

// Real root cause of "map covers Sign In / Sign Up" (confirmed via
// document.elementFromPoint() hit-testing against a real production
// build): the map card wrapper below has position:relative but no
// z-index, so it never becomes a stacking context on its own. Its loading
// overlay (z-index: 1000) escaped into the page's top-level stacking
// context and painted above any modal opened during that window (a real,
// not-rare window -- a slow/cold-started backend keeps `loading` true for
// seconds). isolation: isolate contains it. This test guards the fix at
// the DOM/style level; the actual stacking behavior was verified with
// Playwright hit-testing, not reproducible in jsdom (no real layout/paint).
vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = (props: any) => <div data-testid="dynamic-stub" data-props={JSON.stringify(Object.keys(props))} />;
    return Stub;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

vi.mock('@/lib/api', () => ({
  listingsApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe('Map page stacking context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isolates the map card so its loading overlay (and Leaflet panes) can never paint above a modal', async () => {
    const { container } = render(<MapPage />);

    await waitFor(() => expect(screen.getByTestId('navbar')).toBeInTheDocument());

    // eslint-disable-next-line testing-library/no-node-access
    const card = container.querySelector('.border.border-ink\\/8.shadow-card.bg-white') as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(card.style.isolation).toBe('isolate');
    expect(card.style.position).toBe('relative');
  });
});
