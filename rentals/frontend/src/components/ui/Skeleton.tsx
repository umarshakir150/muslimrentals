import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

// Neutral shimmer block for known-shape loading content (listing grids,
// list rows, detail pages) -- the default loading pattern per the
// Milestone 1 design system. Spinner is reserved for inline
// button-loading and short indeterminate actions instead.
export default function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton-shimmer rounded-control', className)} aria-hidden="true" />;
}
