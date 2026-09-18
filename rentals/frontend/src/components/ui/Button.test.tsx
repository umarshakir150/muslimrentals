import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders children and responds to click', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);

    const btn = screen.getByRole('button', { name: 'Save' });
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and non-interactive when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick} disabled>Save</Button>);

    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled while loading, even without an explicit disabled prop', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('renders every variant without throwing', () => {
    const variants = ['primary', 'secondary', 'ghost', 'destructive-ghost', 'destructive-solid'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole('button', { name: variant })).toBeInTheDocument();
      unmount();
    }
  });
});
