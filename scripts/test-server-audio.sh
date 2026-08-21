#!/usr/bin/env bash
#
# Play one note on the studio's server-side output, over the network, and
# listen to this machine's speakers to check it arrived.
#
# The studio can play a score on the machine running the dev server rather than
# in the browser (the header's "Server" mode, `/api/server-play`). Every part of
# that path can answer "ok" while nothing is audible — the transport runs, the
# HTTP call succeeds, and the audio device is muted, routed elsewhere, or never
# opened. So this test does not trust the response: it records the sink's own
# monitor and measures what actually came out.
#
#   scripts/test-server-audio.sh                          # https://play-yaml.dev.local
#   scripts/test-server-audio.sh https://host:5173        # another studio
#   scripts/test-server-audio.sh https://host:5173 c5     # another note
#
# Needs PipeWire's pw-record (any Linux desktop audio stack has it) and a
# studio dev server running. Exits non-zero if the speakers stayed silent or
# the pitch is wrong.
set -euo pipefail

URL="${1:-https://play-yaml.dev.local}"
NOTE="${2:-a4}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The default sink's monitor is what the speakers are being fed. Recording the
# default *source* would capture the microphone — the room, not the output.
SINK="$(pw-cli ls Node 2>/dev/null |
  grep -B2 'media.class = "Audio/Sink"' |
  grep 'node.name' | head -1 | sed 's/.*= "//; s/"//')"
[ -n "$SINK" ] || { echo "no PipeWire audio sink found"; exit 1; }

cat > "$WORK/one-note.play.yaml" <<YAML
title: One note over the network
tempo: 60
sample: flute
play:
  - "$NOTE ~ ~ ~"
YAML

python3 -c '
import json, sys
print(json.dumps({
    "code": open(sys.argv[1]).read(),
    "device": "Server Audio Output (Web Audio)",
    "routes": {}, "volume": 0.8, "loop": False,
}))' "$WORK/one-note.play.yaml" > "$WORK/body.json"

echo "server : $URL"
echo "sink   : $SINK"
echo "note   : $NOTE"

pw-record --target "$SINK" --rate 48000 --channels 2 "$WORK/capture.wav" &
REC=$!
sleep 0.7   # let the capture stream settle before anything sounds

echo -n "play   : "
curl -sk -X POST "$URL/api/server-play" \
  -H 'Content-Type: application/json' --data-binary "@$WORK/body.json"
echo

sleep 3
curl -sk -X POST "$URL/api/server-stop" > /dev/null
kill -INT "$REC" 2>/dev/null || true
wait "$REC" 2>/dev/null || true

python3 - "$WORK/capture.wav" "$NOTE" <<'PY'
import array, math, sys, wave

STEPS = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def expected_hz(note: str) -> float:
    """a4 -> 440. Enough of the DSL's pitch spelling for a single token."""
    name, i = note.lower(), 1
    semis = STEPS[name[0]]
    while i < len(name) and name[i] in '#b':
        semis += 1 if name[i] == '#' else -1
        i += 1
    octave = int(name[i:] or 4)
    return 440 * 2 ** ((semis - 9) / 12 + (octave - 4))


w = wave.open(sys.argv[1])
rate, ch = w.getframerate(), w.getnchannels()
data = array.array('h', w.readframes(w.getnframes()))
mono = [(data[i] + data[i + 1]) / 2 for i in range(0, len(data) - 1, ch)]
peak = max(abs(v) for v in mono) / 32768
step = rate // 20

bars = ''.join(
    ' .:-=+*#%@'[min(9, int(max(abs(v) for v in mono[i:i + step]) / 32768 * 30))]
    for i in range(0, len(mono) - step, step)
)
print(f"level  : peak {peak:.4f} over {len(mono) / rate:.2f}s")
print(f"         |{bars}|   (50 ms per column)")

# Pitch of the loudest half-second, by autocorrelation. Cheaper than an FFT
# and it does not care about the harmonics a flute is made of.
want = expected_hz(sys.argv[2])
start = max(range(0, max(1, len(mono) - rate // 2), step),
            key=lambda i: sum(abs(v) for v in mono[i:i + rate // 2]))
seg = mono[start:start + rate // 2]
mean = sum(seg) / len(seg)
seg = [v - mean for v in seg]
best = best_lag = 0
for lag in range(int(rate / (want * 2)), int(rate / (want / 2))):
    c = sum(seg[i] * seg[i + lag] for i in range(0, len(seg) - lag, 4))
    if c > best:
        best, best_lag = c, lag
hz = rate / best_lag if best_lag else 0
cents = 1200 * math.log2(hz / want) if hz else 0
print(f"pitch  : {hz:.1f} Hz, wanted {want:.1f} ({cents:+.0f} cents)")

if peak <= 0.005:
    print("FAIL   : the server answered but nothing reached the speakers")
    sys.exit(1)
if abs(cents) >= 50:
    print("FAIL   : something sounded, but not the note that was asked for")
    sys.exit(1)
print("ok     : one note played on this machine, driven over the network")
PY
