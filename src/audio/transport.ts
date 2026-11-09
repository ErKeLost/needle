import type { AudioSource } from "../music/types";

/**
 * One transport for both kinds of audio a source can hand back: a rendered
 * AudioBuffer (the session) or a URL (a file on this machine). Everything the
 * screen asks for is here, so the view does not care which it got.
 */
export class Transport {
  private buffer: AudioBuffer | null = null;
  private element: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private node: AudioBufferSourceNode | null = null;
  private offset = 0;
  private startedAt = 0;
  private playing = false;
  private volume = 0.8;
  private objectUrl: string | null = null;

  duration = 0;
  onEnded: (() => void) | null = null;

  async load(source: AudioSource, durationHint = 0): Promise<void> {
    this.reset();
    this.duration = durationHint;
    this.offset = 0;
    this.playing = false;

    if (source.kind === "buffer") {
      this.buffer = source.buffer;
      this.duration = source.buffer.duration;
      return;
    }

    this.objectUrl = source.url.startsWith("blob:") ? null : null;
    const element = new Audio();
    element.preload = "auto";
    element.volume = this.volume;
    element.src = source.url;
    element.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(element.duration)) this.duration = element.duration;
    });
    element.addEventListener("ended", () => {
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
    });
    element.addEventListener("error", () => {
      this.playing = false;
    });
    this.element = element;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get time(): number {
    if (this.element) return this.element.currentTime;
    if (!this.playing || !this.context) return this.offset;
    return Math.min(this.duration, this.offset + this.context.currentTime - this.startedAt);
  }

  async play(): Promise<void> {
    if (this.element) {
      try {
        await this.element.play();
        this.playing = true;
      } catch {
        this.playing = false;
      }
      return;
    }
    if (!this.buffer) return;
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    if (this.offset >= this.duration - 0.02) this.offset = 0;

    const node = context.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.gain!);
    node.onended = () => {
      if (this.node !== node) return;
      this.node = null;
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
    };
    node.start(0, this.offset);
    this.node = node;
    this.startedAt = context.currentTime;
    this.playing = true;
  }

  pause(): void {
    if (this.element) {
      this.element.pause();
      this.playing = false;
      return;
    }
    this.offset = this.time;
    this.stopNode();
    this.playing = false;
  }

  seek(seconds: number): void {
    const target = Math.min(Math.max(0, seconds), this.duration || 0);
    if (this.element) {
      this.element.currentTime = target;
      this.offset = target;
      return;
    }
    const wasPlaying = this.playing;
    this.offset = target;
    this.stopNode();
    this.playing = false;
    if (wasPlaying) void this.play();
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.element) this.element.volume = this.volume;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  dispose(): void {
    this.reset();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private stopNode(): void {
    if (!this.node) return;
    const node = this.node;
    this.node = null;
    try {
      node.stop();
    } catch {
      // already stopped
    }
    node.disconnect();
  }

  private reset(): void {
    this.stopNode();
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute("src");
      this.element.load();
      this.element = null;
    }
    this.buffer = null;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }
}
