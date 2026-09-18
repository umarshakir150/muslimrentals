import { LucideIcon } from 'lucide-react';
import Button from './Button';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

// Shared empty/zero-result state (Milestone 1 design system): a plain
// neutral icon (no decorative circle behind it, per the overhaul's
// "avoid decorative pastel icon circles" direction), a headline, one line
// of body copy, and an optional single action -- centered, generously
// padded, no card border around it.
export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-16 sm:py-24 px-6">
      <Icon size={28} strokeWidth={1.75} className="text-neutral-400 mb-4" />
      <h3 className="text-lg font-semibold text-neutral-900 mb-1.5">{title}</h3>
      {description && <p className="text-[15px] text-neutral-600 max-w-sm mb-6">{description}</p>}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
