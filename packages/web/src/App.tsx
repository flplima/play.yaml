import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import type { EditorView } from '@codemirror/view';
import { parseYaml, compileDoc, CompiledSong, encodeMidi } from '@play.yaml/core';
import {
  ChevronDown,
  CircleX,
  Download,
  FileMusic,
  FileText,
  FolderOpen,
  Music,
  Link2,
  PanelRight,
  Play,
  Save,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { DEFAULT_CONTENT, DEFAULT_EXAMPLE, EXAMPLES, LISTED_EXAMPLES, loadExample } from './examples';
import SongPicker from './SongPicker';
import PianoRoll from './PianoRoll';
import HarmonyView from './HarmonyView';
import ScoreView from './ScoreView';
import OutputPanel, { OutputMode } from './OutputPanel';
import RoutingPanel, { SampleEntry } from './RoutingPanel';
import TrackMonitor from './TrackMonitor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { playSong, PlaybackHandle } from './player';
import { loadRoutes, routeKey, saveRoutes, MidiRoute, RouteMap } from './routes';
import { encodeMp3, renderSong } from './render';
import { renderScore, scoreXml } from './score';
import { buildNoteSpans, NoteSpan } from './noteSpans';
import { playingNoteExtension, setPlayhead, setPlayingNotes } from './highlight';
import { PageTurner } from './pageTurn';
import FollowButton from './FollowButton';
import { leadTrack } from './chords';
import { gruvboxEditorTheme } from './editorTheme';
import { useMidi } from './useMidi';
import { clearShareHash, decodeShareHash, encodeShareHash, isShareHash } from './share';
import { usePersisted } from './storage';

type Source =
  | { kind: 'example'; name: string }
  | { kind: 'file'; name: string; handle: FileSystemFileHandle }
  | { kind: 'shared' };

function compile(text: string): { song: CompiledSong | null; error: string | null } {
  try {
    return { song: compileDoc(parseYaml(text)), error: null };
  } catch (err) {
    return { song: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Offer a blob as a download. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // A large file (a PDF of a long score) is still being read when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** lucide-react dropped brand icons, so the GitHub mark is inline. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const canOpenFiles = 'showOpenFilePicker' in window;

/**
 * The toolbar is a row of small icon-ish controls, so every one of them needs
 * its explanation somewhere. `title` used to carry it; a tooltip reads the same
 * but is styled with the rest and shows up on keyboard focus too.
 */
function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function App() {
  // The last selected example survives reloads. (Opened files can't — the
  // File System Access handle doesn't fit in localStorage.)
  const [exampleName, setExampleName] = usePersisted('example', DEFAULT_EXAMPLE?.name ?? '', String);
  // A stored pointer to a score the picker no longer lists falls back to the default.
  const firstExample = LISTED_EXAMPLES.find((e) => e.name === exampleName) ?? DEFAULT_EXAMPLE;
  const [source, setSource] = useState<Source>({ kind: 'example', name: firstExample?.name ?? '' });
  // The default score's text is in the main chunk; any other stored score is
  // fetched right after the first paint (see the effect below).
  const [text, setText] = useState(firstExample === DEFAULT_EXAMPLE ? DEFAULT_CONTENT : '');
  useEffect(() => {
    if (!firstExample || firstExample === DEFAULT_EXAMPLE) return;
    let live = true;
    loadExample(firstExample.name)
      .then((content) => {
        if (live && content != null) setText((now) => (now === '' ? content : now));
      })
      .catch(() => setStatus(`Could not load ${firstExample.title ?? firstExample.name}`));
    return () => {
      live = false;
    };
    // Once, for the score the page opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // A status line is news, not state: it clears itself after a few seconds.
  // A running job ("Rendering MP3...") waits for the status that replaces it,
  // and a failure stays until the next action.
  useEffect(() => {
    if (!status || status.endsWith('…') || /^Could not|failed/i.test(status)) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [makingPdf, setMakingPdf] = useState(false);
  const [loop, setLoop] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [mainTab, setMainTab] = useState<'editor' | 'roll' | 'score' | 'harmony'>('editor');
  const [currentBeat, setCurrentBeat] = useState(0);
  // The player polls this ref every beat, so toggling works mid-playback.
  const metronomeRef = useRef(false);

  // In-session edits to examples survive switching between them, but are never
  // written anywhere.
  const exampleEdits = useRef(new Map<string, string>());
  const playback = useRef<PlaybackHandle | null>(null);
  const editorView = useRef<EditorView | null>(null);
  // The editor turns its pages with the playback until you scroll it yourself.
  const pageTurner = useRef<PageTurner | null>(null);
  const [editorFollowing, setEditorFollowing] = useState(true);
  const followEditor = () => {
    pageTurner.current?.resume();
    setEditorFollowing(true);
  };
  const noteSpans = useRef<NoteSpan[]>([]);
  const highlightRaf = useRef(0);

  const [routes, setRoutes] = useState<RouteMap>(loadRoutes);
  const [outputMode, setOutputMode] = usePersisted<OutputMode>('output-mode', 'builtin', (raw) =>
    raw === 'midi' ? 'midi' : 'builtin',
  );
  const midi = useMidi(outputMode === 'midi');
  const [masterVolume, setMasterVolume] = usePersisted('master-volume', 80, Number);

  const handleVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(100, vol));
    setMasterVolume(clamped);
    playback.current?.setVolume(clamped / 100);
  };

  const { song, error } = useMemo(() => compile(text), [text]);
  // The side panel keeps showing the last score that compiled while an edit is mid-way.
  const [lastGoodSong, setLastGoodSong] = useState<CompiledSong | null>(null);
  useEffect(() => {
    if (song) setLastGoodSong(song);
  }, [song]);

  const samples = useMemo<SampleEntry[]>(() => {
    const byName = new Map<string, SampleEntry>();
    for (const track of lastGoodSong?.tracks ?? []) {
      const name = routeKey(track);
      if (!byName.has(name)) byName.set(name, { name, defaultChannel: track.channel });
    }
    return [...byName.values()];
  }, [lastGoodSong]);

  /** Forget a playback: whether it ended on its own or was stopped. */
  const releasePlayback = useCallback(() => {
    playback.current = null;
    cancelAnimationFrame(highlightRaf.current);
    editorView.current?.dispatch({ effects: setPlayingNotes.of([]) });
    setPlaying(false);
    setCurrentBeat(0);
  }, []);

  const stop = useCallback(() => {
    playback.current?.stop();
    releasePlayback();
  }, [releasePlayback]);

  // A remount (Fast Refresh) must not leave the transport running with no handle.
  useEffect(() => () => playback.current?.stop(), []);

  const handleEdit = (value: string) => {
    setText(value);
    if (source.kind === 'example') exampleEdits.current.set(source.name, value);
    else if (source.kind === 'file') setDirty(true);
    clearShareHash(); // an edited score no longer matches the link in the address bar
    // Re-anchor highlights to the edited text so they stay accurate mid-playback.
    if (playback.current) noteSpans.current = buildNoteSpans(value);
  };

  // Hot-swap: while playing, an edit that compiles cleanly splices into the
  // running transport at an upcoming bar boundary — no Stop→Play. Debounced
  // so a burst of keystrokes schedules one splice.
  const liveSong = useRef<CompiledSong | null>(null);
  useEffect(() => {
    const handle = playback.current;
    if (!handle || !song || song === liveSong.current) return;
    const timer = window.setTimeout(() => {
      if (playback.current !== handle) return;
      liveSong.current = song;
      void handle.update(song).then((bar) => {
        if (bar != null && playback.current === handle) setStatus(`↻ live update from bar ${bar}`);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [song]);

  const selectExample = async (name: string) => {
    stop();
    const example = EXAMPLES.find((e) => e.name === name);
    if (!example) return;
    // A score never opened online is not in the offline cache: say so, don't throw.
    const content = exampleEdits.current.get(name) ?? (await loadExample(name).catch(() => undefined));
    if (content == null) {
      setStatus(`Could not load ${example.title ?? name}`);
      return;
    }
    clearShareHash();
    setExampleName(name);
    setSource({ kind: 'example', name });
    setText(content);
    setDirty(false);
    setStatus(null);
  };

  // A share link carries the whole score in its hash — load it on arrival
  // (initial visit or a hash pasted into the running tab).
  useEffect(() => {
    const loadFromHash = async () => {
      if (!isShareHash()) return;
      try {
        const shared = await decodeShareHash(location.hash);
        if (shared == null) return;
        stop();
        setSource({ kind: 'shared' });
        setText(shared);
        setDirty(false);
        setStatus('Loaded score from share link');
      } catch {
        setStatus('Could not read the share link — it may be truncated');
      }
    };
    void loadFromHash();
    const onHashChange = () => void loadFromHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [stop]);

  const shareLink = async () => {
    const hash = await encodeShareHash(text);
    const url = `${location.origin}${location.pathname}${hash}`;
    history.replaceState(null, '', hash);
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`Share link copied (${url.length.toLocaleString()} chars)`);
    } catch {
      setStatus('Share link is in the address bar (clipboard unavailable)');
    }
  };

  const openFile = async () => {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'play.yaml score', accept: { 'application/yaml': ['.yaml', '.yml'] } }],
      });
      const file = await handle.getFile();
      const content = await file.text();
      stop();
      clearShareHash();
      setSource({ kind: 'file', name: file.name, handle });
      setText(content);
      setDirty(false);
      setStatus(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // picker dismissed
      setStatus(`Could not open file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveFile = useCallback(async () => {
    if (source.kind !== 'file') return;
    try {
      const writable = await source.handle.createWritable();
      await writable.write(text);
      await writable.close();
      setDirty(false);
      setStatus(`Saved ${source.name}`);
    } catch (err) {
      setStatus(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [source, text]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveFile]);

  const play = async () => {
    if (!song) return;
    stop();

    const outputById = new Map(midi.outputs.map((o) => [o.id, o]));
    // Built-in mode parks the MIDI routes: everything renders in the browser.
    let handle: PlaybackHandle;
    try {
      handle = await playSong(song, outputMode === 'midi' ? routes : {}, outputById, {
        loop,
        volume: masterVolume / 100,
        metronome: () => metronomeRef.current,
        onOrchestraFallback: (names) =>
          setStatus(
            `Orchestra samples not found — ${names.join(', ')} on synth presets. ` +
              'Install the Virtual Playing Orchestra to hear them sampled (see README).',
          ),
      });
    } catch (err) {
      setStatus(`Could not start playback: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    playback.current = handle;
    setPlaying(true);
    followEditor();
    const lead = leadTrack(song);

    // Strudel-style highlighting: an rAF loop reads the transport's beat
    // position and lights up the beat tokens currently sounding.
    noteSpans.current = buildNoteSpans(text);
    let lastKey = '';
    let lastBeatValue = -1;
    // The piano roll reaches the screen a frame after this read (React renders,
    // then draws), so the clock leads by one frame more: 8 ms at 120 Hz, 33 ms
    // on a phone that manages 30 fps.
    let lastFrameAt = 0;
    let frameSec = 1 / 60;
    const tick = (now: number) => {
      if (playback.current !== handle) return;
      if (lastFrameAt) frameSec += (Math.min(0.1, (now - lastFrameAt) / 1000) - frameSec) * 0.1;
      lastFrameAt = now;
      const beat = handle.getPositionBeats(frameSec);
      // Every frame the beat moves. A 0.02-beat threshold skipped every other
      // frame at 72 bpm and slower, and the piano keys lagged behind.
      if (beat !== lastBeatValue) {
        lastBeatValue = beat;
        setCurrentBeat(beat);
      }
      const active = noteSpans.current.filter((s) => beat >= s.startBeat && beat < s.endBeat);
      const key = active.map((s) => `${s.kind}:${s.from}-${s.to}`).join(',');
      if (key !== lastKey) {
        lastKey = key;
        editorView.current?.dispatch({
          effects: setPlayingNotes.of(active.map(({ from, to, kind, startBeat, endBeat }) => ({ from, to, kind, startBeat, endBeat }))),
        });
      }
      if (editorView.current) setPlayhead(editorView.current, beat);
      pageTurner.current?.frame(
        active.filter((s) => s.kind === 'note').map((s) => ({ from: s.from, to: s.to, lead: s.track === lead })),
        now,
      );
      highlightRaf.current = requestAnimationFrame(tick);
    };
    highlightRaf.current = requestAnimationFrame(tick);

    void handle.done.then(() => {
      if (playback.current === handle) releasePlayback();
    });
  };

  const downloadSlug = () => {
    const raw =
      song?.title ??
      (source.kind === 'example'
        ? source.name
        : source.kind === 'file'
          ? source.name.replace(/(?:\.play)?\.ya?ml$/i, '')
          : 'song');
    return raw.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
  };

  const downloadMid = () => {
    if (!song) return;
    try {
      const bytes = encodeMidi(song);
      const name = `${downloadSlug()}.mid`;
      download(new Blob([bytes as BlobPart], { type: 'audio/midi' }), name);
      setStatus(`Downloaded ${name} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
    } catch (err) {
      setStatus(`MIDI export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const downloadYaml = () => {
    const name = `${downloadSlug()}.play.yaml`;
    download(new Blob([text], { type: 'text/yaml' }), name);
    setStatus(`Downloaded ${name}`);
  };

  const downloadMp3 = async () => {
    if (!song || rendering) return;
    setRendering(true);
    setStatus('Rendering MP3…');
    try {
      const blob = await encodeMp3(await renderSong(song));
      download(blob, `${downloadSlug()}.mp3`);
      setStatus(`Rendered ${(blob.size / 1e6).toFixed(1)} MB MP3`);
    } catch (err) {
      setStatus(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRendering(false);
    }
  };

  const downloadPdf = async () => {
    if (!song || makingPdf) return;
    setMakingPdf(true);
    setStatus('Engraving PDF…');
    try {
      // Engraved afresh rather than read from the Score tab, so this works
      // when that tab was never opened. Both libraries load on first use.
      const { xml } = scoreXml(text);
      const { pages } = await renderScore(xml);
      const { scorePdf } = await import('./pdf');
      const blob = await scorePdf(pages, song.title);
      download(blob, `${downloadSlug()}.pdf`);
      setStatus(`Engraved a ${pages.length}-page PDF (${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (err) {
      setStatus(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMakingPdf(false);
    }
  };

  const handleRouteChange = (preset: string, route: MidiRoute | undefined) => {
    setRoutes((prev) => {
      const next = { ...prev };
      if (route) next[preset] = route;
      else delete next[preset];
      saveRoutes(next);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">
          <button
            type="button"
            aria-label={playing ? 'Stop' : 'Play'}
            onClick={playing ? stop : () => void play()}
            disabled={!playing && !song}
            className="cursor-pointer rounded-sm px-1 -mx-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
          >
            play<span className="text-primary">.yaml</span>
          </button>
        </h1>

        <Separator orientation="vertical" className="mx-1" />

        <SongPicker
          value={source.kind === 'example' ? source.name : ''}
          placeholder={source.kind === 'shared' ? '— shared link —' : undefined}
          onSelect={selectExample}
        />

        <Hint label={canOpenFiles ? 'Open a .play.yaml file from disk' : 'File System Access API not supported in this browser'}>
          <Button onClick={openFile} disabled={!canOpenFiles}>
            <FolderOpen />
            Open…
          </Button>
        </Hint>

        {source.kind === 'file' && (
          <>
            <span className="max-w-48 truncate text-xs text-muted-foreground" title={source.name}>
              {source.name}
              {dirty && <span className="ml-1 text-warning">●</span>}
            </span>
            <Hint label="Save to the opened file (Ctrl+S)">
              <Button onClick={() => void saveFile()} disabled={!dirty}>
                <Save />
                Save
              </Button>
            </Hint>
          </>
        )}

        <div className="flex-1" />

        <Button
          variant={playing ? 'destructive' : 'default'}
          size="lg"
          className="font-semibold"
          onClick={playing ? stop : () => void play()}
          disabled={!playing && !song}
        >
          {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
          {playing ? 'Stop' : 'Play'}
        </Button>

        <DropdownMenu>
          <Hint label="Download this score as MIDI, MP3, a PDF of the sheet music or the play.yaml text">
            <DropdownMenuTrigger asChild>
              <Button disabled={!text} aria-label="Download">
                <Download />
                {rendering ? 'Rendering…' : makingPdf ? 'Engraving…' : 'Download'}
                <ChevronDown className="opacity-50" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!song} onSelect={downloadMid}>
              <Music />
              MIDI (.mid)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!song || rendering} onSelect={() => void downloadMp3()}>
              <FileMusic />
              {rendering ? 'Rendering MP3…' : 'MP3'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!song || makingPdf} onSelect={() => void downloadPdf()}>
              <FileText />
              {makingPdf ? 'Engraving PDF…' : 'PDF (sheet music)'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!text} onSelect={downloadYaml}>
              <FileText />
              play.yaml
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Hint label="Copy a link that carries this whole score in the URL — no server involved">
          <Button onClick={() => void shareLink()} disabled={!text}>
            <Link2 />
            Share
          </Button>
        </Hint>

        <Hint label="The source, the docs and the format reference">
          <Button asChild variant="ghost">
            <a href="https://github.com/flplima/play.yaml" target="_blank" rel="noreferrer">
              <GithubMark />
              GitHub
            </a>
          </Button>
        </Hint>

        <Hint label={showPanel ? 'Hide the side panel' : 'Show the side panel'}>
          <Button
            size="icon"
            variant={showPanel ? 'secondary' : 'ghost'}
            aria-pressed={showPanel}
            onClick={() => setShowPanel((v) => !v)}
          >
            <PanelRight />
          </Button>
        </Hint>

      </header>

      <main className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1">
        <Tabs
          value={mainTab}
          onValueChange={(v) => setMainTab(v as typeof mainTab)}
          className="min-w-0 flex-1 gap-0 overflow-hidden"
        >
          {/*
            Four views of the same score. The editor is what it says; the roll
            is what it does; the score is how a musician would read it; the
            harmony tab is the chords under it. All stay mounted (forceMount):
            CodeMirror is expensive to rebuild and would lose its scroll and
            selection, and the canvases are cheap to leave sitting there, so
            the inactive ones are hidden with CSS rather than unmounted.
          */}
          <TabsList
            variant="line"
            aria-label="Main view"
            className="h-auto w-full shrink-0 justify-start gap-0 rounded-none border-b border-border bg-card p-0"
          >
            {([['editor', 'Editor'], ['roll', 'Piano roll'], ['score', 'Score'], ['harmony', 'Harmony']] as const).map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-auto flex-none rounded-none px-4 py-1.5 text-xs group-data-[orientation=horizontal]/tabs:after:bottom-0 after:bg-primary data-[state=active]:text-foreground"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="editor" forceMount className="relative min-h-0 overflow-hidden data-[state=inactive]:hidden">
            {playing && !editorFollowing && <FollowButton onClick={followEditor} />}
            <CodeMirror
              value={text}
              onChange={handleEdit}
              onCreateEditor={(view) => {
                editorView.current = view;
                pageTurner.current?.destroy();
                pageTurner.current = new PageTurner(view, () => setEditorFollowing(false));
              }}
              theme={gruvboxEditorTheme}
              height="100%"
              style={{ height: '100%' }}
              extensions={[yaml(), playingNoteExtension]}
            />
          </TabsContent>
          <TabsContent value="roll" forceMount className="min-h-0 data-[state=inactive]:hidden">
            <PianoRoll song={song} currentBeat={currentBeat} />
          </TabsContent>
          <TabsContent value="harmony" forceMount className="min-h-0 data-[state=inactive]:hidden">
            <HarmonyView song={song} currentBeat={currentBeat} />
          </TabsContent>
          <TabsContent value="score" forceMount className="min-h-0 data-[state=inactive]:hidden">
            <ScoreView text={text} visible={mainTab === 'score'} playing={playing} currentBeat={currentBeat} />
          </TabsContent>
        </Tabs>

        {/* Compile errors, warnings and the last action's status, only when there is one. */}
        {(error || song?.warnings?.length || status) && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col items-start gap-1.5">
            {error && (
              <Alert variant="destructive" className="pointer-events-auto max-h-32 w-auto max-w-full overflow-auto py-2 text-xs">
                <CircleX />
                <AlertDescription className="text-xs text-destructive">{error}</AlertDescription>
              </Alert>
            )}
            {/* A score with unreadable tokens still plays: they just went silent.
                Say which bar, so a mistyped mark is visible instead of just heard. */}
            {!error && song?.warnings?.length ? (
              <Alert
                className="pointer-events-auto w-auto max-w-full py-2 text-xs text-warning"
                title={song.warnings.join('\n')}
              >
                <TriangleAlert />
                <AlertDescription className="text-xs text-warning">
                  {song.warnings[0]}
                  {song.warnings.length > 1 ? ` (+${song.warnings.length - 1} more)` : ''}
                </AlertDescription>
              </Alert>
            ) : null}
            {status && (
              <span className="pointer-events-auto max-w-full truncate rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                {status}
              </span>
            )}
          </div>
        )}
        </div>
        {/*
          The side panel stays mounted and animates its width: the fixed-width
          inner column slides while the outer one shrinks, so nothing reflows
          inside it. The canvases' ResizeObservers redraw as the main area
          resizes, and once more at the final size.
        */}
        <div
          className={cn(
            'shrink-0 overflow-hidden border-l border-border bg-card transition-[width,border-color,visibility] duration-200 ease-in-out motion-reduce:transition-none',
            showPanel ? 'w-80' : 'invisible w-0 border-transparent',
          )}
        >
          <aside
            className={cn(
              'flex h-full w-80 flex-col overflow-y-auto transition-transform duration-200 ease-in-out motion-reduce:transition-none',
              showPanel ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <OutputPanel
              outputMode={outputMode}
              onOutputModeChange={setOutputMode}
              masterVolume={masterVolume}
              onVolumeChange={handleVolumeChange}
              loop={loop}
              onLoopChange={setLoop}
              metronome={metronome}
              onMetronomeChange={(v) => {
                metronomeRef.current = v;
                setMetronome(v);
              }}
            />
            <RoutingPanel
              samples={samples}
              midi={midi}
              routes={routes}
              onRouteChange={handleRouteChange}
              disabled={outputMode === 'builtin'}
            />
            <TrackMonitor song={lastGoodSong} currentBeat={currentBeat} playing={playing} />
          </aside>
        </div>
      </main>

    </div>
    </TooltipProvider>
  );
}
