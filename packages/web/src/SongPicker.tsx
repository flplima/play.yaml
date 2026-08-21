import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Music4 } from 'lucide-react';
import { EXAMPLES } from './examples';
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
 * The score picker. There are ~50 bundled scores, which is well past the size
 * where a `<select>` is usable — so this is a combobox: type to filter by file
 * name *or* by the score's `title:`, which is how anyone actually remembers
 * them ("gounod" finds ave-maria-bach-gounod).
 */
export default function SongPicker({ value, placeholder, onSelect }: SongPickerProps) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () =>
      [
        { key: 'example' as const, heading: 'Examples' },
        { key: 'song' as const, heading: 'Songs' },
      ]
        .map((g) => ({ ...g, items: EXAMPLES.filter((e) => e.group === g.key) }))
        .filter((g) => g.items.length > 0),
    [],
  );

  const selected = EXAMPLES.find((e) => e.name === value);
  const label = selected ? selected.name : (placeholder ?? 'Pick a score…');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Score"
          className="w-56 justify-between font-normal"
          title={selected?.title ?? label}
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
          // Search the title as well as the file name: `value` is the name we
          // select by, `keywords` widen what matches it.
          filter={(itemValue, search, keywords) => {
            const haystack = [itemValue, ...(keywords ?? [])].join(' ').toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search scores…" />
          <CommandList>
            <CommandEmpty>No score matches.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((example) => (
                  <CommandItem
                    key={example.name}
                    value={example.name}
                    keywords={example.title ? [example.title] : undefined}
                    onSelect={(name) => {
                      setOpen(false);
                      onSelect(name);
                    }}
                  >
                    <Check
                      className={cn(example.name === value ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="min-w-0 flex-1 truncate">{example.name}</span>
                    {example.title && example.title !== example.name && (
                      <span className="max-w-36 shrink-0 truncate text-[10px] text-muted-foreground">
                        {example.title}
                      </span>
                    )}
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
