import { clsx, type ClassValue } from 'clsx';

/** Combines conditional class names for shared component props. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
