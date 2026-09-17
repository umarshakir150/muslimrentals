import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: number;
  className?: string;
}

// Small inline spinner for button-loading and short indeterminate actions.
// Uses currentColor so it matches whatever text color it's placed in
// (e.g. white inside a primary button, forest-600 as a standalone loader).
export default function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin shrink-0', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
