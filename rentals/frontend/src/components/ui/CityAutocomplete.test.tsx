import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CityAutocomplete from './CityAutocomplete';

const { CITIES } = vi.hoisted(() => ({
  CITIES: [
    { name: 'Toronto', province: 'ON', lat: 43.6532, lng: -79.3832 },
    { name: 'Ottawa', province: 'ON', lat: 45.4215, lng: -75.6972 },
    { name: 'Oshawa', province: 'ON', lat: 43.8971, lng: -78.8658 },
    { name: 'Vancouver', province: 'BC', lat: 49.2827, lng: -123.1207 },
  ],
}));

vi.mock('@/lib/api', () => ({
  citiesApi: { getAll: vi.fn().mockResolvedValue({ data: CITIES }) },
}));

describe('CityAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(props?: Partial<ComponentProps<typeof CityAutocomplete>>) {
    const onChange = vi.fn();
    const utils = render(
      <CityAutocomplete value="" onChange={onChange} {...props} />
    );
    return { onChange, ...utils };
  }

  // The suggestion label highlights the matched substring by splitting it
  // into multiple text/`<strong>` nodes, and the accessible-name algorithm
  // inserts a space between sibling nodes - so match loosely, ignoring
  // whitespace, rather than asserting on a literal contiguous substring.
  function suggestionNamed(city: string) {
    const needle = city.toLowerCase();
    return screen.findByRole('button', {
      name: (accessibleName) => accessibleName.replace(/\s+/g, '').toLowerCase().includes(needle),
    });
  }

  it('shows matching suggestions as the user types', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('Search cities...'), 'osh');

    expect(await suggestionNamed('Oshawa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vancouver/ })).not.toBeInTheDocument();
  });

  it('does not show suggestions for an empty query', async () => {
    setup();
    await waitFor(() => expect(screen.queryByText('Toronto')).not.toBeInTheDocument());
  });

  it('calls onChange with the city name and coordinates when a suggestion is selected', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    const input = screen.getByPlaceholderText('Search cities...');
    await user.type(input, 'toronto');

    const option = await suggestionNamed('Toronto');
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith('Toronto', [43.6532, -79.3832], 'ON');
    expect(input).toHaveValue('Toronto');
  });

  it('selects the focused suggestion with arrow keys + enter', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    const input = screen.getByPlaceholderText('Search cities...');
    await user.type(input, 'o');
    await suggestionNamed('Toronto');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);
    const [selectedName] = onChange.mock.calls[0];
    expect(['Toronto', 'Ottawa', 'Oshawa']).toContain(selectedName);
  });

  it('clears the query and calls onChange("") when the clear button is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ value: 'Toronto' });

    const clearButton = await screen.findByRole('button', { name: 'Clear city' });
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByPlaceholderText('Search cities...')).toHaveValue('');
  });
});
