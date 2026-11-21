import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;

interface SheetContentProps extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The scrolling area under the title. */
  bodyClassName?: string;
}

/**
 * A bottom sheet: what a side panel or a menu becomes on a phone. It slides up
 * over the dimmed studio, closes on the scrim, Escape or its X, and keeps
 * focus inside while it is open (Radix Dialog does that part).
 */
const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ className, bodyClassName, title, description, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-fade fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        ref={ref}
        // Radix warns about a dialog with no description unless told there is none.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'animate-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-3.5rem)] flex-col rounded-t-2xl border-t border-border bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-foreground shadow-2xl outline-none',
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="flex h-5 shrink-0 items-center justify-center">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 pr-2 pb-2 pl-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs text-muted-foreground">{description}</DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName)}>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
SheetContent.displayName = 'SheetContent';

export { Sheet, SheetContent };
