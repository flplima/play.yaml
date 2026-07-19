# Future Improvements & Roadmap

This document outlines planned improvements, architecture roadmaps, and feature suggestions for the `play.yaml` notation and playback engine.

---

## 1. MIDI Polyphonic Expression (MPE) Support
In standard single-channel MIDI, control changes (like CC 11 expression) and Pitch Bend messages apply to the entire channel. If you play a polyphonic chord, bending or sliding one note bends all active notes.

Adding MPE support will cycle notes through a pool of MIDI channels, allowing per-note pitch bends, pressure (aftertouch), and timbre slides (CC 74) on compatible instruments like **ROLI Studio Player**.

### Proposed YAML Syntax:
```yaml
tracks:
  - name: "Expressive Pad (ROLI)"
    mpe:
      enabled: true
      globalChannel: 1
      memberChannels: [2, 10] # Pool of channels rotated per note
    measures:
      - "[C4,Eb4,G4] [D4,F4,Ab4]"
```

### Proposed Playback Logic:
Implement an `MpeChannelAllocator` class in the player engine to:
* Assign a unique, idle member channel to each new `noteon` event.
* Send subsequent per-note CC curves or pitch bends to that assigned member channel.
* Release the channel back to the pool on `noteoff`.

---

## 2. Continuous Controller (CC) Automation Curves
Currently, `play.yaml` only supports notes, chords, and static CC initialization. Expressive physical modeling plugins (such as **SWAM VariFlute** and **Cello**) require continuous parameter changes (e.g., breath or bow pressure) over time to sound realistic.

We propose adding an `automation` block to tracks to write linear, exponential, or bezier CC automation curves.

### Proposed YAML Syntax:
```yaml
tracks:
  - name: "Flute (SWAM)"
    channel: 4
    measures:
      - "C4- D4- E4- F4-"
    automation:
      - controller: 11 # Expression (Breath)
        time: 0.0      # Start beat
        duration: 4.0  # Duration in beats
        type: linear
        startValue: 40
        endValue: 110
```

---

## 3. Export to Standard MIDI File (.mid)
To allow seamless integration with DAWs (like Ardour, Ableton Live, or Logic Pro), the CLI should support exporting a `play.yaml` song into a standard multi-track `.mid` binary file.

This would let composers write drafts in YAML and then easily drag-and-drop the generated MIDI file into their DAW for final mixing and sound design.

### Proposed CLI Syntax:
```bash
node packages/cli/dist/cli.js examples/lost-woods.play.yaml --export output.mid
```

---

## 4. Live Interactive Playback Controls
During CLI playback, it would be useful to have real-time console controls:
* **Space**: Pause / Resume playback.
* **R**: Restart song from the beginning.
* **Left / Right Arrows**: Adjust tempo (BPM) on the fly.
* **Up / Down Arrows**: Transpose the pitch of all tracks dynamically.
