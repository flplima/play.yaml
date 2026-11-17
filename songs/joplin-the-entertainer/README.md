# The Entertainer

Scott Joplin's ragtime two-step, published in 1902. Piano solo, C major, 2/4.

- **Source**: the Mutopia Project edition "Reproduction of original edition
  (1902)", typeset in LilyPond by Chris Sawer (Mutopia-2016/11/25-263).
  The typesetter placed it in the public domain, and Joplin died in 1917, so
  the composition is free too. See `research/sources.md`.
- **How it was made**: the edition's MIDI was converted with
  `play-yaml-import --verify`. Result: 2621 source notes, 2621 in the score,
  0 missing, 0 extra, no onset moved (EXACT). The compiled score was then
  checked against the same MIDI again after the edits below.
- **Form**: 152 bars. The edition's MIDI plays every repeat out, so the repeats
  are written out here too. Nothing is cut. About 4 minutes 13 seconds at 72 bpm.
- **Tracks**: `right1`, `right2` (right hand voices), `left1`, `left2` (left
  hand voices), all `piano`. The importer split the hands into voices, and the
  names follow its order.
- **Tempo**: 72 bpm, the value the typesetter put in the edition's MIDI. The
  printed marking is "Not fast", kept as the tempo text.
- **Dynamics**: read from the LilyPond source. The score opens `forte`, with
  the `piano` and `forte` blocks and the hairpins between them. Each hairpin is
  written as a one bar ramp that starts at the bar line, so it begins a little
  earlier than the printed hairpin. The `fz` marks are not written.

## Not done

- The intro and the stride bass are as the edition has them. No swing, no
  pedal: the page has no pedal marks.
- Nobody has listened to the whole file yet. Pitches and onsets match the
  edition's MIDI exactly. Dynamics are the part that is a reading, not a proof.
