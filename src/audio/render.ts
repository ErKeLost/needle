import { BAR } from "../music/session";
import { hz, seeded } from "../music/notes";
import type { Track } from "../music/types";

/**
 * Renders the session to an AudioBuffer with the Web Audio API, so the demo
 * needs no audio files and seeking is instant. The melody comes from the very
 * tokens the chord lane shows.
 *
 * Offline rendering bills by the node and the sample, so filters, panners and
 * noise sources are shared where they can be, and the side renders at 32 kHz:
 * quick enough to prepare while the first frame is still on screen.
 */

const SR = 32000;

export async function renderSession(track: Track): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(track.duration * SR), SR);
  const rand = seeded(88);

  const master = ctx.createGain();
  master.gain.value = 0.82;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 22;
  glue.ratio.value = 2.4;
  glue.attack.value = 0.02;
  glue.release.value = 0.3;
  master.connect(glue).connect(ctx.destination);

  const reverb = room(ctx, master);
  const noise = noiseBuffer(ctx, 2);

  // Pads, through two sides and one filter.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 1500;
  padFilter.Q.value = 0.4;
  const padLevel = ctx.createGain();
  padLevel.gain.value = 0.5;
  padFilter.connect(padLevel);
  padLevel.connect(master);
  padLevel.connect(reverb.input);
  const padSides = [-0.42, 0.42].map((value) => {
    const pan = ctx.createStereoPanner();
    pan.pan.value = value;
    pan.connect(padFilter);
    return pan;
  });

  // A small echo, the kind a pedal makes.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.511;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 2400;
  const delayLevel = ctx.createGain();
  delayLevel.gain.value = 0.28;
  delay.connect(delayFilter).connect(feedback).connect(delay);
  delayFilter.connect(delayLevel);
  delayLevel.connect(master);
  delayLevel.connect(reverb.input);

  // The melody bus keeps one filter and one side for the whole line.
  const melodyFilter = ctx.createBiquadFilter();
  melodyFilter.type = "lowpass";
  melodyFilter.frequency.value = 3600;
  const melodyPan = ctx.createStereoPanner();
  melodyPan.pan.value = -0.12;
  const melodyBus = ctx.createGain();
  melodyBus.gain.value = 0.55;
  melodyFilter.connect(melodyPan).connect(melodyBus);
  melodyBus.connect(master);
  melodyBus.connect(reverb.input);
  melodyBus.connect(delay);

  track.bars?.forEach((bar, index) => {
    const section = index < 2 ? "intro" : bar.section;
    pad(ctx, padSides, bar.at, BAR, bar.chord, section === "intro" ? 0.05 : 0.07, rand);
    bass(ctx, master, bar.at, BAR, bar.root, section === "drop" ? 0.3 : 0.22, reverb.input);
  });

  drums(ctx, master, noise, track, reverb.input);

  // The melody, note for note as it is written on screen.
  for (const line of track.lines) {
    for (const token of line.tokens) {
      if (token.rest) continue;
      token.notes.forEach((note, i) => {
        pluck(ctx, melodyFilter, token.at + i * 0.004, hz(note), 0.5 - i * 0.08);
        pluck(ctx, melodyFilter, token.at + i * 0.004, hz(note) * 2, 0.05);
      });
    }
  }

  crackle(ctx, master, noise, track.duration);

  return ctx.startRendering();
}

/** A small dark room from four damped delay lines; the sides sit apart. */
function room(ctx: OfflineAudioContext, out: AudioNode): { input: GainNode } {
  const input = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  wet.connect(out);

  [0.0297, 0.0371, 0.0411, 0.0437].forEach((seconds, index) => {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = seconds;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = index % 2 === 0 ? 2400 : 2900;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.8;
    const pan = ctx.createStereoPanner();
    pan.pan.value = index % 2 === 0 ? -0.55 : 0.55;

    input.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(pan);
    pan.connect(wet);
  });

  return { input };
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rand = seeded(9);
  for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
  return buffer;
}

function pad(
  ctx: OfflineAudioContext,
  sides: AudioNode[],
  at: number,
  length: number,
  notes: string[],
  level: number,
  rand: () => number,
) {
  notes.forEach((note, index) => {
    const freq = hz(note);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.7 + index * 0.04);
    envelope.gain.setValueAtTime(level, at + length - 0.4);
    envelope.gain.linearRampToValueAtTime(0.0001, at + length + 1.1);
    envelope.connect(sides[index % sides.length]);

    for (const cents of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = cents + (rand() - 0.5) * 3;
      const voice = ctx.createGain();
      voice.gain.value = 0.32;
      osc.connect(voice).connect(envelope);
      osc.start(at);
      osc.stop(at + length + 1.3);
    }

    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.value = freq / 2;
    const bodyLevel = ctx.createGain();
    bodyLevel.gain.value = 0.5;
    body.connect(bodyLevel).connect(envelope);
    body.start(at);
    body.stop(at + length + 1.3);
  });
}

