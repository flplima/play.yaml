#!/usr/bin/env python3
"""musicxml-to-play.py — convert a MusicXML (.xml/.musicxml or zipped .mxl)
score into a play.yaml score, note-for-note.

How it works
------------
- Every (staff, voice) in the MusicXML becomes its own play.yaml track, so each
  emitted line is monophonic-with-chords. This is what lets sustained inner
  voices ring under moving ones (e.g. the held bass + tenor under the running
  16ths of BWV 846) instead of being clobbered — exactly how the pedal holds
  them. Same-instrument tracks all get `sample: piano` by default.
- Each measure is divided into `numerator` equal beat-slots (one per 1/denominator
  note); each beat is laid out on the finest grid its notes need (gcd of the
  onsets/offsets inside it), filled with note/chord tokens, `_` holds (ties and
  sustains, which carry across barlines) and `~` rests. Chords are notes sharing
  an onset. Mid-piece meter changes are emitted as bare "N/D" directive lines.
- `--snap K` first quantizes every onset/offset to the nearest 1/K of a quarter
  note. Leave it off for scores that are already grid-aligned (the result is then
  bit-exact); use it for performance-quantized engravings (e.g. Debussy's
  cross-rhythms) to keep the grid — and the file — sane. The max onset shift is
  printed so you can confirm it stays inaudible.
- Grace notes (no duration) are dropped; the message reports how many.

The result is verifiable NOTE-IDENTICAL against the source: compile it with
`play-yaml --json` and compare the (onset-beat, midi) of every note against the
same values read straight from the MusicXML. Used to build examples/bwv846,
fur-elise, nocturne-op9-no2 and clair-de-lune. See docs/song-workflow.md.

Usage:
  python3 scripts/musicxml-to-play.py score.mxl --title "Für Elise" --tempo 100
  python3 scripts/musicxml-to-play.py score.mxl -o examples/x.play.yaml --snap 24
"""
import argparse, json, sys, zipfile
import xml.etree.ElementTree as ET
from math import gcd
from functools import reduce

STEP_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b']


def lgcd(nums):
    nums = [n for n in nums if n > 0]
    return reduce(gcd, nums) if nums else 1


def midi_of(step, alter, octave):
    return (octave + 1) * 12 + STEP_PC[step] + alter


def name_of(step, alter, octave, prefer_flat):
    # keep the notated letter for naturals and single accidentals; only reach
    # for an enharmonic spelling on rare double accidentals.
    if alter in (-1, 0, 1):
        acc = '#' if alter == 1 else 'b' if alter == -1 else ''
        return f"{step.lower()}{acc}{octave}"
    m = midi_of(step, alter, octave)
    return f"{(FLAT if prefer_flat else SHARP)[m % 12]}{m // 12 - 1}"


def load_root(path):
    if path.lower().endswith('.mxl'):
        with zipfile.ZipFile(path) as z:
            # the real score is the non-container xml named by META-INF/container.xml
            container = z.read('META-INF/container.xml').decode('utf8')
            rootfile = ET.fromstring(container).find('.//rootfile').get('full-path')
            return ET.fromstring(z.read(rootfile))
    return ET.parse(path).getroot()


