import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

// Bordered container primitive (Milestone 1 design system) -- the one
// sanctioned "card" pattern going forward. Use this only when (a) a
// boundary is genuinely needed to disambiguate a group (a form section, a
// settings panel), or (b) it's an independently-clickable grid item.
// Otherwise prefer plain whitespace + a heading + a border-t divider
// between sections -- see components/legal/PolicyLayout.tsx for the
// existing model of that pattern. Overusing this component is exactly the
// "cards-inside-cards" pattern the overhaul is moving away from.
export default function Surface({ hoverable = false, className, children, ...props }: SurfaceProps) {
  return (
    <div
      className={cn(
        'bg-white border border-neutral-200 rounded-surface p-5 sm:p-6',
        hoverable && 'transition-shadow hover:shadow-elevation1',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
