import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import type { EditorView } from '@codemirror/view';
import { parseYaml, compileDoc, CompiledSong } from '@play.yaml/core';
import { EXAMPLES } from './examples';
import { playSong, routeKey, PlaybackHandle, RouteMap, MidiRoute } from './player';
import { buildNoteSpans, NoteSpan } from './noteSpans';
import { playingNoteExtension, setPlayingNotes } from './highlight';
import { useMidi } from './useMidi';
import MidiPanel, { SampleEntry } from './MidiPanel';

type Source =
  | { kind: 'example'; name: string }
  | { kind: 'file'; name: string; handle: FileSystemFileHandle };

const ROUTES_STORAGE_KEY = 'play.yaml:midi-routes';

function loadRoutes(): RouteMap {
  try {
    return JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function compile(text: string): { song: CompiledSong | null; error: string | null } {
  try {
    return { song: compileDoc(parseYaml(text)), error: null };
  } catch (err) {
    return { song: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const canOpenFiles = 'showOpenFilePicker' in window;

export default function App() {
  const firstExample = EXAMPLES[0];
  const [source, setSource] = useState<Source>({ kind: 'example', name: firstExample?.name ?? '' });
  const [text, setText] = useState(firstExample?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
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
  const [routes, setRoutes] = useState<RouteMap>(loadRoutes);

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
      if (!byName.has(name)) byName.set(name, { name, defaultChannel: track.channel || 1 });
    }
    return [...byName.values()];
  }, [lastGoodSong]);

  const stop = useCallback(() => {
    playback.current?.stop();
    playback.current = null;
    cancelAnimationFrame(highlightRaf.current);
    editorView.current?.dispatch({ effects: setPlayingNotes.of([]) });
    setPlaying(false);
  }, []);

  useEffect(() => () => playback.current?.stop(), []);

  const handleEdit = (value: string) => {
    setText(value);
    if (source.kind === 'example') exampleEdits.current.set(source.name, value);
    else setDirty(true);
    // Re-anchor highlights to the edited text so they stay accurate mid-playback.
    if (playback.current) noteSpans.current = buildNoteSpans(value);
  };

  const selectExample = (name: string) => {
    stop();
    const example = EXAMPLES.find((e) => e.name === name);
    if (!example) return;
    setSource({ kind: 'example', name });
    setText(exampleEdits.current.get(name) ?? example.content);
    setDirty(false);
    setStatus(null);
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
    const handle = await playSong(song, routes, outputById, {
      loop,
      metronome: () => metronomeRef.current,
    });
    playback.current = handle;
    setPlaying(true);

    // Strudel-style highlighting: an rAF loop reads the transport's beat
    // position and lights up the beat tokens currently sounding.
    noteSpans.current = buildNoteSpans(text);
    let lastKey = '';
    const tick = () => {
      if (playback.current !== handle) return;
      const beat = handle.getPositionBeats();
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
      }
    });
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
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">
          play<span className="text-emerald-400">.yaml</span> studio
        </h1>

        <div className="mx-2 h-5 w-px bg-zinc-800" />

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Example
          <select
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            value={source.kind === 'example' ? source.name : ''}
            onChange={(e) => selectExample(e.target.value)}
          >
            {source.kind === 'file' && <option value="">— {source.name} —</option>}
            {EXAMPLES.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>

        <button
          className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          onClick={openFile}
          disabled={!canOpenFiles}
          title={canOpenFiles ? 'Open a .play.yaml file from disk' : 'File System Access API not supported in this browser'}
        >
          Open file…
        </button>

        {source.kind === 'file' && (
          <>
            <span className="max-w-48 truncate text-xs text-zinc-400" title={source.name}>
              {source.name}
              {dirty && <span className="ml-1 text-amber-400">●</span>}
            </span>
            <button
              className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              onClick={() => void saveFile()}
              disabled={!dirty}
              title="Save to the opened file (Ctrl+S)"
            >
              Save
            </button>
          </>
        )}

        <div className="flex-1" />

        <button
          className={
            metronome
              ? 'rounded border border-emerald-500 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-zinc-800'
              : 'rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800'
          }
          aria-pressed={metronome}
          onClick={() =>
            setMetronome((v) => {
              metronomeRef.current = !v;
              return !v;
            })
          }
          title="Click on every beat at the song's root tempo"
        >
          ◇ Metronome
        </button>

        <label className="flex items-center gap-1.5 text-xs text-zinc-400" title="Loop the song until stopped">
          <input
            type="checkbox"
            className="accent-emerald-500"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />
          Loop
        </label>

        <button
          className={
            playing
              ? 'rounded bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-400'
              : 'rounded bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40'
          }
          onClick={playing ? stop : () => void play()}
          disabled={!playing && !song}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>

        <button
          className={
            showPanel
              ? 'rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200'
              : 'rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800'
          }
          aria-pressed={showPanel}
          onClick={() => setShowPanel((v) => !v)}
          title={showPanel ? 'Hide the MIDI panel' : 'Show the MIDI panel'}
        >
          ▤
        </button>
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
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
        {showPanel && (
          <MidiPanel
            samples={samples}
            midi={midi}
            routes={routes}
            onRouteChange={handleRouteChange}
          />
        )}
      </main>

      <footer className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-900 px-4 py-1.5 text-xs">
        {error ? (
          <span className="text-red-400">✗ {error}</span>
        ) : (
          <span className="text-zinc-400">
            ✓ {song!.tracks.length} track(s) · {noteCount} notes · {song!.bpm} bpm
          </span>
        )}
        <div className="flex-1" />
        {status && <span className="text-zinc-500">{status}</span>}
      </footer>
    </div>
  );
}
