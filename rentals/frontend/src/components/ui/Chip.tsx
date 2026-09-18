import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: React.ReactNode;
}

// Interactive toggle-pill (Milestone 1 design system) -- for filter
// controls like the audience selector. `rounded-full` is intentional here:
// unlike Badge, a Chip is a genuine toggle control, not a label, so the
// pill shape is a legitimate exception to the overhaul's anti-pill
// direction. Neutral by default, single forest-tinted active state --
// never a per-option color (this generalizes ListingFilters.tsx's
// already-correct audience-pill pattern into a shared primitive).
export default function Chip({ active = false, children, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center h-[34px] px-3.5 rounded-full text-[13px] font-medium border transition-colors whitespace-nowrap',
        active
          ? 'bg-forest-600 border-forest-600 text-white'
          : 'bg-white border-neutral-300 text-neutral-900 hover:border-neutral-400',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
