import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names the shadcn way: `clsx` flattens conditionals, then
 * `tailwind-merge` resolves conflicts so a caller's `px-4` beats a
 * component's own `px-2` instead of both landing in the class list.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
