#!/usr/bin/env python3
"""Fundamental-frequency detector for sample verification.

Reads mono float32 PCM at 22050 Hz on stdin (ffmpeg -f f32le), prints the
detected f0 in Hz (or 0 when nothing periodic is found). Used by
fetch-instruments.mjs to catch the octave-off naming in VSCO filenames.
"""
import sys
import numpy as np

RATE = 22050
data = np.frombuffer(sys.stdin.buffer.read(), dtype=np.float32)
if data.size < RATE // 2:
    print(0)
    sys.exit(0)

# The loudest half-second past the attack transient — plucked notes decay
# fast, so a fixed offset can land in noise-floor tail.
size = RATE // 2
hop = RATE // 8
best_start, best_rms = RATE // 20, -1.0
for start in range(RATE // 20, max(data.size - size, RATE // 20) + 1, hop):
    rms = float(np.sqrt(np.mean(np.square(data[start:start + size]))))
    if rms > best_rms:
        best_rms, best_start = rms, start
window = data[best_start:best_start + size].astype(np.float64)
window -= window.mean()
if np.max(np.abs(window)) < 1e-4:
    print(0)
    sys.exit(0)

corr = np.correlate(window, window, mode="full")[window.size - 1:]
corr /= corr[0] + 1e-12

# Plausible instrument range: 25 Hz (below contrabass E1) to 2.5 kHz.
lo, hi = int(RATE / 2500), int(RATE / 25)
segment = corr[lo:hi]
peak = lo + int(np.argmax(segment))

# Guard against picking a sub-octave: if half the lag correlates almost as
# well, prefer it (the true fundamental is the higher frequency).
half = peak // 2
if half >= lo and corr[half] > 0.85 * corr[peak]:
    peak = half

print(round(RATE / peak, 2) if corr[peak] > 0.25 else 0)
