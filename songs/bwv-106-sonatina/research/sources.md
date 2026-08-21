# Sources — BWV 106

Consulted 2026-08-06. Nothing third-party is committed: the renderings below
were read in the session scratchpad and only the extracted facts and the
transcription live in this repo.

## Facts (structure, keys, meters, scoring)

- **Wikipedia — "Gottes Zeit ist die allerbeste Zeit, BWV 106"**
  <https://en.wikipedia.org/wiki/Gottes_Zeit_ist_die_allerbeste_Zeit,_BWV_106>
  Complete movement table with scoring, key, time signature and tempo marking
  per movement, plus date and place of composition. This is what the movement
  table in `report.md` comes from. Trust: high for structural facts; it
  reflects the NBA's own numbering (1, 2a–2d, 3a–3b, 4).

- **IMSLP work page**
  <https://imslp.org/wiki/Gottes_Zeit_ist_die_allerbeste_Zeit,_BWV_106_(Bach,_Johann_Sebastian)>
  Edition list (Bach-Gesellschaft 1876 ed. Rust; NBA 1986 ed. Higuchi; CPDL
  re-typesets by Malahieude 2012 CC BY-SA 3.0 and Straeten 2024 CC BY-SA 4.0),
  and the Synthesized/MIDI section. Confirms that the only MIDI on IMSLP for
  this work is of the **Sonatina**.

## Notes — all three movements

- **Ramon Casadesus-Masanell, engraving files** — IMSLP file **#752782**
  (`…BWV_106_EngravingFiles.zip`, Ramon Casadesus-Masanell 2021,
  **CC BY-NC-SA 4.0**). A ZIP holding MuseScore (`.mscz`), MusicXML (`.mxl`)
  and MIDI (`.mid`) exports of **all four movements**, plus per-movement PDFs
  (#752778–752781). This is the source every score in these three directories
  is imported from. Trust: high — it is an edition, mechanically exported, and
  its section markings (tempo text, meter changes) are what the bar ranges are
  read from. Note it is filed under *Arrangements and Transcriptions*, not
  under *Scores*.

  Licence note: Bach's notes are public domain; Casadesus's engraving is
  CC BY-NC-SA. Only the derived transcription is committed, per the repo's
  copyright rule, with attribution here and in each score header.

## Cross-check sources (the Sonatina)

- **R.D. Tennent, five-part arrangement** — IMSLP file #569905
  (`IMSLP569905-PMLP149635-bwv106C.mid`). Five separate parts, quantised
  exactly to a sixteenth grid, ♩=40, transposed as a body to C major for
  recorders. Used for **rhythm and part-layout**. Trust: high for rhythm
  (mechanically gridded), zero for absolute pitch (transposed).

- **Pierre Gouin, transcription for organ** — IMSLP file #364223
  (`IMSLP364223-PMLP149635-Bach_106_Sonatina.mid`), and the matching engraving
  <https://commons.wikimedia.org/wiki/File:Gottes_Zeit_ist_die_allerbeste_Zeit,_BWV_106_(IA_imslp-zeit-ist-die-allerbeste-zeit-bwv-106-bach-johann-sebastian).pdf>
  (Les Éditions Outremontaises, 2009; hosted on Commons as public domain, from
  the Werner Icking Music Archive via archive.org). At Bach's own pitch and key
  in E♭ major, three staves (G.O. / Réc. / Péd.), ♩=33 with a closing
  ritardando, humanised timing. Used for **key and register**, and as the
  independent file the finished score is scored against. Trust: high for
  pitch class, medium for octave (the pedal is a 16′ stop, sounding an octave
  below written), low for rhythm (Finale human playback).

  The engraving also independently confirms the three bars of rest before the
  recorders enter.

## Checked and rejected

- **CPDL** — returns HTTP 403 to scripted requests; not consulted.
- **MuseScore.com** — behind Cloudflare; not consulted.
- **Mutopia Project** — no BWV 106.
- **Wikimedia Commons** — only the Gouin Sonatina engraving above; the other
  Commons hits for "BWV 106" are unrelated photographs and 19th-century
  vocal-score scans of a French arrangement.
- **CyberBass** — has a BWV 106 page but now serves audio, not the MIDI
  learning files it used to.
- **Internet Archive** item `imslp-zeit-ist-die-allerbeste-zeit-bwv-106-…` —
  contains only the Gouin Sonatina PDF, not the full score.

The Casadesus engraving files (above) were found last, and supersede the
reconstruction for the notes actually committed. The Tennent/Gouin route is
kept in `report.md` because agreeing with it independently is the strongest
check that the import is right.
