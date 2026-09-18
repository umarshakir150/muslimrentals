import { ButtonHTMLAttributes, forwardRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import Spinner from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive-ghost' | 'destructive-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-forest-600 text-white hover:bg-forest-700 active:bg-forest-800 disabled:hover:bg-forest-600',
  secondary: 'bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 disabled:hover:bg-white',
  ghost: 'bg-transparent text-neutral-900 hover:bg-neutral-100 disabled:hover:bg-transparent',
  'destructive-ghost': 'bg-white text-destructive border border-destructive/40 hover:bg-red-50 disabled:hover:bg-white',
  'destructive-solid': 'bg-destructive text-white hover:bg-destructive-hover disabled:hover:bg-destructive',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export interface ButtonProps extends BaseProps, ButtonHTMLAttributes<HTMLButtonElement> {}

// Shared button primitive (Milestone 1 design system). Radius is always
// `control` (6px) -- no more rounded-full pill buttons, per the overhaul's
// "calm down" direction. Icon-only circular buttons (header icons) are a
// deliberate exception handled by callers passing `rounded-full` in
// className, since a single-icon control reads as a control, not a
// decorative pill.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {loading && <Spinner size={size === 'sm' ? 12 : 16} />}
      {children}
    </button>
  );
});

export default Button;

export interface ButtonLinkProps extends BaseProps {
  href: string;
  onClick?: () => void;
}

// Same visual treatment as Button, for cases that navigate (Next.js Link)
// rather than trigger an in-page action.
export function ButtonLink({ variant = 'primary', size = 'md', loading = false, className, children, href, onClick }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold transition-colors',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
    >
      {loading && <Spinner size={size === 'sm' ? 12 : 16} />}
      {children}
    </Link>
  );
}
