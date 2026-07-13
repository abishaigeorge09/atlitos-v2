import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind/nativewind className strings, last one wins on conflicts.
 * Standard shadcn/react-native-reusables `cn` helper, used by every
 * className based UI primitive in src/components/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
