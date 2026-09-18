import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared label/helper/error chrome (Milestone 1 design system) wrapping a
// native <input>/<textarea>/<select> -- not a Radix Select, deliberately,
// to match the codebase's existing convention (e.g. ListingFilters.tsx's
// native <select>s) rather than introducing a second pattern in this
// milestone. A future milestone can swap the native <select> internals for
// Radix's if a given flow needs it, without changing this wrapper's API.

interface FieldChromeProps {
  label?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

function FieldChrome({ label, helperText, error, required, className, children }: FieldChromeProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-sm font-medium text-neutral-900">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[13px] text-destructive">{error}</p>
      ) : helperText ? (
        <p className="text-[13px] text-neutral-600">{helperText}</p>
      ) : null}
    </div>
  );
}

const fieldBaseClasses = (hasError?: boolean) =>
  cn(
    'w-full h-10 px-3.5 rounded-control border bg-white text-[15px] text-neutral-900 transition-colors',
    'placeholder:text-neutral-500',
    'disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed',
    hasError
      ? 'border-destructive focus:border-destructive'
      : 'border-neutral-300 focus:border-forest-600'
  );

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, required, wrapperClassName, className, ...props },
  ref
) {
  return (
    <FieldChrome label={label} helperText={helperText} error={error} required={required} className={wrapperClassName}>
      <input ref={ref} className={cn(fieldBaseClasses(!!error), className)} {...props} />
    </FieldChrome>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, helperText, error, required, wrapperClassName, className, ...props },
  ref
) {
  return (
    <FieldChrome label={label} helperText={helperText} error={error} required={required} className={wrapperClassName}>
      <textarea ref={ref} className={cn(fieldBaseClasses(!!error), 'h-auto min-h-[96px] py-2.5 resize-y', className)} {...props} />
    </FieldChrome>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  wrapperClassName?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, helperText, error, required, wrapperClassName, className, children, ...props },
  ref
) {
  return (
    <FieldChrome label={label} helperText={helperText} error={error} required={required} className={wrapperClassName}>
      <div className="relative">
        <select
          ref={ref}
          className={cn(fieldBaseClasses(!!error), 'appearance-none pr-9 cursor-pointer', className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown size={16} strokeWidth={1.75} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
      </div>
    </FieldChrome>
  );
});
