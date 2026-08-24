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
import * as Tone from 'tone';
import {
  fetchPreparedAudio,
  playPreparedAudio,
  type PreparedAudio,
  type ServerAudioPlayback,
} from './serverAudio';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { playSong, routeKey, PlaybackHandle, RouteMap, MidiRoute } from './player';
import { encodeMp3, renderSong } from './render';
import { buildNoteSpans, NoteSpan } from './noteSpans';
import { playingNoteExtension, setPlayingNotes } from './highlight';
import { useMidi } from './useMidi';
import { useRack, useRackReadiness } from './useRack';
import { isRackOutput } from './rack';
import { suggestRackChannel } from '@play.yaml/core';
import MidiPanel, { SampleEntry } from './MidiPanel';
import InstrumentPanel from './InstrumentPanel';
import { clearShareHash, decodeShareHash, encodeShareHash, isShareHash } from './share';
import {
  useServerState,
  useServerPlayMutation,
  useServerPrepareMutation,
  useServerStopMutation,
  useServerVolumeMutation,
  useServerTestNoteMutation,
  IDLE_PREPARED,
  NO_RACK,
  RackSnapshot,
  ServerPortInfo,
  WEBAUDIO_ID,
} from './serverPlayback';

type Source =
  | { kind: 'example'; name: string }
  | { kind: 'file'; name: string; handle: FileSystemFileHandle }
  | { kind: 'shared' };

