import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Icon or emoji block rendered above the title. */
  visual?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ visual, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('text-center py-20 px-4', className)} role="status">
      {visual}
      <h3 className="font-serif text-2xl mb-2">{title}</h3>
      {description && <p className="text-muted mb-6 max-w-sm mx-auto">{description}</p>}
      {action}
    </div>
  );
}
