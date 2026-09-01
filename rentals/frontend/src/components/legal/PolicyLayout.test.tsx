import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PolicyLayout, { PolicySection } from './PolicyLayout';

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

function sections(count: number): PolicySection[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `section-${i}`,
    heading: `Section heading ${i}`,
    body: <p>Body text {i}</p>,
  }));
}

describe('PolicyLayout', () => {
  it('renders the title and effective date', () => {
    render(<PolicyLayout title="Terms of Service" effectiveDate="September 1, 2026" sections={sections(2)} />);
    expect(screen.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Effective September 1, 2026')).toBeInTheDocument();
  });

  it('numbers each section and gives it an anchor id matching its data', () => {
    render(<PolicyLayout title="Test" effectiveDate="today" sections={sections(2)} />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s[0]).toHaveTextContent('1. Section heading 0');
    expect(h2s[1]).toHaveTextContent('2. Section heading 1');
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.getElementById('section-0')).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.getElementById('section-1')).toBeInTheDocument();
  });

  it('only shows a table of contents once there are more than 3 sections, and its links match the section anchors', () => {
    const { rerender } = render(<PolicyLayout title="Test" effectiveDate="today" sections={sections(3)} />);
    expect(screen.queryByRole('navigation', { name: 'Table of contents' })).not.toBeInTheDocument();

    rerender(<PolicyLayout title="Test" effectiveDate="today" sections={sections(4)} />);
    const toc = screen.getByRole('navigation', { name: 'Table of contents' });
    const links = within(toc).getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute('href', '#section-0');
    expect(links[3]).toHaveAttribute('href', '#section-3');
  });

  it('links to every other policy page for consistent cross-navigation', () => {
    render(<PolicyLayout title="Test" effectiveDate="today" sections={sections(1)} />);
    const relatedNav = screen.getByRole('navigation', { name: 'Other policies' });
    const hrefs = within(relatedNav).getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/terms', '/privacy', '/community-guidelines', '/safety', '/contact']));
  });
});