function bass(ctx: OfflineAudioContext, out: AudioNode, at: number, length: number, root: string, level: number, reverb: AudioNode) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = hz(root);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(level, at + 0.06);
  envelope.gain.linearRampToValueAtTime(level * 0.72, at + length * 0.6);
  envelope.gain.linearRampToValueAtTime(0.0001, at + length + 0.15);
  osc.connect(envelope);
  envelope.connect(out);
  envelope.connect(reverb);
  osc.start(at);
  osc.stop(at + length + 0.2);

  const second = ctx.createOscillator();
  second.type = "triangle";
  second.frequency.value = hz(root) * 2;
  const secondLevel = ctx.createGain();
  secondLevel.gain.value = level * 0.18;
  second.connect(secondLevel).connect(envelope);
  second.start(at);
  second.stop(at + length + 0.2);
}

function drums(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, track: Track, reverb: AudioNode) {
  const beat = BAR / 4;

  // One noise source per voice, gated by the envelope of each hit.
  const hatSource = ctx.createBufferSource();
  hatSource.buffer = noise;
  hatSource.loop = true;
  const hatFilter = ctx.createBiquadFilter();
  hatFilter.type = "highpass";
  hatFilter.frequency.value = 7600;
  const hatGain = ctx.createGain();
  hatGain.gain.value = 0;
  hatSource.connect(hatFilter).connect(hatGain).connect(out);

  const snareSource = ctx.createBufferSource();
  snareSource.buffer = noise;
  snareSource.loop = true;
  snareSource.playbackRate.value = 1.31;
  const snareFilter = ctx.createBiquadFilter();
  snareFilter.type = "bandpass";
  snareFilter.frequency.value = 1900;
  snareFilter.Q.value = 0.8;
  const snareGain = ctx.createGain();
  snareGain.gain.value = 0;
  snareSource.connect(snareFilter).connect(snareGain);
  snareGain.connect(out);
  snareGain.connect(reverb);

  track.bars?.forEach((bar, index) => {
    const section = index < 2 ? "intro" : bar.section;
    const busy = section === "drop";
    const laid = section === "intro" || section === "outro";

    for (let i = 0; i < 4; i++) {
      const time = bar.at + i * beat;
      if (!laid && (i === 0 || i === 2 || busy)) kick(ctx, out, time, busy ? 0.55 : 0.4);
      if (!laid) {
        hit(hatGain.gain, time + beat / 2, busy ? 0.05 : 0.03, busy ? 0.18 : 0.055);
      }
      if (busy && (i === 2 || i === 3)) hit(snareGain.gain, time, 0.16, 0.2);
      if (!busy && i === 2 && !laid) hit(snareGain.gain, time, 0.06, 0.2);
    }
  });

  hatSource.start(0);
  snareSource.start(0);
}

/** One envelope on a shared voice, short and steep. */
function hit(param: AudioParam, at: number, level: number, decay: number) {
  param.setValueAtTime(level, at);
  param.exponentialRampToValueAtTime(0.0001, at + decay);
}

function kick(ctx: OfflineAudioContext, out: AudioNode, at: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(132, at);
  osc.frequency.exponentialRampToValueAtTime(44, at + 0.14);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(level, at + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.44);
  osc.connect(envelope).connect(out);
  osc.start(at);
  osc.stop(at + 0.46);
}

function pluck(ctx: OfflineAudioContext, out: AudioNode, at: number, freq: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(level, at + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
  osc.connect(envelope).connect(out);
  osc.start(at);
  osc.stop(at + 0.6);
}

function crackle(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, duration: number) {
  // Dust and the odd press fault, under everything else.
  const bed = ctx.createBufferSource();
  bed.buffer = noise;
  bed.loop = true;
  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = "bandpass";
  bedFilter.frequency.value = 3200;
  bedFilter.Q.value = 0.5;
  const bedLevel = ctx.createGain();
  bedLevel.gain.value = 0.012;
  bed.connect(bedFilter).connect(bedLevel).connect(out);
  bed.start(0);
  bed.stop(duration + 0.2);

  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rand = seeded(313);
  for (let i = 0; i < length; i++) {
    if (rand() < 0.00022) {
      const amp = (rand() * 0.7 + 0.1) * (rand() > 0.5 ? 1 : -1);
      const tail = 12 + Math.floor(rand() * 40);
      for (let j = 0; j < tail && i + j < length; j++) {
        data[i + j] += amp * Math.exp(-j / 9) * (rand() * 1.4 - 0.7);
      }
    }
  }
  const pops = ctx.createBufferSource();
  pops.buffer = buffer;
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 900;
  const level = ctx.createGain();
  level.gain.value = 0.5;
  pops.connect(highpass).connect(level).connect(out);
  pops.start(0);
}
