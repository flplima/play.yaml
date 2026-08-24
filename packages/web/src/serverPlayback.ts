/**
 * serverPlayback.ts — the studio's side of server-side mode.
 *
 * State flows one way: the server pushes a single unified snapshot over SSE
 * (`/api/server-events`) and we drop it straight into the React Query cache.
 * Nothing polls, and nothing here keeps a second copy of the truth — which is
 * what kept the transport button and the actual transport out of step before.
 * Commands (play/stop/volume/test) are plain mutations; their effect comes
 * back as the next pushed snapshot.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const SERVER_STATE_KEY = ['serverState'] as const;

/** The pseudo-port that means "render on the server's own speakers". */
export const WEBAUDIO_ID = 'Server Audio Output (Web Audio)';

export interface ServerPortInfo {
  id: string;
  name: string;
  rawName: string;
  mpe: boolean;
  /** Channel → instrument name, when this port is the rack's input. */
  channels: Record<number, string>;
  /** True for the port the running jukebox rack listens on. */
  rack: boolean;
}

/** One rack channel: what is on it and whether the rack says it will sound. */
export interface RackChannelInfo {
  channel: number;
  name: string;
  format: string;
  loaded: boolean;
  /** Last CC 119 report; null until the rack has said anything about it. */
  ready: boolean | null;
}

export interface RackSnapshot {
  available: boolean;
  through: string;
  channels: RackChannelInfo[];
  /** Channels the server is waiting on before it starts the clock. */
  warming: number[];
}

/**
 * How far along the server's standing render is. Server mode renders the score
 * as soon as it settles rather than when Play is pressed, and this is how the
 * studio knows — and, in Client speaker mode, which render the audio it holds
 * belongs to.
 */
export interface PreparedStatus {
  status: 'idle' | 'rendering' | 'ready' | 'error';
  progress: number;
  key: string;
  hasAudio: boolean;
  durationSec: number;
  error: string | null;
}

export interface ServerSnapshot {
  available: boolean;
  ports: ServerPortInfo[];
  midiDevices: string[];
  playing: boolean;
  device: string;
  volume: number;
  loop: boolean;
  positionBeats: number;
  totalBeats: number;
  prepared: PreparedStatus;
  rack: RackSnapshot;
  error: string | null;
}

export interface ServerRoute {
  outputId: string;
  channel: number;
}

export const NO_RACK: RackSnapshot = { available: false, through: '', channels: [], warming: [] };

export const IDLE_PREPARED: PreparedStatus = {
  status: 'idle',
  progress: 0,
  key: '',
  hasAudio: false,
  durationSec: 0,
  error: null,
};

const OFFLINE: ServerSnapshot = {
  available: false,
  ports: [],
  midiDevices: [],
  playing: false,
  device: WEBAUDIO_ID,
  volume: 1,
  loop: false,
  positionBeats: 0,
  totalBeats: 0,
  prepared: IDLE_PREPARED,
  rack: NO_RACK,
  error: null,
};

async function fetchServerState(): Promise<ServerSnapshot> {
  const res = await fetch('/api/server-status');
  if (!res.ok) throw new Error('Failed to fetch server state');
  return await res.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${url} failed`);
  return data as T;
}

/**
 * Subscribe to the server's state stream and mirror it into the query cache.
 * The one-shot `queryFn` only covers the gap before the first event arrives.
 */
export function useServerState() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/server-events');

    source.addEventListener('state', (event) => {
      try {
        queryClient.setQueryData(SERVER_STATE_KEY, JSON.parse((event as MessageEvent).data));
      } catch {
        // A truncated frame just means we wait for the next one.
      }
    });

    // EventSource reconnects on its own; until it does, say so in the UI.
    source.onerror = () => {
      queryClient.setQueryData<ServerSnapshot>(SERVER_STATE_KEY, (prev) => ({
        ...(prev ?? OFFLINE),
        available: false,
        playing: false,
      }));
    };

    return () => source.close();
  }, [queryClient]);

  return useQuery<ServerSnapshot>({
    queryKey: SERVER_STATE_KEY,
    queryFn: fetchServerState,
    // The stream is the only thing that keeps this fresh.
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useServerPlayMutation() {
  return useMutation({
    mutationFn: (opts: {
      code: string;
      device?: string;
      routes?: Record<string, ServerRoute>;
      volume?: number;
      loop?: boolean;
      fromBeat?: number;
      speaker?: 'server' | 'client';
    }) => post<{ ok: boolean }>('/api/server-play', opts),
  });
}

/** What `/api/server-prepare` answers: which render is now standing. */
export interface PrepareResult {
  ok: boolean;
  key: string;
  status: PreparedStatus['status'];
  hasAudio: boolean;
  durationSec: number;
  error: string | null;
}

/**
 * Ask the server to render a score and hold it. Cheap and idempotent for a
 * score already prepared, which is what lets the studio call it on every edit
 * and again on the way into Play.
 */
export function useServerPrepareMutation() {
  return useMutation({
    mutationFn: (opts: {
      code: string;
      device?: string;
      routes?: Record<string, ServerRoute>;
      fromBeat?: number;
      /** Re-render even if this exact score is already prepared. */
      force?: boolean;
    }) => post<PrepareResult>('/api/server-prepare', opts),
  });
}

export function useServerStopMutation() {
  return useMutation({ mutationFn: () => post<{ ok: boolean }>('/api/server-stop') });
}

export function useServerVolumeMutation() {
  return useMutation({
    mutationFn: (volume: number) => post<{ ok: boolean }>('/api/server-volume', { volume }),
  });
}

export function useServerTestNoteMutation() {
  return useMutation({
    mutationFn: (opts: { device: string; channel: number }) =>
      post<{ ok: boolean }>('/api/server-test-note', opts),
  });
}
