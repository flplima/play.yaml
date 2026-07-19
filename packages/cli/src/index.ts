import { AudioContext } from 'webaudio-node';
import { CompiledSong } from '@play.yaml/core';

type InstrumentPreset = 'piano' | 'strings' | 'flute' | 'bass' | 'lead';

/**
 * Play a note using a specific instrument preset.
 */
function playNotePreset(
  ctx: any,
  instrument: InstrumentPreset,
  freq: number,
  startSec: number,
  durationSec: number,
  targetVolume: number
): void {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const endSec = startSec + durationSec;

  osc.frequency.value = freq;
  osc.frequency.setValueAtTime(freq, startSec);

  const activeNodes: any[] = [osc];

  if (instrument === 'bass') {
    osc.type = 'triangle';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; // Warm roll-off

    osc.connect(filter);
    filter.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.4, startSec + 0.12);
    gainNode.gain.linearRampToValueAtTime(0, endSec);
  } 
  else if (instrument === 'piano') {
    osc.type = 'triangle'; // Mellow fundamental

    // Add a sine overtone for key strike transient (2nd harmonic)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    osc2.frequency.setValueAtTime(freq * 2, startSec);
    activeNodes.push(osc2);

    const gain2 = ctx.createGain();
    gain2.gain.value = targetVolume * 0.25;
    gain2.gain.setValueAtTime(0, startSec);
    gain2.gain.linearRampToValueAtTime(targetVolume * 0.25, startSec + 0.002);
    gain2.gain.exponentialRampToValueAtTime(0, startSec + 0.08); // Quick key hit decay

    osc.connect(gainNode);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.003);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.35, startSec + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0, endSec + 0.4); // Long sustain tail
  } 
  else if (instrument === 'strings') {
    osc.type = 'sawtooth';

    // Warm strings filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    // Vibrato LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 2.0; // Pitch variation depth

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(filter);
    filter.connect(gainNode);

    // Slow bowed string envelope
    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.08); // Slow attack
    gainNode.gain.setValueAtTime(targetVolume, endSec - 0.04);
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.15); // Long release
  } 
  else if (instrument === 'flute') {
    osc.type = 'sine';

    // Soft vibrato
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 6.0;
    lfoGain.gain.value = 3.0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(gainNode);

    // Wind instrument envelope
    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.04);
    gainNode.gain.setValueAtTime(targetVolume, endSec - 0.02);
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.06);
  } 
  else {
    // Default synth lead (sawtooth)
    osc.type = 'sawtooth';
    osc.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.005);
    gainNode.gain.setValueAtTime(targetVolume, endSec - 0.01);
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.01);
  }

  gainNode.connect(ctx.destination);

  for (const node of activeNodes) {
    node.start(startSec);
    node.stop(endSec + 1.0); // Stop safely after decay/release
  }
}

/**
 * Play a compiled song document using the Web Audio API (via webaudio-node).
 * @param song The compiled song object.
 * @returns A promise that resolves when the playback has completed.
 */
export async function playSong(song: CompiledSong): Promise<void> {
  const ctx = new AudioContext() as any;
  const bpm = song.bpm || 120;
  const secPerBeat = 60 / bpm;

  const delay = 0.2; // 200ms scheduling delay to prevent clicks/jitters
  const now = ctx.currentTime;

  let maxDuration = now;

  console.log(`Starting playback of "${song.meta?.title || 'Untitled'}" at ${bpm} BPM...`);

  for (const track of song.tracks) {
    // Determine instrument preset based on program number or track name
    let instrument: InstrumentPreset = 'lead';
    const nameLower = track.name.toLowerCase();

    if (track.program !== undefined) {
      const p = track.program;
      if ((p >= 0 && p <= 7) || (p >= 24 && p <= 31)) {
        instrument = 'piano';
      } else if (p >= 32 && p <= 39) {
        instrument = 'bass';
      } else if (p >= 40 && p <= 55) {
        instrument = 'strings';
      } else if (p >= 72 && p <= 79) {
        instrument = 'flute';
      }
    } else {
      if (nameLower.includes('bass')) {
        instrument = 'bass';
      } else if (nameLower.includes('string') || nameLower.includes('pad') || nameLower.includes('cello')) {
        instrument = 'strings';
      } else if (nameLower.includes('flute') || nameLower.includes('ocarina') || nameLower.includes('woodwind')) {
        instrument = 'flute';
      } else if (nameLower.includes('piano') || nameLower.includes('key')) {
        instrument = 'piano';
      }
    }

    console.log(`  Track: "${track.name}" | Preset: [${instrument}] | Channel ${track.channel} | ${track.timeline.length} notes`);

    for (const note of track.timeline) {
      const startSec = now + delay + note.time * secPerBeat;
      const durationSec = note.duration * secPerBeat;
      const endSec = startSec + durationSec;

      if (endSec > maxDuration) {
        maxDuration = endSec;
      }

      const freq = 440 * Math.pow(2, (note.midi - 69) / 12);

      // Scale volume based on instrument preset
      const maxVolume = instrument === 'bass' ? 0.35 : (instrument === 'piano' ? 0.25 : 0.15);
      const velocityRatio = note.velocity / 127;
      const targetVolume = maxVolume * velocityRatio;

      playNotePreset(ctx, instrument, freq, startSec, durationSec, targetVolume);
    }
  }

  const totalPlayTimeMs = (maxDuration - now) * 1000;
  return new Promise<void>((resolve) => {
    setTimeout(async () => {
      console.log('Playback finished.');
      try {
        if (ctx.close) {
          await ctx.close();
        }
      } catch (err) {
        // Suppress context close errors
      }
      resolve();
    }, totalPlayTimeMs + 500);
  });
}

