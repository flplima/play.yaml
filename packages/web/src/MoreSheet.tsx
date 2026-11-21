import type { ReactNode } from 'react';
import { FolderOpen, Link2, Save } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: () => void;
  /** Where Open looks: iOS names its own places. */
  openHint: string;
  /** The opened file, when there is one: Save writes it back or downloads it. */
  file: { name: string; dirty: boolean; inPlace: boolean } | null;
  onSave: () => void;
  hasSong: boolean;
  hasText: boolean;
  rendering: boolean;
  makingPdf: boolean;
  onMidi: () => void;
  onMp3: () => void;
  onPdf: () => void;
  onYaml: () => void;
  onShare: () => void;
}

const row =
  'flex min-h-14 w-full items-center gap-3 px-3.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-40 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-foreground/80';

function Label({ title, hint }: { title: ReactNode; hint: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate">{title}</span>
      <span className="truncate text-xs text-muted-foreground">{hint}</span>
    </span>
  );
}

/** Everything the desktop header holds that a phone's top row has no room for. */
export default function MoreSheet(p: Props) {
  // Each action closes the sheet, so its status line ("Rendering MP3…") shows.
  const run = (action: () => void) => () => {
    p.onOpenChange(false);
    action();
  };
  const downloads = [
    { label: 'MIDI', hint: '.mid, instant', disabled: !p.hasSong, go: p.onMidi },
    { label: 'MP3', hint: p.rendering ? 'rendering…' : 'rendered here', disabled: !p.hasSong || p.rendering, go: p.onMp3 },
    { label: 'PDF', hint: p.makingPdf ? 'engraving…' : 'sheet music', disabled: !p.hasSong || p.makingPdf, go: p.onPdf },
    { label: 'play.yaml', hint: 'the score itself', disabled: !p.hasText, go: p.onYaml },
  ];

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent
        title={
          <>
            play<span className="text-primary">.yaml</span>
          </>
        }
        description="Make some music with YAML"
      >
        <div className="flex flex-col gap-3.5 px-4 pt-1 pb-6">
          <div className="flex flex-col overflow-hidden rounded-xl bg-card">
            <button type="button" className={row} onClick={run(p.onOpenFile)}>
              <FolderOpen />
              <Label title="Open a .play.yaml file" hint={p.openHint} />
            </button>
            {p.file && (
              <button
                type="button"
                className={`${row} border-t border-secondary`}
                onClick={run(p.onSave)}
                disabled={p.file.inPlace && !p.file.dirty}
              >
                <Save />
                <Label
                  title={`Save ${p.file.name}`}
                  hint={p.file.inPlace ? (p.file.dirty ? 'back to the file' : 'no changes yet') : 'as a download'}
                />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="pl-1 text-xs text-muted-foreground">Download</span>
            <div className="grid grid-cols-2 gap-2">
              {downloads.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  disabled={d.disabled}
                  onClick={run(d.go)}
                  className="flex h-16 flex-col items-start justify-center gap-0.5 rounded-xl bg-card px-3.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <span>{d.label}</span>
                  <span className="text-xs text-muted-foreground">{d.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl bg-card">
            <button type="button" className={row} onClick={run(p.onShare)} disabled={!p.hasText}>
              <Link2 />
              <Label title="Share a link" hint="the whole score goes in the link" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
