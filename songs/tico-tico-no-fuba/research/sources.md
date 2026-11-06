# Sources: Zequinha de Abreu, Tico-Tico no Fuba (1917)

Consulted 2026-11-03. All downloaded `.mid`, `.abc`, and `.txt` files were
kept strictly in the session scratchpad and not committed to git. Zequinha de
Abreu died in 1935, so the composition is in the public domain worldwide.

| Source | What it provided | Trust |
|---|---|---|
| [Classtab - Eugene Kirpichov MIDI (`abreu_ticotico.mid`) & tab (`abreu_ticotico.txt`)](https://www.classtab.org/abreu_ticotico.mid) | Primary note-level source (format 1, 240 tpq, 783 notes, 2/4 at 100 bpm). Imported with `play-yaml-import --verify` (0 missing, 0 extra, 0 moved, `EXACT`). Provided the 4-bar intro, two-octave Part A statements, A-major Trio, *baixaria* bass, and Picardy A-major ending; companion `.txt` tab provided the C-major Part B section | High (every note onset sits on an exact 16th-note grid; 97.8/100 fidelity match) |
| [MIDIfind - Abreu, Tico Tico (`midifind-64805.mid`)](https://midifind.com/files/a/a_other/abreu_tico_tico/591-1-0-64805) | Two-track MIDI (format 1, 480 tpq, 1828 notes, `EXACT` on `--verify`). Cross-checked Part A (A minor) and Part B (C major) melody pitches and explicit 4-to-5-voice guitar chord voicings | High for Parts A & B; its Part C (bar 65+) is transposed down a semitone to Ab major and truncated |
| [The Session #4357 - Steve Owen ABC setting (#31070)](https://thesession.org/tunes/4357/abc) | Complete concert-pitch ABC lead sheet across all three strains (`K:Amin`, `K:Cmaj`, `K:Amaj`). Cross-checked melodic pitches, chromatic neighbors, and turnarounds | High for melody pitches across all three sections |
| [IMSLP work page - *Tico-Tico no fuba* (Abreu, Zequinha)](https://imslp.org/wiki/Tico-Tico_no_fub%C3%A1_(Abreu,_Zequinha)) | Publication history, composer dates (1880-1935), Irmaos Vitale Sao Paulo original edition metadata (#211430, Plate I. 620 V.), and woodwind trio arrangement listings (flute, clarinet, bassoon, #593545) | High |
| [BitMidi - `tico-tico-mid` (#103693) & `i-brasileri-tico-tico-mid` (#59034)](https://bitmidi.com/i-brasileri-tico-tico-mid) | Full-band General MIDI sequences (11 and 28 tracks). Inspected in scratchpad for ensemble tempo (108-124 bpm), bass patterns, and percussion texture; not used as the primary note source due to unquantized pop-band filler tracks | Medium (useful for ensemble texture check only) |
