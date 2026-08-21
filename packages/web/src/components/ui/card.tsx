import * as React from 'react';
import { cn } from '@/lib/utils';

/** A bordered surface, one shade up from the panel it sits on. */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-background/60 p-3', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export { Card };