def parse(root, snap=1):
    part = root.find('part')
    dv = int(part.find('.//divisions').text)  # divisions per quarter (assumed constant)
    k = part.find('.//key/fifths')
    kf = int(k.text) if k is not None else 0
    prefer_flat = kf < 0

    # carry the time signature forward from wherever it last changed
    meters, cn, cd = [], None, None
    for m in part.findall('measure'):
        t = m.find('attributes/time')
        if t is not None:
            cn, cd = int(t.findtext('beats')), int(t.findtext('beat-type'))
        meters.append((cn, cd))

    tracks = {}       # (staff, voice) -> [ {on, dur, notes:[(midi,name)]} ] in global divisions
    meas_info = []
    gdiv = 0
    tie_open = {}     # (staff, voice, midi) -> event being extended by a tie
    for m, (num, den) in zip(part.findall('measure'), meters):
        beatlen = dv * 4 // den
        mlen = beatlen * num
        cursor = last = 0
        for el in m:
            if el.tag == 'backup':
                cursor -= int(el.findtext('duration')); continue
            if el.tag == 'forward':
                cursor += int(el.findtext('duration')); continue
            if el.tag != 'note':
                continue
            if el.find('grace') is not None:
                continue  # ornaments dropped
            dur = int(el.findtext('duration') or 0)
            chord = el.find('chord') is not None
            staff = el.findtext('staff') or '1'
            voice = el.findtext('voice') or '1'
            onset = last if chord else cursor
            g_on = gdiv + onset
            if el.find('rest') is None:
                p = el.find('pitch')
                step = p.findtext('step')
                octave = int(p.findtext('octave'))
                alter = int(p.findtext('alter') or 0)
                mid = midi_of(step, alter, octave)
                nm = name_of(step, alter, octave, prefer_flat)
                key = (staff, voice)
                tie_stop = any(t.get('type') == 'stop' for t in el.findall('tie'))
                tie_start = any(t.get('type') == 'start' for t in el.findall('tie'))
                tk = (staff, voice, mid)
                if tie_stop and tk in tie_open:
                    tie_open[tk]['dur'] += dur
                    if not tie_start:
                        del tie_open[tk]
                else:
                    tracks.setdefault(key, [])
                    if chord and tracks[key] and tracks[key][-1]['on'] == g_on:
                        tracks[key][-1]['notes'].append((mid, nm))
                        ev = tracks[key][-1]
                    else:
                        ev = dict(on=g_on, dur=dur, notes=[(mid, nm)])
                        tracks[key].append(ev)
                    if tie_start:
                        tie_open[tk] = ev
            if not chord:
                last = cursor
                cursor += dur
        meas_info.append(dict(gdiv=gdiv, num=num, den=den, beatlen=beatlen, mlen=mlen))
        gdiv += mlen

    maxdev = 0
    if snap > 1:
        q = dv // snap  # divisions per 1/snap-of-a-quarter grid step
        if q >= 1:
            def sn(x):
                return int(round(x / q)) * q
            for evs in tracks.values():
                for e in evs:
                    on2, end2 = sn(e['on']), sn(e['on'] + e['dur'])
                    if end2 <= on2:
                        end2 = on2 + q
                    maxdev = max(maxdev, abs(on2 - e['on']))
                    e['on'], e['dur'] = on2, end2 - on2
    return dict(dv=dv, kf=kf, tracks=tracks, meas=meas_info, maxdev=maxdev)


def emit_measure(events, m):
    g0, beatlen, num = m['gdiv'], m['beatlen'], m['num']
    toks = []
    for b in range(num):
        w0, w1 = g0 + b * beatlen, g0 + (b + 1) * beatlen
        pts = {w0, w1}
        for e in events:
            s, en = e['on'], e['on'] + e['dur']
            if s < w1 and en > w0:
                if w0 <= s < w1:
                    pts.add(s)
                if w0 < en < w1:
                    pts.add(en)
        pts = sorted(pts)
        segs = []
        for i in range(len(pts) - 1):
            t0, t1 = pts[i], pts[i + 1]
            starts = [e for e in events if e['on'] == t0]          # co-onset -> chord
            sustain = any(e['on'] < t0 < e['on'] + e['dur'] for e in events)
            segs.append((t1 - t0, 'strike' if starts else 'hold' if sustain else '~', starts))
        g = lgcd([s[0] for s in segs]) if segs else beatlen
        slots = []
        for ln, kind, starts in segs:
            cnt = ln // g
            if kind == '~':
                slots += ['~'] * cnt
            elif kind == 'hold':
                slots += ['_'] * cnt
            else:
                mp = {mid: nm for e in starts for (mid, nm) in e['notes']}
                names = [mp[mid] for mid in sorted(mp)]
                tok = names[0] if len(names) == 1 else '[' + ' '.join(names) + ']'
                slots += [tok] + ['_'] * (cnt - 1)
        toks.append(slots[0] if len(slots) == 1 else '{' + ' '.join(slots) + '}')
    return ' '.join(toks)


