import { useState } from 'react';

/** The studio's localStorage namespace. */
export function storageKey(name: string): string {
  return `play.yaml:${name}`;
}

/** A setting that survives reloads: read once, written on every change. */
export function usePersisted<T extends string | number>(name: string, fallback: T, parse: (raw: string) => T) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(storageKey(name));
    return raw == null ? fallback : parse(raw);
  });
  const set = (next: T) => {
    setValue(next);
    localStorage.setItem(storageKey(name), String(next));
  };
  return [value, set] as const;
}