/**
 * Play a compiled song document by sending real-time MIDI events to a MIDI output port.
 * @param song The compiled song object.
 * @param portName The name of the MIDI output port to create or use.
 * @returns A promise that resolves when the playback has completed.
 */
export async function playSongMidi(song: CompiledSong, portName: string = 'play.yaml Output'): Promise<void> {
  const easymidi = await import('easymidi');
  
  const outputs = easymidi.default.getOutputs();
  const exists = outputs.includes(portName);
  
  let output: any;
  if (exists) {
    console.log(`Connecting to existing MIDI output port: "${portName}"`);
    output = new easymidi.default.Output(portName, false);
  } else {
    console.log(`Creating virtual MIDI output port: "${portName}"`);
    try {
      output = new easymidi.default.Output(portName, true);
    } catch (err: any) {
      console.warn(`Could not create virtual port "${portName}" directly: ${err.message}. Trying to connect to existing port...`);
      output = new easymidi.default.Output(portName, false);
    }
  }
  
  const bpm = song.bpm || 120;
  const secPerBeat = 60 / bpm;
  
  const activeNotes = new Set<string>(); // Format: "channel,note"
  const scheduledTimers: NodeJS.Timeout[] = [];
  let maxTimeMs = 0;
  
  // Instrument mapping table for reference:
  // Channel 1: Pianoteq Stage
  // Channel 2: Roli Studio Player
  // Channel 3: Roli Studio Drums
  // Channel 4: SWAM VariFlute
  // Channel 5: SWAM Cello
  
  for (const track of song.tracks) {
    let channel = track.channel; // 1-indexed
    
    // Auto-detect routing if channel is 1 (or undefined) and track name matches
    const nameLower = track.name.toLowerCase();
    if (!track.channel || track.channel === 1) {
      if (nameLower.includes('pianoteq') || nameLower.includes('piano')) {
        channel = 1;
      } else if (nameLower.includes('roli studio player') || nameLower.includes('roli player') || nameLower.includes('synth') || nameLower.includes('lead')) {
        channel = 2;
      } else if (nameLower.includes('roli studio drums') || nameLower.includes('roli drums') || nameLower.includes('drum') || nameLower.includes('perc')) {
        channel = 3;
      } else if (nameLower.includes('flute') || nameLower.includes('variflute') || nameLower.includes('swam flute')) {
        channel = 4;
      } else if (nameLower.includes('cello') || nameLower.includes('swam cello') || nameLower.includes('string')) {
        channel = 5;
      }
    }
    
    const midiChannel = (channel - 1) & 0xF; // Convert to 0-indexed, bound 0-15
    console.log(`  Track: "${track.name}" | Expected Channel: ${channel} (0-indexed: ${midiChannel}) | ${track.timeline.length} notes`);
    
    // Initialize standard MIDI CC controllers (especially important for SWAM physical modeling instruments)
    try {
      output.send('cc', { controller: 11, value: 100, channel: midiChannel }); // Expression (critical for SWAM)
      output.send('cc', { controller: 1, value: 64, channel: midiChannel });   // Modulation
      output.send('cc', { controller: 7, value: 100, channel: midiChannel });  // Master volume
    } catch (err: any) {
      console.warn(`Failed to send initial CC parameters for channel ${channel}: ${err.message}`);
    }
    
    for (const note of track.timeline) {
      const startMs = note.time * secPerBeat * 1000;
      const durationMs = note.duration * secPerBeat * 1000;
      const endMs = startMs + durationMs;
      
      if (endMs > maxTimeMs) {
        maxTimeMs = endMs;
      }
      
      // Schedule Note On
      const onTimer = setTimeout(() => {
        try {
          output.send('noteon', {
            note: note.midi,
            velocity: note.velocity,
            channel: midiChannel
          });
          activeNotes.add(`${midiChannel},${note.midi}`);
        } catch (e) {
          // Suppress errors during active teardown
        }
      }, startMs);
      scheduledTimers.push(onTimer);
      
      // Schedule Note Off
      const offTimer = setTimeout(() => {
        try {
          output.send('noteoff', {
            note: note.midi,
            velocity: 0,
            channel: midiChannel
          });
          activeNotes.delete(`${midiChannel},${note.midi}`);
        } catch (e) {
          // Suppress errors during active teardown
        }
      }, endMs);
      scheduledTimers.push(offTimer);
    }
  }
  
  return new Promise<void>((resolve) => {
    const endTimer = setTimeout(() => {
      console.log('Playback finished.');
      try {
        output.close();
      } catch (err) {}
      resolve();
    }, maxTimeMs + 1000);
    
    const cleanup = () => {
      console.log('\nStopping MIDI playback and cleaning up...');
      clearTimeout(endTimer);
      for (const t of scheduledTimers) {
        clearTimeout(t);
      }
      // Send noteoff to all active notes to prevent hanging notes
      try {
        for (const key of activeNotes) {
          const [ch, noteVal] = key.split(',').map(Number);
          output.send('noteoff', { note: noteVal, velocity: 0, channel: ch });
        }
        // Send CC 123 (All Notes Off) and CC 120 (All Sound Off) as panic buttons
        for (let ch = 0; ch < 16; ch++) {
          output.send('cc', { controller: 123, value: 0, channel: ch });
          output.send('cc', { controller: 120, value: 0, channel: ch });
        }
        output.close();
      } catch (e) {}
      process.exit(0);
    };
    
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}

