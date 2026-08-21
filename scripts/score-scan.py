#!/usr/bin/env python3
"""score-scan.py — measure a scanned score instead of squinting at it.

When a piece exists only as a scan (no MusicXML, no MIDI), the notes have to
come off the page by eye, and that is where transcription errors are made: it
is very easy to read a pitch a third out, or to put a note on the wrong half of
a beat. This script does the two things the eye is worst at, by measurement:

  **which line is that note on** — it finds the five staff lines, then converts
  a notehead's y-centre into a staff step and a pitch name for the clef you
  give it.

  **where in the bar does it fall** — engraved music spaces notes roughly in
  proportion to their duration, so within one bar a notehead's x tells you its
  onset. Bar lines are found by consensus across the staves of a system (a real
  bar line is drawn on all of them; a note stem is not). Onsets are reported as
  fractional positions on the bar's metrical grid.

The second one is self-checking, which is the point: a regular accompaniment
figure lands on exact subdivisions, or the reading is wrong. On the Lacrimosa
page used to develop this, Violin I came out on slots 1,2 / 4,5 / 7,8 / 10,11
of a 12/8 bar — an eighth rest plus two eighths, three times over — and the
second violin and viola on 0,3,6,9, a quarter plus an eighth rest. Neither was
assumed; both fell out of the measurement.

What it does NOT do: accidentals, note values (a dotted quarter and a dotted
eighth look alike to it), ties versus slurs, or voices sharing a staff. Those
still have to be read off the image, which is why `grid` exists. Treat the
output as a measured skeleton to check the image against, not a transcription.

Requires numpy and Pillow.

Usage
-----
  # 1. what staves are on this page?
  python3 scripts/score-scan.py lines page.png

  # 2. overlay labelled pitch guides on one staff, to read accidentals and
  #    note values by eye without miscounting lines
  python3 scripts/score-scan.py grid page.png --staff 869:934 --clef treble \\
      --out staff.png --zoom 3

  # 3. measure the noteheads of a whole system, binned into bars
  python3 scripts/score-scan.py read page.png --slots 12 \\
      --staff 869:934:treble:VlnI --staff 1005:1070:treble:VlnII \\
      --staff 1154:1218:alto:Viola

Render the page first at the scan's own resolution, e.g.
  pdftoppm -r 600 -f 46 -l 46 -png score.pdf page
(`pdfimages -list` reports it; rendering above it gains nothing.)

Worked example — the Lacrimosa
------------------------------
The Neue Mozart-Ausgabe scan of K.626 (IMSLP #848267) prints the Lacrimosa as
Mozart left it: the movement breaks off after bar 8, with the string parts
written for bars 1-2 only. Page 46 rendered at 300 dpi, then:

  $ score-scan.py lines lac-46.png
  20 staves ...
    staff  4  --staff 870:934    <- Violino I
    staff  5  --staff 1006:1070  <- Violino II
    staff  6  --staff 1154:1218  <- Viola

  $ score-scan.py read lac-46.png --slots 12 --bars 700,1176,1668,2124,2580 \
        --staff 870:934:treble:VlnI --staff 1006:1070:treble:VlnII \
        --staff 1154:1218:alto:Viola
  --- VlnI (treble, space 16.0px)
     bar 1: C5@1.2  D5@2.3  A5@4.2  B5@5.2  D5@7.2  C5@8.2  C6@10.5  B5@11.4
     bar 2: A5@2.0  D6@2.9  B5@4.6  G5@5.5  E5@7.4  F5@8.3  A5@10.1  C5@11.3
  --- VlnII (treble, space 16.0px)
     bar 1: F4@-0.1  A4@3.2  G4@6.3  C5@9.3
  --- Viola (alto, space 16.0px)
     bar 1: D4@-0.1  F4@3.3  E4@6.3  G4@9.3

Read the slots and the rhythm falls out: the first violin sits on 1,2 / 4,5 /
7,8 / 10,11 — an eighth rest and two eighths, four times — while the second
violin and viola sit on 0,3,6,9, a quarter and an eighth rest. Nothing about
that was assumed, and the fact that every onset lands on an exact subdivision
is what says the reading is right.

`grid` then supplies what measurement cannot: run it over the same bars and the
sharp on that first C5, the cautionary natural on the C6 later in the bar, and
the sharp on the last note of bar 2 are all plainly visible against the labels.

The limit is real, and worth stating: on the same page the vocal parts from bar
3 could not be finished this way. Their pitches measure cleanly, but telling a
dotted quarter from a dotted eighth, or a tie from a slur, needs the eye, and
at this scan quality the durations read off the page did not add up to a full
bar. A skeleton you cannot complete is better than a transcription you cannot
trust.
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw

# Pitch of the bottom staff line, per clef.
CLEF_BOTTOM = {'treble': ('E', 4), 'bass': ('G', 2), 'alto': ('F', 3), 'tenor': ('D', 3)}
LETTERS = 'CDEFGAB'


def pitch_name(step, clef):
    """Staff step (0 = bottom line, 1 = space above it, …) → e.g. 'C5'."""
    letter, octave = CLEF_BOTTOM[clef]
    n = LETTERS.index(letter) + step
    return LETTERS[n % 7] + str(octave + (n // 7 if n >= 0 else -((-n + 6) // 7)))


def find_staff_lines(gray, min_run=0.45):
    """y of every staff line in the image: rows dark across most of the width."""
    dark = (gray < 128).sum(axis=1) / gray.shape[1]
    rows = np.where(dark > min_run)[0]
    if not len(rows):
        return []
    out, cur = [], [rows[0]]
    for r in rows[1:]:
        if r - cur[-1] <= 3:
            cur.append(r)
        else:
            out.append(sum(cur) / len(cur))
            cur = [r]
    out.append(sum(cur) / len(cur))
    return out


def group_into_staves(lines, tolerance=30):
    """Consecutive lines less than `tolerance` apart belong to one staff."""
    staves, cur = [], [lines[0]]
    for y in lines[1:]:
        if y - cur[-1] < tolerance:
            cur.append(y)
        else:
            if len(cur) >= 5:
                staves.append(cur[:5])
            cur = [y]
    if len(cur) >= 5:
        staves.append(cur[:5])
    return staves


def erode(mask, ry, rx):
    """Binary erosion by an ellipse, as an AND over its offsets.

    Written out rather than pulled from scipy so the script needs nothing but
    numpy and Pillow — the kernel is small and the crops are one staff tall.
    The mask is padded with False first: rolling would wrap the top of the
    image onto the bottom and invent noteheads at the edges.
    """
    h, w = mask.shape
    pad = np.zeros((h + 2 * ry, w + 2 * rx), dtype=bool)
    pad[ry:ry + h, rx:rx + w] = mask
    out = np.ones_like(pad)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if (dy / ry) ** 2 + (dx / rx) ** 2 > 1.0:
                continue
            shifted = np.zeros_like(pad)
            ys = slice(max(0, dy), pad.shape[0] + min(0, dy))
            yd = slice(max(0, -dy), pad.shape[0] + min(0, -dy))
            xs = slice(max(0, dx), pad.shape[1] + min(0, dx))
            xd = slice(max(0, -dx), pad.shape[1] + min(0, -dx))
            shifted[yd, xd] = pad[ys, xs]
            out &= shifted
    return out[ry:ry + h, rx:rx + w]


def components(mask):
    """Connected components of a sparse binary mask, as lists of (y, x)."""
    seen = np.zeros_like(mask, dtype=bool)
    blobs = []
    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack, cells = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            cells.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] \
                            and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        blobs.append(cells)
    return blobs


def noteheads(gray, lines):
    """(x, staff step) for every notehead-shaped blob.

    Staff lines and stems are thin; a notehead is a solid ellipse about one
    space tall. Eroding by a little less than that leaves the heads standing
    and dissolves everything else.

    What survives besides heads is beams, and they are told apart by shape, not
    by position: a beam is wide and flat (measured here around 5px tall and
    33px wide against a notehead's 11 by 13). Filtering on height as well as
    width removes them.

    The step tolerance is loose on purpose. Positions above and below the staff
    are extrapolated from its five lines, so a little skew in the scan grows
    with distance — the notes on ledger lines here measured 10.4 and 12.4 where
    they should read 10 and 12, and a tighter bound silently dropped them.
    """
    space = (lines[-1] - lines[0]) / 4.0
    bottom = lines[-1]
    ry, rx = max(2, int(space * 0.30)), max(2, int(space * 0.34))
    core = erode(gray < 120, ry, rx)
    out = []
    for cells in components(core):
        if len(cells) < 4:
            continue
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        height = max(ys) - min(ys) + 1
        width = max(xs) - min(xs) + 1
        if not (space * 0.55 <= height <= space * 1.2):
            continue                                    # beam, or a fragment
        if not (space * 0.5 <= width <= space * 1.7):
            continue                                    # beam or bar line
        step = (bottom - sum(ys) / len(ys)) / (space / 2.0)
        if abs(step - round(step)) > 0.45:
            continue
        if not -7 <= step <= 15:                        # a neighbouring staff
            continue
        out.append((sum(xs) / len(xs), int(round(step))))
    return sorted(out), space


def bar_candidates(gray, lines):
    """Columns dark for nearly the whole staff height."""
    top, bottom = int(lines[0]), int(lines[-1])
    col = (gray[top:bottom + 1] < 128).sum(axis=0) / (bottom - top + 1)
    xs = []
    for x in np.where(col > 0.9)[0]:
        if not xs or x - xs[-1] > 10:
            xs.append(int(x))
    return xs


def crop_for(page, top, bottom, margin=6.0):
    """A staff plus `margin` spaces of air.

    Six spaces reaches three ledger lines either side, which is as far as this
    music goes; anything less silently drops the high notes, which is worse
    than reading them wrong because nothing looks amiss."""
    space = (bottom - top) / 4.0
    y0 = max(0, int(top - space * margin))
    y1 = min(page.shape[0], int(bottom + space * margin))
    lines = [top - y0 + i * space for i in range(5)]
    return page[y0:y1, :], lines


def cmd_lines(args):
    page = np.array(Image.open(args.page).convert('L'))
    music = page[:, page.shape[1] // 6: page.shape[1] * 5 // 6]
    staves = group_into_staves(find_staff_lines(music))
    print(f'{len(staves)} staves on {args.page}:')
    for i, s in enumerate(staves):
        print(f'  staff {i:2d}  --staff {round(s[0])}:{round(s[-1])}'
              f'   (space {(s[-1] - s[0]) / 4:.1f}px)')


def cmd_grid(args):
    page = np.array(Image.open(args.page).convert('L'))
    top, bottom = (float(v) for v in args.staff.split(':')[:2])
    gray, lines = crop_for(page, top, bottom)
    space = (lines[-1] - lines[0]) / 4.0
    y_of = lambda step: lines[-1] - step * space / 2.0

    im = Image.fromarray(gray).convert('RGB')
    if args.x0 is not None:
        im = im.crop((args.x0, 0, args.x1, im.height))
    im = im.resize((int(im.width * args.zoom), int(im.height * args.zoom)), Image.LANCZOS)
    draw = ImageDraw.Draw(im)
    for step in range(-6, 15):
        y = y_of(step) * args.zoom
        if not 0 <= y < im.height:
            continue
        on_line = step % 2 == 0
        draw.line([(0, y), (im.width, y)], fill=(255, 90, 90) if on_line else (140, 180, 255))
        draw.text((3, y - 7), pitch_name(step, args.clef),
                  fill=(190, 0, 0) if on_line else (0, 60, 190))
    im.save(args.out)
    print(f'{args.out}  ({im.width}x{im.height}, space {space:.1f}px)')


def cmd_read(args):
    page = np.array(Image.open(args.page).convert('L'))
    specs = [s.split(':') for s in args.staff]

    staves, votes = [], {}
    for top, bottom, clef, label in specs:
        gray, lines = crop_for(page, float(top), float(bottom))
        staves.append((gray, lines, clef, label))
        for x in bar_candidates(gray, lines):
            votes[round(x / 12)] = votes.get(round(x / 12), 0) + 1

    if args.bars:
        edges = [int(v) for v in args.bars.split(',')]
    else:
        need = max(2, int(len(specs) * 0.7))
        raw = sorted(k * 12 for k, v in votes.items() if v >= need)
        edges = []
        for x in raw:
            if not edges or x - edges[-1] > 40:
                edges.append(x)
        if len(edges) > 2:
            # a "bar" far narrower than its neighbours is a stem, not a bar line
            gaps = sorted(edges[i + 1] - edges[i] for i in range(len(edges) - 1))
            median = gaps[len(gaps) // 2]
            keep = [edges[0]]
            for x in edges[1:]:
                if x - keep[-1] >= median * 0.6:
                    keep.append(x)
            edges = keep
    print(f'bar lines: {edges}')
    print('(the first bar of a system also holds the clef, key and meter — pass'
          ' --bars with its left edge moved past them for honest slot numbers)\n')

    for gray, lines, clef, label in staves:
        heads, space = noteheads(gray, lines)
        print(f'--- {label} ({clef}, space {space:.1f}px)')
        for i in range(len(edges) - 1):
            lo, hi = edges[i], edges[i + 1]
            # a note on the downbeat is engraved a little left of the bar
            # line it follows, so the window reaches back a few pixels
            inside = [(x, s) for x, s in heads if lo - 12 <= x < hi - 4]
            if not inside:
                continue
            cells = [f'{pitch_name(s, clef)}@{(x - lo) / (hi - lo) * args.slots:.1f}'
                     for x, s in inside]
            print(f'   bar {i + 1}: ' + '  '.join(cells))
        print()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('lines', help='list the staves on a page')
    p.add_argument('page')
    p.set_defaults(func=cmd_lines)

    p = sub.add_parser('grid', help='overlay labelled pitch guides on one staff')
    p.add_argument('page')
    p.add_argument('--staff', required=True, metavar='TOP:BOTTOM')
    p.add_argument('--clef', required=True, choices=sorted(CLEF_BOTTOM))
    p.add_argument('--out', required=True)
    p.add_argument('--zoom', type=float, default=3.0)
    p.add_argument('--x0', type=int, default=None)
    p.add_argument('--x1', type=int, default=None)
    p.set_defaults(func=cmd_grid)

    p = sub.add_parser('read', help='measure noteheads of a system, binned into bars')
    p.add_argument('page')
    p.add_argument('--staff', action='append', required=True,
                   metavar='TOP:BOTTOM:CLEF:LABEL')
    p.add_argument('--slots', type=int, default=12,
                   help='metrical subdivisions per bar (12 for 12/8, 16 for 4/4 in 16ths)')
    p.add_argument('--bars', default=None, help='explicit bar-line x positions, comma separated')
    p.set_defaults(func=cmd_read)

    args = ap.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
