import type { Song } from "./types";

export type AudioChannelMode = "normal" | "inverted";

type StartOptions = {
  song: Song;
  trackFile?: File | null;
  channelMode: AudioChannelMode;
};

export class LiveAudioEngine {
  private context: AudioContext | null = null;
  private channelMode: AudioChannelMode = "normal";
  private trackGain: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private trackSource: AudioBufferSourceNode | null = null;
  private schedulerTimer: number | null = null;
  private nextBeatTime = 0;
  private beatIndex = 0;
  private beatInterval = 0.5;
  private stopAtTime: number | null = null;

  async start({ song, trackFile, channelMode }: StartOptions) {
    await this.stop();

    const context = await this.ensureContext();
    this.channelMode = channelMode;
    this.beatInterval = 60 / song.bpm;
    this.nextBeatTime = context.currentTime + 0.12;
    this.beatIndex = 0;
    this.stopAtTime = null;

    this.trackGain = context.createGain();
    this.clickGain = context.createGain();
    this.trackGain.gain.value = song.trackVolume;
    this.clickGain.gain.value = song.clickVolume;
    this.connectOutput();

    const countInBeats = song.countInBars * song.timeSignatureNumerator;
    const songStartTime = this.nextBeatTime + countInBeats * this.beatInterval;

    if (trackFile) {
      const buffer = await this.decodeTrack(trackFile);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.trackGain);
      source.start(songStartTime);
      source.onended = () => {
        this.stopAtTime = context.currentTime;
      };
      this.trackSource = source;
      this.stopAtTime = songStartTime + buffer.duration + this.beatInterval;
    }

    this.scheduleBeats(song.timeSignatureNumerator);
  }

  async stop() {
    if (this.schedulerTimer !== null) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    if (this.trackSource) {
      try {
        this.trackSource.stop();
      } catch {
        // Source may already be stopped.
      }
    }

    this.trackSource = null;
    this.disconnectOutput();
  }

  setVolumes(trackVolume: number, clickVolume: number) {
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    this.trackGain?.gain.setTargetAtTime(trackVolume, now, 0.01);
    this.clickGain?.gain.setTargetAtTime(clickVolume, now, 0.01);
  }

  setChannelMode(channelMode: AudioChannelMode) {
    this.channelMode = channelMode;
    this.connectOutput();
  }

  async testChannel(channel: "left" | "right") {
    const context = await this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const merger = context.createChannelMerger(2);
    const channelIndex = channel === "left" ? 0 : 1;

    oscillator.type = "sine";
    oscillator.frequency.value = channel === "left" ? 440 : 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.45, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);

    oscillator.connect(gain);
    gain.connect(merger, 0, channelIndex);
    merger.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  }

  private async ensureContext() {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  private async decodeTrack(file: File) {
    const context = await this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  private connectOutput() {
    if (!this.context || !this.trackGain || !this.clickGain) {
      return;
    }

    this.disconnectOutput();

    this.merger = this.context.createChannelMerger(2);
    const trackChannel = this.channelMode === "normal" ? 0 : 1;
    const clickChannel = this.channelMode === "normal" ? 1 : 0;

    this.trackGain.connect(this.merger, 0, trackChannel);
    this.clickGain.connect(this.merger, 0, clickChannel);
    this.merger.connect(this.context.destination);
  }

  private disconnectOutput() {
    try {
      this.trackGain?.disconnect();
      this.clickGain?.disconnect();
      this.merger?.disconnect();
    } catch {
      // Disconnect can throw when nodes are already disconnected.
    }

    this.merger = null;
  }

  private scheduleBeats(timeSignatureNumerator: number) {
    if (!this.context || !this.clickGain) {
      return;
    }

    const lookAheadSeconds = 0.12;

    while (this.nextBeatTime < this.context.currentTime + lookAheadSeconds) {
      if (this.stopAtTime !== null && this.nextBeatTime > this.stopAtTime) {
        void this.stop();
        return;
      }

      this.scheduleClick(this.nextBeatTime, this.beatIndex % timeSignatureNumerator === 0);
      this.nextBeatTime += this.beatInterval;
      this.beatIndex += 1;
    }

    this.schedulerTimer = window.setTimeout(() => this.scheduleBeats(timeSignatureNumerator), 25);
  }

  private scheduleClick(time: number, isAccent: boolean) {
    if (!this.context || !this.clickGain) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const frequency = isAccent ? 1200 : 850;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(isAccent ? 0.9 : 0.65, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    oscillator.connect(gain);
    gain.connect(this.clickGain);
    oscillator.start(time);
    oscillator.stop(time + 0.05);
  }
}