const ROUTES_STORAGE_KEY = 'play.yaml:midi-routes';
const OUTPUT_STORAGE_KEY = 'play.yaml:output-mode';
const EXAMPLE_STORAGE_KEY = 'play.yaml:example';
const SERVER_MODE_STORAGE_KEY = 'play.yaml:server-mode';
const SPEAKER_STORAGE_KEY = 'play-yaml-speaker';
const SERVER_MIDI_DEVICE_STORAGE_KEY = 'play.yaml:server-midi-device';
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
  // readiness reports arriving on this browser's own MIDI input. In server
  // mode the server listens instead and pushes the same on its stream.
  const rack = useRack();
  const readiness = useRackReadiness(midi, rack.through);
  const [routes, setRoutes] = useState<RouteMap>(loadRoutes);
  const [outputMode, setOutputMode] = useState<OutputMode>(loadOutputMode);

  // Master volume state (0 - 100)
  const [masterVolume, setMasterVolume] = useState<number>(() => {
    const saved = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    return saved != null ? Number(saved) : 80;
  });

  // Server-side mode state
  const [serverSideMode, setServerSideMode] = useState<boolean>(() => {
    return localStorage.getItem(SERVER_MODE_STORAGE_KEY) === 'true';
  });

  const [serverMidiDevice, setServerMidiDevice] = useState<string>(() => {
    return localStorage.getItem(SERVER_MIDI_DEVICE_STORAGE_KEY) || WEBAUDIO_ID;
  });

  /*
   * Where server-rendered audio comes out. `server` is this machine's own
   * speakers, which is what server mode has always meant and stays the
   * default; `client` streams the same render back to this browser instead,
   * for when the rack is in another room from the person listening.
   *
   * Only tracks the *server* renders are affected. A track routed out to a
   * hardware MIDI port is sounding in a synth the server does not own, and no
   * setting here can move that audio.
   */
  const [speaker, setSpeaker] = useState<'server' | 'client'>(() =>
    localStorage.getItem(SPEAKER_STORAGE_KEY) === 'client' ? 'client' : 'server');
  const handleSpeakerChange = (next: 'server' | 'client') => {
    setSpeaker(next);
    localStorage.setItem(SPEAKER_STORAGE_KEY, next);
  };

  // One SSE stream is the whole server-side story: devices, transport, and
  // playhead. Because it is pushed, the studio never disagrees with the server
  // about whether something is sounding.
  const serverQuery = useServerState();
  const serverState = serverQuery.data;
  const serverAvailable = Boolean(serverState?.available);
  const serverPlaying = Boolean(serverState?.playing);
  const serverPositionBeats = serverState?.positionBeats ?? 0;

  const serverPortsInfo = useMemo<ServerPortInfo[]>(() => serverState?.ports ?? [], [serverState?.ports]);
  const serverMidiDevices = useMemo(
    () => serverState?.midiDevices ?? [WEBAUDIO_ID],
    [serverState?.midiDevices],
  );

  const serverPlayMutation = useServerPlayMutation();
  const serverPrepareMutation = useServerPrepareMutation();
  const serverStopMutation = useServerStopMutation();
  const serverVolumeMutation = useServerVolumeMutation();
  const serverTestNoteMutation = useServerTestNoteMutation();
  const prepareServer = serverPrepareMutation.mutateAsync;

  /** How far along the server's standing render is; pushed on the stream. */
  const prepared = serverState?.prepared ?? IDLE_PREPARED;

  const serverDeviceLabel =
    serverPortsInfo.find((p) => p.id === serverMidiDevice)?.name ?? serverMidiDevice;

  const handleServerTestNote = (device: string, channel: number) => {
    serverTestNoteMutation.mutate({ device, channel });
  };

  const handleVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(100, vol));
    setMasterVolume(clamped);
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, String(clamped));
    // Every engine takes the change live, mid-note: the browser's transport,
    // the server's own sink, and a server render playing here.
    playback.current?.setVolume(clamped / 100);
    serverAudio.current?.setVolume(clamped / 100);
    if (serverSideMode) serverVolumeMutation.mutate(clamped / 100);
  };

  const refreshServerInfo = () => {
    void serverQuery.refetch();
  };

  const handleServerSideModeChange = (active: boolean) => {
    stop();
    setServerSideMode(active);
    localStorage.setItem(SERVER_MODE_STORAGE_KEY, String(active));
  };

  const handleServerMidiDeviceChange = (device: string) => {
    setServerMidiDevice(device);
    localStorage.setItem(SERVER_MIDI_DEVICE_STORAGE_KEY, device);
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

  /*
   * One view of the rack for the panel, whichever side is going to play. The
   * server's snapshot carries its own readiness; in WebMIDI mode the map is
   * the published one and readiness is what this browser has heard.
   */
  const rackView = useMemo<RackSnapshot>(() => {
    if (serverSideMode) return serverState?.rack ?? NO_RACK;
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
    // `readiness.version` is the map's change counter — the map itself is
    // mutated in place, so it is the version that has to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSideMode, serverState?.rack, rack.rack, rack.through, rack.channels, readiness.version, warmingChannels]);

  const isRackPort = useCallback(
    (outputId: string) => {
      if (serverSideMode) return Boolean(serverPortsInfo.find((p) => p.id === outputId)?.rack);
      const output = midi.outputs.find((o) => o.id === outputId);
      return Boolean(output && isRackOutput(output, rack.through));
    },
    [serverSideMode, serverPortsInfo, midi.outputs, rack.through],
  );

  const stopServer = serverStopMutation.mutate;
  /*
   * The browser's end of Speaker = Client. Held in refs rather than state
   * because nothing renders from them — one is the server's render sitting
   * decoded and waiting, the other the node currently playing it, and stop()
   * has to be able to reach that from anywhere.
   */
  const clientAudio = useRef<PreparedAudio | null>(null);
  const serverAudio = useRef<ServerAudioPlayback | null>(null);
  /** Mirrors `clientAudio`'s key, purely so the panel can say "ready". */
  const [clientAudioKey, setClientAudioKey] = useState('');

  const stop = useCallback(() => {
    // Stop means stop: both engines, whichever mode the header is in. A score
    // can be sounding here and on the server at once (mode toggles do not
    // silence the side you left), and hunting for the right toggle before the
    // noise stops is not something anyone should have to do. Stopping an idle
    // engine is a no-op.
    stopServer();
    serverAudio.current?.stop();
    serverAudio.current = null;
    playback.current?.stop();
    playback.current = null;
    cancelAnimationFrame(highlightRaf.current);
    editorView.current?.dispatch({ effects: setPlayingNotes.of([]) });
    setPlaying(false);
    setCurrentBeat(0);
  }, [stopServer]);

  // Only the browser's own transport is torn down when this component goes
  // away. Server-side playback belongs to the server: reloading the studio
  // must not cut the speakers off mid-phrase.
  useEffect(() => () => playback.current?.stop(), []);

  /*
   * Server mode honours the same routing table the panel edits, so a track can
   * land on a specific rack port — or on the server's synth. Memoised because
   * this is part of what identifies a render: prepare and play must describe
   * the routing identically or the server would take Play for a different
   * score and render it again.
   */
  const serverRoutes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(routes).filter(([, r]) => r).map(([k, r]) => [k, r as MidiRoute]),
      ),
    [routes],
  );

  /**
   * Pull the server's standing render down, unless the copy already in hand is
   * the same one. In Client speaker mode this is what "ready to play" means.
   */
  const ensureClientAudio = useCallback(async (key: string): Promise<PreparedAudio | null> => {
    if (clientAudio.current?.key === key) return clientAudio.current;
    // Tone's context, not a second one: the render then plays through the same
    // master output and clock as everything else the studio sounds. It may
    // still be suspended here — createBuffer does not care, and Play resumes it.
    const ctx = Tone.getContext().rawContext as AudioContext;
    const audio = await fetchPreparedAudio(ctx);
    clientAudio.current = audio;
    setClientAudioKey(audio?.key ?? '');
    return audio;
  }, []);

  /*
   * Keep a render standing for whatever is currently in the editor.
   *
   * This is the whole point of server mode's shape: the expensive work —
   * decoding the sample libraries, rendering the score — happens while the
   * score sits there being read, so Play has nothing left to do but start.
   * Debounced, because every keystroke recompiles; skipped while the transport
   * runs, so a mid-phrase edit does not put the CPU up against playback.
   */
  useEffect(() => {
    if (!serverSideMode || !serverAvailable || !song || serverPlaying) return;
    const timer = window.setTimeout(() => {
      void prepareServer({
        code: text,
        device: serverMidiDevice,
        routes: serverRoutes,
        fromBeat: 0,
      }).catch(() => {
        // The failure comes back on the stream as prepared.error; the panel
        // shows it there rather than shouting in the status bar on a keystroke.
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    serverSideMode, serverAvailable, serverPlaying, song, text,
    serverMidiDevice, serverRoutes, prepareServer,
  ]);

  /*
   * …and, when this browser is the speaker, have the audio itself here before
   * anyone asks for it. A render that is ready on the server is not ready to
   * play in a browser 30 m away until the bytes have made the trip.
   */
  useEffect(() => {
    if (!serverSideMode || speaker !== 'client') return;
    if (prepared.status !== 'ready' || !prepared.hasAudio) return;
    if (clientAudio.current?.key === prepared.key) return;
    void ensureClientAudio(prepared.key).catch((err) => {
      setStatus(`Server audio: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [
    serverSideMode, speaker, prepared.status, prepared.hasAudio, prepared.key, ensureClientAudio,
  ]);

  /** Throw the standing render away and build it again, from the panel. */
  const refreshPreparedAudio = () => {
    if (!song) return;
    clientAudio.current = null;
    setClientAudioKey('');
    setStatus('Re-rendering the score on the server…');
    void prepareServer({
      code: text,
      device: serverMidiDevice,
      routes: serverRoutes,
      fromBeat: 0,
      force: true,
    })
      .then((result) =>
        setStatus(result.ok ? 'Server render ready' : `Render failed: ${result.error ?? 'unknown error'}`))
      .catch((err) => setStatus(`Render failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  // In server mode the server owns the transport, so the button and the
  // playhead read straight off the stream. `isPending` only covers the blink
  // between clicking Play and the first pushed snapshot.
  const isPlaying = serverSideMode ? serverPlaying || serverPlayMutation.isPending : playing;
  const displayBeat = serverSideMode ? serverPositionBeats : currentBeat;

  // Light up the score from the server's playhead, the same way the rAF loop
  // does for local playback.
  useEffect(() => {
    if (!serverSideMode || !editorView.current) return;
    if (!serverPlaying) {
      editorView.current.dispatch({ effects: setPlayingNotes.of([]) });
      return;
    }
    if (!noteSpans.current.length) noteSpans.current = buildNoteSpans(text);
    const active = noteSpans.current.filter(
      (s) => serverPositionBeats >= s.startBeat && serverPositionBeats < s.endBeat,
    );
    editorView.current.dispatch({
      effects: setPlayingNotes.of(active.map(({ from, to, kind }) => ({ from, to, kind }))),
    });
    // `text` is deliberately not a dep: re-anchoring mid-playback is handled
    // by handleEdit, and re-running on every keystroke would fight it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSideMode, serverPlaying, serverPositionBeats]);

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

    if (serverSideMode) {
      // Highlighting in server mode is driven by the playhead the stream
      // reports, so the spans have to exist before the first frame arrives.
      noteSpans.current = buildNoteSpans(text);
      /*
       * Wake the audio context here, before the network call — a browser only
       * lets a context start off a user gesture, and the click that got us
       * here is the one we have. Doing it after an await has no *stated*
       * expiry, but it is the kind of thing that works until a policy change
       * makes it not, and there is no reason to depend on it.
       */
      if (speaker === 'client') {
        try {
          await Tone.start();
        } catch (err) {
          console.warn('[server-audio] could not start the audio context:', err);
        }
      }
      try {
        /*
         * Both of these are normally no-ops — the effects above rendered this
         * score and fetched it the moment it settled. They are awaited anyway
         * so that pressing Play before that finished still works: it just
         * costs the render instead of starting instantly.
         */
        const ready = prepared.status === 'ready' && prepared.key !== '';
        if (!ready) setStatus('Rendering the score on the server…');
        const result = await prepareServer({
          code: text,
          device: serverMidiDevice,
          routes: serverRoutes,
          fromBeat: 0,
        });
        if (!result.ok) throw new Error(result.error ?? 'the score could not be rendered');

        let audio: PreparedAudio | null = null;
        if (speaker === 'client' && result.hasAudio) {
          if (clientAudio.current?.key !== result.key) setStatus('Fetching the render…');
          audio = await ensureClientAudio(result.key);
        }

        // Nothing is compiled or rendered behind this call: the server opens
        // its ports, starts its clock and hands the finished PCM to its sink.
        await serverPlayMutation.mutateAsync({
          code: text,
          device: serverMidiDevice,
          // Routes naming a port this machine doesn't have fall back to the
          // selected device, server-side.
          routes: serverRoutes,
          volume: masterVolume / 100,
          speaker,
          loop,
        });

        if (audio) {
          serverAudio.current?.stop();
          const ctx = Tone.getContext().rawContext as AudioContext;
          serverAudio.current = playPreparedAudio(ctx, ctx.destination, audio, {
            loop,
            volume: masterVolume / 100,
          });
        }
        setStatus(`▶ Playing on server (${serverDeviceLabel}${speaker === 'client' ? ' → this browser' : ''})`);
      } catch (err) {
        setStatus(`Server error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

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
          variant={isPlaying ? 'destructive' : 'default'}
          size="lg"
          className="font-semibold"
          onClick={isPlaying ? stop : () => void play()}
          disabled={!isPlaying && !song}
        >
          {isPlaying ? <Square className="fill-current" /> : <Play className="fill-current" />}
          {isPlaying ? 'Stop' : 'Play'}
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
            {/* `displayBeat`, not `currentBeat`: the server owns the transport in
                server mode and its playhead arrives on the stream, so the local
                one never moves there. */}
            <PianoRoll song={song} currentBeat={displayBeat} playing={isPlaying} />
          </div>
        </div>
        {showPanel && (
          <MidiPanel
            samples={samples}
            midi={midi}
            routes={routes}
            onRouteChange={handleRouteChange}
            disabled={outputMode === 'builtin' && !serverSideMode}
            song={lastGoodSong}
            currentBeat={displayBeat}
            playing={isPlaying}
            masterVolume={masterVolume}
            onVolumeChange={handleVolumeChange}
            serverSideMode={serverSideMode}
            outputMode={serverSideMode ? 'server' : outputMode}
            onOutputModeChange={(mode) => {
              handleServerSideModeChange(mode === 'server');
              if (mode !== 'server') selectOutputMode(mode as OutputMode);
            }}
            speaker={speaker}
            onSpeakerChange={handleSpeakerChange}
            prepared={prepared}
            clientAudioReady={
              speaker !== 'client' || !prepared.hasAudio || clientAudioKey === prepared.key
            }
            onRefreshPrepared={refreshPreparedAudio}
            loop={loop}
            onLoopChange={(v) => setLoop(v)}
            metronome={metronome}
            onMetronomeChange={(v) => {
              metronomeRef.current = v;
              setMetronome(v);
            }}
            serverMidiDevice={serverMidiDevice}
            onServerMidiDeviceChange={handleServerMidiDeviceChange}
            serverMidiDevices={serverMidiDevices}
            serverPortsInfo={serverPortsInfo}
            onRefreshServerDevices={refreshServerInfo}
            serverAvailable={serverAvailable}
            serverError={serverState?.error ?? null}
            onServerTestNote={handleServerTestNote}
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
