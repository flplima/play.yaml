# Future Improvements & Roadmap

This document outlines planned improvements, architecture roadmaps, and feature suggestions for the `play.yaml` notation and playback engine.

Shipped items are moved to the bottom so the top of the file is always the live wishlist.

---

## 1. MIDI Polyphonic Expression (MPE) Support
In standard single-channel MIDI, control changes (like CC 11 expression) and Pitch Bend messages apply to the entire channel. If you play a polyphonic chord, bending or sliding one note bends all active notes.

Adding MPE support will cycle notes through a pool of MIDI channels, allowing per-note pitch bends, pressure (aftertouch), and timbre slides (CC 74) on compatible instruments like **ROLI Studio Player**.

### Proposed YAML Syntax:
```yaml
tracks:
  expressive-pad:
    mpe:
      enabled: true
      globalChannel: 1
      memberChannels: [2, 10] # Pool of channels rotated per note
    play:
      - "[c4 eb4 g4] [d4 f4 ab4]"
```

### Proposed Playback Logic:
Implement an `MpeChannelAllocator` in the player engine to:
* Assign a unique, idle member channel to each new `noteon` event.
* Send subsequent per-note CC curves or pitch bends to that assigned member channel.
* Release the channel back to the pool on `noteoff`.

---

## 2. Live Interactive Playback Controls
During CLI playback, it would be useful to have real-time console controls:
* **Space**: Pause / Resume playback.
* **R**: Restart song from the beginning.
* **Left / Right Arrows**: Adjust tempo (BPM) on the fly.
* **Up / Down Arrows**: Transpose the pitch of all tracks dynamically.

---

## 3. Download .mid from the web studio
Core's `encodeMidi` is environment-free (returns a `Uint8Array`), so the web app
can offer a "Download .mid" button with a few lines of Blob + anchor code. No
engine work needed — just UI.

---

## Shipped

* **Drums & percussion** — `kit:` tracks with GM drum tokens (`bd hh sd hh`),
  rolls (`sd~`), flams, choke groups, channel-10 export; sampled acoustic +
  hand-percussion library (VSCO CE/VCSL, CC0) and a synthesized 808 kit.
  Design notes: `docs/percussion-design.md`. Future extensions listed there:
  brushes/snares-off technique words, non-GM instruments (cajon, darbuka).
* **The built-in orchestra** — the Virtual Playing Orchestra, played by an
  SFZ sampler in core (`sfz.ts`, `sfzSampler.ts`, `vpo.ts`): strings,
  woodwinds, brass, keyboard percussion, choir and orchestral percussion,
  with articulation programs switched by the score's words and samples
  fetched on demand; `piano` and `keys` are synth presets (VPO has no piano).
* **Continuous Controller (CC) automation** — covered by the `set` vocabulary
  rather than a separate `automation` block: named controls (`controls:`),
  technique words ("sul ponticello", "molto vibrato"), raw `cc74 30` clauses,
  and drifts ("bow to 110 over 4", "sul ponticello over 6") that emit CC
  staircases at eighth-note steps from the control's last value. Declared
  `expression` controls mirror dynamics and hairpins as CC ramps.
* **Standard MIDI File export** — `play-yaml -i song.play.yaml -o song.mid`
  writes format 0/1 SMF with a conductor track, tempo ramps (stepped),
  program changes and the full CC stream.
* **Tempo map everywhere** — tempo words, ramps and `a tempo` play back in the
  web transport, the CLI (both synth and `--midi`), and the .mid export.