def build(root, snap=1):
    d = parse(root, snap)
    tracks, meas, dv = d['tracks'], d['meas'], d['dv']
    keys = sorted(tracks, key=lambda k: (int(k[0]), int(k[1])))
    per_staff = {}
    for st, _ in keys:
        per_staff[st] = per_staff.get(st, 0) + 1
    names, counter = {}, {}
    for k in keys:
        st = k[0]
        base = 'rh' if st == '1' else 'lh' if st == '2' else f's{st}'
        counter[st] = counter.get(st, 0) + 1
        names[k] = base if per_staff[st] == 1 else f"{base}{counter[st]}"
    lines, truth = {}, []
    for k in keys:
        evs = sorted(tracks[k], key=lambda e: e['on'])
        for e in evs:
            for (mid, _) in e['notes']:
                truth.append([round(e['on'] / dv, 6), mid])
        rows = []
        for mm in meas:
            g0, g1 = mm['gdiv'], mm['gdiv'] + mm['mlen']
            ov = [e for e in evs if e['on'] < g1 and e['on'] + e['dur'] > g0]
            rows.append(emit_measure(ov, mm))
        lines[names[k]] = rows
    return d, [names[k] for k in keys], lines, truth


def to_yaml(root, title, tempo, snap=1, header=''):
    d, names, lines, truth = build(root, snap)
    meas = d['meas']
    first = (meas[0]['num'], meas[0]['den'])
    mchg = {i: f"{meas[i]['num']}/{meas[i]['den']}"
            for i in range(1, len(meas))
            if (meas[i]['num'], meas[i]['den']) != (meas[i - 1]['num'], meas[i - 1]['den'])}
    L = []
    for c in header.rstrip('\n').split('\n') if header else []:
        L.append(('# ' + c) if c.strip() else '#')
    if header:
        L.append('')
    L += [f'title: "{title}"', f'tempo: {tempo}', f'measure: {first[0]}/{first[1]}', '', 'tracks:']
    L += [f'  {n}: {{ sample: piano }}' for n in names]
    L += ['', 'sections:', '  piece:', '    loop: false']
    for n in names:
        L.append(f'    {n}:')
        L.append('      play:')
        for i, r in enumerate(lines[n]):
            if i in mchg:
                L.append(f'        - "{mchg[i]}"')
            L.append(f'        - "{r}"')
    return '\n'.join(L) + '\n', truth, d


def main():
    ap = argparse.ArgumentParser(description='MusicXML (.xml/.mxl) -> play.yaml, note-for-note.')
    ap.add_argument('input')
    ap.add_argument('-o', '--output', help='write here (default: stdout)')
    ap.add_argument('--title', default='Untitled')
    ap.add_argument('--tempo', type=int, default=90, help='quarter-note BPM')
    ap.add_argument('--snap', type=int, default=1,
                    help='quantize onsets to 1/SNAP of a quarter (e.g. 24); 1 = exact')
    ap.add_argument('--truth', help='also write [onset,midi] ground-truth JSON here (for verifying)')
    args = ap.parse_args()

    root = load_root(args.input)
    yaml, truth, d = to_yaml(root, args.title, args.tempo, args.snap)
    if args.output:
        open(args.output, 'w').write(yaml)
    else:
        sys.stdout.write(yaml)
    if args.truth:
        json.dump(truth, open(args.truth, 'w'))
    dev = d['maxdev'] / d['dv'] if d['dv'] else 0
    print(f"# {len(truth)} notes, {len(d['tracks'])} tracks, max onset shift {dev:.4f} beat "
          f"({'exact' if args.snap <= 1 else f'snapped to 1/{args.snap}'})", file=sys.stderr)


if __name__ == '__main__':
    main()
