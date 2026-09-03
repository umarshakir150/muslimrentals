import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportModal, { REPORT_REASONS } from './ReportModal';

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

beforeEach(() => {
  toastMock.mockReset();
});

describe('ReportModal reason taxonomy', () => {
  it('shows LISTING-only reasons for a LISTING target, never the USER/MESSAGE-only "Impersonation" reason', () => {
    render(<ReportModal open onClose={vi.fn()} targetType="LISTING" contextLabel="Cozy 2BR" onSubmit={vi.fn()} />);
    expect(screen.getByText('Misleading or fraudulent listing')).toBeInTheDocument();
    expect(screen.queryByText('Impersonation')).not.toBeInTheDocument();
  });

  it('shows "Impersonation" for a USER target but never the listing-only fraud reason', () => {
    render(<ReportModal open onClose={vi.fn()} targetType="USER" contextLabel="Jane Doe" onSubmit={vi.fn()} />);
    expect(screen.getByText('Impersonation')).toBeInTheDocument();
    expect(screen.queryByText('Misleading or fraudulent listing')).not.toBeInTheDocument();
  });

  it('never shows "Impersonation" for a MESSAGE target', () => {
    render(<ReportModal open onClose={vi.fn()} targetType="MESSAGE" contextLabel="Hey, still available?" onSubmit={vi.fn()} />);
    expect(screen.queryByText('Impersonation')).not.toBeInTheDocument();
    expect(screen.queryByText('Misleading or fraudulent listing')).not.toBeInTheDocument();
  });

  it('"Scam or fraud attempt" is worded identically across all three target types', () => {
    expect(REPORT_REASONS.LISTING).toContain('Scam or fraud attempt');
    expect(REPORT_REASONS.USER).toContain('Scam or fraud attempt');
    expect(REPORT_REASONS.MESSAGE).toContain('Scam or fraud attempt');
  });
});

describe('ReportModal submit flow', () => {
  it('walks reason-select -> description -> submitting -> success, then closes and toasts', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportModal open onClose={onClose} targetType="USER" contextLabel="Jane Doe" onSubmit={onSubmit} />);

    await user.click(screen.getByText('Harassment or abusive behavior'));
    expect(screen.getByLabelText(/Anything else/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Anything else/), 'Extra context');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Harassment or abusive behavior', 'Extra context'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Report submitted' }));
  });

  it('submits without a description when the optional field is left blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ReportModal open onClose={vi.fn()} targetType="MESSAGE" contextLabel="Hey there" onSubmit={onSubmit} />);

    await user.click(screen.getByText('Spam'));
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Spam', undefined));
  });

  it('shows an inline error with a retry affordance on failure, without closing the modal', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportModal open onClose={onClose} targetType="LISTING" contextLabel="Cozy 2BR" onSubmit={onSubmit} />);

    await user.click(screen.getByText('Spam'));
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(screen.getByText('Network down')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();

    // Retry re-submits the same reason and succeeds this time.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('resets to a clean reason-select state each time it is reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportModal open onClose={vi.fn()} targetType="LISTING" contextLabel="Cozy 2BR" onSubmit={vi.fn()} />);

    await user.click(screen.getByText('Spam'));
    expect(screen.getByLabelText(/Anything else/)).toBeInTheDocument();

    rerender(<ReportModal open={false} onClose={vi.fn()} targetType="LISTING" contextLabel="Cozy 2BR" onSubmit={vi.fn()} />);
    rerender(<ReportModal open onClose={vi.fn()} targetType="LISTING" contextLabel="Cozy 2BR" onSubmit={vi.fn()} />);

    expect(screen.getByText('Misleading or fraudulent listing')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Anything else/)).not.toBeInTheDocument();
  });
});
