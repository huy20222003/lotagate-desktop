import type { LucideIcon } from 'lucide-react';

export function Icon({ icon: IconComponent, size = 16, label, ...props }: { icon: LucideIcon; size?: number; label?: string; className?: string }) {
  return <IconComponent size={size} aria-hidden={label === undefined} aria-label={label} {...props} />;
}
