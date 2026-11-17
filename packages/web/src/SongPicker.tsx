import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Music4 } from 'lucide-react';
import { CATEGORIES, EXAMPLES, LISTED_EXAMPLES } from './examples';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

  const groups = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        items: LISTED_EXAMPLES.filter((e) => e.category === category),
      })).filter((g) => g.items.length > 0),
    [],
  );

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
        <Command
          // `value` is the file name we select by; what the user types is matched
          // against the title, the composer and the style, never the file name.
          filter={(_itemValue, search, keywords) => {
            const haystack = (keywords ?? []).join(' ').toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search scores…" />
          <CommandList>
            <CommandEmpty>No score matches.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.category} heading={group.category}>
                {group.items.map((example) => (
                  <CommandItem
                    key={example.name}
                    value={example.name}
                    keywords={[example.title ?? '', example.composer ?? '', example.category ?? '']}
                    onSelect={(name) => {
                      setOpen(false);
                      onSelect(name);
                    }}
                  >
                    <Check
                      className={cn('self-center', example.name === value ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{example.title ?? example.name}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{example.composer}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
