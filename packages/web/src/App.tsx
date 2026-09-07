import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import type { EditorView } from '@codemirror/view';
import { parseYaml, compileDoc, CompiledSong } from '@play.yaml/core';
import {
  CircleCheck,
  CircleX,
  Download,
  FolderOpen,
  Link2,
  PanelRight,
  Play,
  Save,
  SlidersHorizontal,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { EXAMPLES } from './examples';
import SongPicker from './SongPicker';
import PianoRoll from './PianoRoll';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { playSong, routeKey, PlaybackHandle, RouteMap, MidiRoute } from './player';
import { encodeMp3, renderSong } from './render';
import { buildNoteSpans, NoteSpan } from './noteSpans';
import { playingNoteExtension, setPlayingNotes } from './highlight';
import { useMidi } from './useMidi';
import { useRack, useRackReadiness, type RackSnapshot } from './useRack';
import { isRackOutput } from './rack';
import { suggestRackChannel } from '@play.yaml/core';
import MidiPanel, { SampleEntry } from './MidiPanel';
import InstrumentPanel from './InstrumentPanel';
import { clearShareHash, decodeShareHash, encodeShareHash, isShareHash } from './share';

type Source =
  | { kind: 'example'; name: string }
  | { kind: 'file'; name: string; handle: FileSystemFileHandle }
  | { kind: 'shared' };

const ROUTES_STORAGE_KEY = 'play.yaml:midi-routes';
const OUTPUT_STORAGE_KEY = 'play.yaml:output-mode';
const EXAMPLE_STORAGE_KEY = 'play.yaml:example';
const MASTER_VOLUME_STORAGE_KEY = 'play.yaml:master-volume';

/** Where playback goes: the bundled sampler/synth, or the WebMIDI routes. */
type OutputMode = 'builtin' | 'midi';

function loadRoutes(): RouteMap {
  try {
    return JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function loadOutputMode(): OutputMode {
  return localStorage.getItem(OUTPUT_STORAGE_KEY) === 'midi' ? 'midi' : 'builtin';
}

function compile(text: string): { song: CompiledSong | null; error: string | null } {
  try {
    return { song: compileDoc(parseYaml(text)), error: null };
  } catch (err) {
    return { song: null, error: err instanceof Error ? err.message : String(err) };
  }
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
  const firstExample =
    EXAMPLES.find((e) => e.name === localStorage.getItem(EXAMPLE_STORAGE_KEY)) ?? EXAMPLES[0];
  const [source, setSource] = useState<Source>({ kind: 'example', name: firstExample?.name ?? '' });
  const [text, setText] = useState(firstExample?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [loop, setLoop] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [mainTab, setMainTab] = useState<'editor' | 'roll'>('editor');
  const [showInstruments, setShowInstruments] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  /** Rack channels Play is waiting on before the transport starts. */
  const [warmingChannels, setWarmingChannels] = useState<number[]>([]);
  // The player polls this ref every beat, so toggling works mid-playback.
  const metronomeRef = useRef(false);

  // In-session edits to examples survive switching between them, but are never
  // written anywhere.
  const exampleEdits = useRef(new Map<string, string>());
  const playback = useRef<PlaybackHandle | null>(null);
  const editorView = useRef<EditorView | null>(null);
  const noteSpans = useRef<NoteSpan[]>([]);
  const highlightRaf = useRef(0);

  const midi = useMidi();
  // The rack as this browser sees it: the published channel map, and the
  // readiness reports arriving on this browser's own MIDI input.
  const rack = useRack();
  const readiness = useRackReadiness(midi, rack.through);
  const [routes, setRoutes] = useState<RouteMap>(loadRoutes);
  const [outputMode, setOutputMode] = useState<OutputMode>(loadOutputMode);

  // Master volume state (0 - 100)
  const [masterVolume, setMasterVolume] = useState<number>(() => {
    const saved = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    return saved != null ? Number(saved) : 80;
  });

  const handleVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(100, vol));
    setMasterVolume(clamped);
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, String(clamped));
    playback.current?.setVolume(clamped / 100);
  };

  const selectOutputMode = (mode: OutputMode) => {
    setOutputMode(mode);
    localStorage.setItem(OUTPUT_STORAGE_KEY, mode);
  };

  const { song, error } = useMemo(() => compile(text), [text]);
  const [lastGoodSong, setLastGoodSong] = useState<CompiledSong | null>(null);
  useEffect(() => {
    if (song) setLastGoodSong(song);
  }, [song]);

  // Routing is per sample (the DSL's instrument name), not per track — several
  // tracks can share one instrument, and that is what a MIDI device stands in for.
  const samples = useMemo<SampleEntry[]>(() => {
    const byName = new Map<string, SampleEntry>();
    for (const track of lastGoodSong?.tracks ?? []) {
      const name = routeKey(track);
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          defaultChannel: track.channel || 1,
          rackChannel: suggestRackChannel(track, rack.channels),
        });
      }
    }
    return [...byName.values()];
  }, [lastGoodSong, rack.channels]);

  const rackView = useMemo<RackSnapshot>(() => {
    return {
      available: Boolean(rack.rack),
      through: rack.through,
      warming: warmingChannels,
      channels: [...rack.channels.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([channel, instrument]) => ({
          channel,
          name: instrument.name,
          format: instrument.format,
          loaded: instrument.loaded,
          ready: readiness.ready.get(channel) ?? (instrument.loaded ? null : false),
        })),
    };
  }, [rack.rack, rack.through, rack.channels, readiness.ready, readiness.version, warmingChannels]);

  const isRackPort = useCallback(
    (outputId: string) => {
      const output = midi.outputs.find((o) => o.id === outputId);
      return Boolean(output && isRackOutput(output, rack.through));
    },
    [midi.outputs, rack.through],
  );

  const stop = useCallback(() => {
    playback.current?.stop();
    playback.current = null;
    cancelAnimationFrame(highlightRaf.current);
    editorView.current?.dispatch({ effects: setPlayingNotes.of([]) });
    setPlaying(false);
    setCurrentBeat(0);
  }, []);

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

  const selectExample = (name: string) => {
    stop();
    const example = EXAMPLES.find((e) => e.name === name);
    if (!example) return;
    clearShareHash();
    localStorage.setItem(EXAMPLE_STORAGE_KEY, name);
    setSource({ kind: 'example', name });
    setText(exampleEdits.current.get(name) ?? example.content);
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
        types: [
          {
            description: 'play.yaml score',
            accept: { 'application/yaml': ['.yaml', '.yml'] },
          },
        ],
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
        metronome: () => metronomeRef.current,
        rack: outputMode === 'midi' && rack.through
          ? {
              through: rack.through,
              inputs: midi.inputs,
              ready: readiness.ready,
              onWarming: ({ pending }) => {
                setWarmingChannels(pending);
                setStatus(pending.length ? `Warming rack channel${pending.length > 1 ? 's' : ''} ${pending.join(', ')}…` : null);
              },
            }
          : undefined,
      });
    } finally {
      setWarmingChannels([]);
    }
    playback.current = handle;
    setPlaying(true);

    // Strudel-style highlighting: an rAF loop reads the transport's beat
    // position and lights up the beat tokens currently sounding.
    noteSpans.current = buildNoteSpans(text);
    let lastKey = '';
    let lastBeatValue = -1;
    const tick = () => {
      if (playback.current !== handle) return;
      const beat = handle.getPositionBeats();
      if (Math.abs(beat - lastBeatValue) > 0.02) {
        lastBeatValue = beat;
        setCurrentBeat(beat);
      }
      const active = noteSpans.current.filter((s) => beat >= s.startBeat && beat < s.endBeat);
      const key = active.map((s) => `${s.kind}:${s.from}-${s.to}`).join(',');
      if (key !== lastKey) {
        lastKey = key;
        editorView.current?.dispatch({
          effects: setPlayingNotes.of(active.map(({ from, to, kind }) => ({ from, to, kind }))),
        });
      }
      highlightRaf.current = requestAnimationFrame(tick);
    };
    highlightRaf.current = requestAnimationFrame(tick);

    void handle.done.then(() => {
      if (playback.current === handle) {
        playback.current = null;
        cancelAnimationFrame(highlightRaf.current);
        editorView.current?.dispatch({ effects: setPlayingNotes.of([]) });
        setPlaying(false);
        setCurrentBeat(0);
      }
    });
  };

  // Offline-render the song with the built-in sounds and download it as MP3.
  const downloadMp3 = async () => {
    if (!song || rendering) return;
    setRendering(true);
    setStatus('Rendering MP3…');
    try {
      const buffer = await renderSong(song);
      const blob = await encodeMp3(buffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(song.title ?? 'song').replace(/[^\w.-]+/g, '-')}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Rendered ${(blob.size / 1e6).toFixed(1)} MB MP3`);
    } catch (err) {
      setStatus(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRendering(false);
    }
  };

  const handleRouteChange = (sample: string, route: MidiRoute | undefined) => {
    setRoutes((prev) => {
      const next = { ...prev };
      if (route) next[sample] = route;
      else delete next[sample];
      localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const noteCount = song?.tracks.reduce((n, t) => n + t.timeline.length, 0) ?? 0;

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">
          play<span className="text-primary">.yaml</span> studio
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

        <Hint label="Render the song offline with the built-in sounds and download it as MP3">
          <Button onClick={() => void downloadMp3()} disabled={!song || rendering}>
            <Download />
            {rendering ? 'Rendering…' : 'MP3'}
          </Button>
        </Hint>

        <Hint label="Copy a link that carries this whole score in the URL — no server involved">
          <Button onClick={() => void shareLink()} disabled={!text}>
            <Link2 />
            Share
          </Button>
        </Hint>

        <Hint label={showPanel ? 'Hide the MIDI panel' : 'Show the MIDI panel'}>
          <Button
            size="icon"
            variant={showPanel ? 'secondary' : 'ghost'}
            aria-pressed={showPanel}
            onClick={() => setShowPanel((v) => !v)}
          >
            <PanelRight />
          </Button>
        </Hint>

        {/* The VST rack's own options — a separate panel because it describes
            the instruments at the other end of the cable, not the routing. */}
        <Hint label={showInstruments ? 'Hide the instrument panel' : 'Tweak the VST rack’s instruments'}>
          <Button
            size="icon"
            variant={showInstruments ? 'secondary' : 'ghost'}
            aria-pressed={showInstruments}
            onClick={() => setShowInstruments((v) => !v)}
          >
            <SlidersHorizontal />
          </Button>
        </Hint>
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/*
            Two views of the same score. The editor is what it says; the roll
            is what it does. Both stay mounted — CodeMirror is expensive to
            rebuild and would lose its scroll and selection, and the roll's
            canvas is cheap to leave sitting there — so the hidden one is
            hidden with CSS rather than unmounted.
          */}
          <div role="tablist" aria-label="Main view" className="flex shrink-0 border-b border-border bg-card">
            {([['editor', 'Editor'], ['roll', 'Piano roll']] as const).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mainTab === id}
                onClick={() => setMainTab(id)}
                className={
                  'px-4 py-1.5 text-xs font-medium transition-colors ' +
                  (mainTab === id
                    ? 'border-b-2 border-primary text-foreground'
                    : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className={`min-h-0 flex-1 overflow-hidden ${mainTab === 'editor' ? '' : 'hidden'}`}>
            <CodeMirror
              value={text}
              onChange={handleEdit}
              onCreateEditor={(view) => (editorView.current = view)}
              theme="dark"
              height="100%"
              style={{ height: '100%' }}
              extensions={[yaml(), playingNoteExtension]}
            />
          </div>
          <div className={`min-h-0 flex-1 ${mainTab === 'roll' ? '' : 'hidden'}`}>
            <PianoRoll song={song} currentBeat={currentBeat} playing={playing} />
          </div>
        </div>
        {showPanel && (
          <MidiPanel
            samples={samples}
            midi={midi}
            routes={routes}
            onRouteChange={handleRouteChange}
            disabled={outputMode === 'builtin'}
            song={lastGoodSong}
            currentBeat={currentBeat}
            playing={playing}
            masterVolume={masterVolume}
            onVolumeChange={handleVolumeChange}
            outputMode={outputMode}
            onOutputModeChange={selectOutputMode}
            loop={loop}
            onLoopChange={(v) => setLoop(v)}
            metronome={metronome}
            onMetronomeChange={(v) => {
              metronomeRef.current = v;
              setMetronome(v);
            }}
            rack={rackView}
            isRackPort={isRackPort}
          />
        )}
        {showInstruments && (
          <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
            <InstrumentPanel midi={midi} />
          </aside>
        )}
      </main>

      <footer className="flex items-center gap-3 border-t border-border bg-card px-4 py-1.5 text-xs">
        {error ? (
          <span className="flex items-center gap-1.5 text-destructive">
            <CircleX className="size-3.5 shrink-0" />
            {error}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CircleCheck className="size-3.5 shrink-0 text-primary" />
            {song!.tracks.length} track(s) · {noteCount} notes · {song!.bpm} bpm
          </span>
        )}
        {/* A score with unreadable tokens still plays — they just went silent.
            Say which bar, so a mistyped mark is visible instead of just heard. */}
        {!error && song?.warnings?.length ? (
          <span
            className="flex min-w-0 items-center gap-1.5 truncate text-warning"
            title={song.warnings.join('\n')}
          >
            <TriangleAlert className="size-3.5 shrink-0" />
            <span className="truncate">
              {song.warnings[0]}
              {song.warnings.length > 1 ? ` (+${song.warnings.length - 1} more)` : ''}
            </span>
          </span>
        ) : null}
        <div className="flex-1" />
        {status && <span className="text-muted-foreground">{status}</span>}
      </footer>
    </div>
    </TooltipProvider>
  );
}
