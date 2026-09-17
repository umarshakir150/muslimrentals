import { cn } from '@/lib/utils';

export type BadgeVariant = 'neutral' | 'emphasis';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

// Non-interactive label marker (Milestone 1 design system). Deliberately
// `rounded-control` (not full/pill) so it reads as a tag rather than a
// toggle control -- Chip is the pill-shaped, interactive counterpart.
//
// This is the shared replacement for any per-category color-coded badge.
// Milestone 3 used this to fix ListingCard.tsx/ListingDetail.tsx's audience
// badge, which used to give Brothers/Sisters/Couples/Families each their
// own hue via a now-deleted lib/utils.ts helper -- explicitly what the
// overhaul's "no rainbow category colors" direction rules out. Callers
// should differentiate meaning by label text, never by badge hue.
export default function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-control px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        variant === 'neutral' && 'bg-neutral-100 text-neutral-700',
        variant === 'emphasis' && 'bg-forest-50 text-forest-700',
        className
      )}
    >
      {children}
    </span>
  );
}
