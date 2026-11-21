import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Music4 } from 'lucide-react';
import { CATEGORIES, EXAMPLES, LISTED_EXAMPLES } from './examples';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface SongPickerProps {
  /** The selected score's name, or '' when the editor holds a file / share link. */
  value: string;
  /** What to show when nothing in the list is selected (e.g. an opened filename). */
  placeholder?: string;
  onSelect: (name: string) => void;
}

/**
 * The score picker: a combobox grouped by style, each piece a title over its
 * composer. Type to filter by title, composer or style ("gounod" finds the
 * Ave Maria). File names are not shown anywhere.
 */
export default function SongPicker({ value, placeholder, onSelect }: SongPickerProps) {
  const [open, setOpen] = useState(false);

  // A score opened by name that the picker does not list (a stored pointer) still shows its title.
  const selected = EXAMPLES.find((e) => e.name === value);
  const label = selected ? (selected.title ?? selected.name) : (placeholder ?? 'Pick a score…');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Score"
          className="w-72 justify-between font-normal"
          title={label}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Music4 className="text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <SongList
          value={value}
          onSelect={(name) => {
            setOpen(false);
            onSelect(name);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface SongSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (name: string) => void;
}

/** The same list on a phone: a tall sheet, rows big enough for a thumb. */
export function SongSheet({ open, onOpenChange, value, onSelect }: SongSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Scores"
        className="h-[calc(100dvh-3.5rem)]"
        bodyClassName="flex flex-col overflow-hidden"
        // The search field would pop the keyboard over the list: focus stays on the sheet.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SongList
          touch
          value={value}
          onSelect={(name) => {
            onOpenChange(false);
            onSelect(name);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function SongList({ value, onSelect, touch = false }: { value: string; onSelect: (name: string) => void; touch?: boolean }) {
  const groups = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        items: LISTED_EXAMPLES.filter((e) => e.category === category),
      })).filter((g) => g.items.length > 0),
    [],
  );

  return (
    <Command
      className={cn(touch && 'min-h-0 flex-1 rounded-none bg-transparent')}
      // `value` is the file name we select by; what the user types is matched
      // against the title, the composer and the style, never the file name.
      filter={(_itemValue, search, keywords) => {
        const haystack = (keywords ?? []).join(' ').toLowerCase();
        return haystack.includes(search.toLowerCase()) ? 1 : 0;
      }}
    >
      {/* 16 px on a phone: iOS zooms into any smaller field that takes focus. */}
      <CommandInput placeholder="Search title or composer" className={cn(touch && 'h-11 text-base')} />
      <CommandList className={cn(touch && 'max-h-none min-h-0 flex-1 overscroll-contain px-2 pb-4')}>
        <CommandEmpty>No score matches.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.category} heading={group.category}>
            {group.items.map((example) => (
              <CommandItem
                key={example.name}
                value={example.name}
                keywords={[example.title ?? '', example.composer ?? '', example.category ?? '']}
                onSelect={onSelect}
                className={cn(
                  touch &&
                    'min-h-13 gap-3 rounded-lg px-3 text-sm data-[selected=true]:bg-transparent [&_svg]:size-4',
                  touch && example.name === value && 'bg-primary/10 data-[selected=true]:bg-primary/10',
                )}
              >
                <Check className={cn('self-center', example.name === value ? 'opacity-100' : 'opacity-0')} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{example.title ?? example.name}</span>
                  <span className={cn('truncate text-muted-foreground', touch ? 'text-xs' : 'text-[10px]')}>
                    {example.composer}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
