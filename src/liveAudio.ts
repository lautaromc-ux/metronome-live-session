import type { Song } from "./types";

export type AudioChannelMode = "normal" | "inverted";

type StartOptions = {
  song: Song;
  trackFile?: File | null;
  channelMode: AudioChannelMode;
  offsetSeconds?: number;
};

type TimingValidationOptions = {
  bpm: number;
  durationSeconds: number;
  sampleRate: number;
  toleranceMs: number;
};

export type TimingValidationResult = {
  passed: boolean;
  maxDriftMs: number;
  checkedBeats: number;
};

const PLAYBACK_START_DELAY_SECONDS = 0.08;
const CLICK_DURATION_SECONDS = 0.05;
const ACCENT_FREQUENCY = 1200;
const NORMAL_FREQUENCY = 850;
const CLICK_LOOP_BARS = 64;
const DEFAULT_TRACK_VOLUME = 1;
const DEFAULT_CLICK_VOLUME = 0.4;

function getBeatInterval(bpm: number) {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return 60 / safeBpm;
}

function getBeatTime(startTime: number, beatIndex: number, beatInterval: number) {
  return startTime + beatIndex * beatInterval;
}

function clampVolume(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Number(value), 0), 1);
}

export function validateLongSongTiming(
  options: Partial<TimingValidationOptions> = {}
): TimingValidationResult {
  const bpm = options.bpm ?? 127.5;
  const durationSeconds = options.durationSeconds ?? 20 * 60;
  const sampleRate = options.sampleRate ?? 48_000;
  const toleranceMs = options.toleranceMs ?? 0.5;
  const beatInterval = getBeatInterval(bpm);
  const checkedBeats = Math.floor(durationSeconds / beatInterval);
  let maxDriftSeconds = 0;

  for (let beatIndex = 0; beatIndex <= checkedBeats; beatIndex += 1) {
    const exactTime = getBeatTime(0, beatIndex, beatInterval);
    const renderedFrame = Math.round(exactTime * sampleRate);
    const renderedTime = renderedFrame / sampleRate;
    const driftSeconds = Math.abs(renderedTime - exactTime);

    if (driftSeconds > maxDriftSeconds) {
      maxDriftSeconds = driftSeconds;
    }
  }

  const maxDriftMs = maxDriftSeconds * 1000;

  return {
    passed: maxDriftMs < toleranceMs,
    maxDriftMs,
    checkedBeats
  };
}

export class LiveAudioEngine {
  private context: AudioContext | null = null;
  private channelMode: AudioChannelMode = "normal";
  private trackGain: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private trackSource: AudioBufferSourceNode | null = null;
  private clickLoopSource: AudioBufferSourceNode | null = null;
  private activeClickLoopBuffer: AudioBuffer | null = null;
  private beatInterval = 0.5;
  private activeSong: Song | null = null;
  private activeTrackBuffer: AudioBuffer | null = null;
  private playbackOffsetSeconds = 0;
  private sourceStartTime = 0;
  private trackStartOffsetSeconds = 0;
  private trackDurationSeconds = 0;
  private clickLoopDurationSeconds = 0;
  private trackEnded = false;
  private shouldRunClickLoop = false;
  private isPlaying = false;
  private playbackToken = 0;

  async start({ song, trackFile, channelMode, offsetSeconds = 0 }: StartOptions) {
    await this.stop();

    const context = await this.ensureContext();
    const decodedTrack = trackFile ? await this.decodeTrack(trackFile) : null;
    const hasTrack = Boolean(decodedTrack && song.trackFileId);
    const clickStartsEnabled = song.clickEnabled !== false;
    const countInBeats = hasTrack && clickStartsEnabled ? song.countInBars * song.timeSignatureNumerator : 0;
    const trackVolume = clampVolume(song.trackVolume, DEFAULT_TRACK_VOLUME);
    const clickVolume = clampVolume(song.clickVolume, DEFAULT_CLICK_VOLUME);

    this.channelMode = channelMode;
    this.beatInterval = getBeatInterval(song.bpm);
    this.activeSong = song;
    this.activeTrackBuffer = decodedTrack && hasTrack ? this.createMonoTrackBuffer(context, decodedTrack) : null;
    this.trackDurationSeconds = this.activeTrackBuffer?.duration ?? 0;
    this.trackStartOffsetSeconds = countInBeats * this.beatInterval;
    this.shouldRunClickLoop = Boolean(clickStartsEnabled || this.activeTrackBuffer);
    this.activeClickLoopBuffer = this.shouldRunClickLoop
      ? this.createClickLoopBuffer(context, song.timeSignatureNumerator)
      : null;
    this.clickLoopDurationSeconds = this.activeClickLoopBuffer?.duration ?? 0;
    this.trackEnded = false;
    this.playbackOffsetSeconds = Math.max(0, offsetSeconds);

    this.trackGain = context.createGain();
    this.clickGain = context.createGain();
    this.trackGain.gain.value = this.activeTrackBuffer && song.trackEnabled ? trackVolume : 0;
    this.clickGain.gain.value = clickStartsEnabled ? clickVolume : 0;
    this.connectOutput();

    if (!this.activeTrackBuffer && !clickStartsEnabled) {
      throw new Error("No active audio layer.");
    }

    this.startClockedPlayback(context, this.playbackOffsetSeconds);
  }

  async stop() {
    this.playbackToken += 1;
    this.isPlaying = false;
    this.playbackOffsetSeconds = 0;
    this.stopActiveSources();
    this.activeSong = null;
    this.activeTrackBuffer = null;
    this.activeClickLoopBuffer = null;
    this.trackDurationSeconds = 0;
    this.trackStartOffsetSeconds = 0;
    this.clickLoopDurationSeconds = 0;
    this.trackEnded = false;
    this.shouldRunClickLoop = false;
    this.disconnectOutput();
  }

  pause() {
    if (!this.isPlaying) {
      return this.playbackOffsetSeconds;
    }

    this.playbackOffsetSeconds = this.getPosition();
    this.playbackToken += 1;
    this.isPlaying = false;
    this.stopActiveSources();
    this.disconnectOutput();
    return this.playbackOffsetSeconds;
  }

  resume() {
    if (!this.context || !this.activeSong || this.isPlaying) {
      return;
    }

    this.connectOutput();
    this.startClockedPlayback(this.context, this.playbackOffsetSeconds);
  }

  seekTo(positionSeconds: number) {
    this.restartAtPosition(Math.max(0, positionSeconds));
  }

  seekTrackTo(trackPositionSeconds: number) {
    const safeTrackPosition = Math.max(
      0,
      Math.min(trackPositionSeconds, this.trackDurationSeconds || trackPositionSeconds)
    );
    this.restartAtPosition(this.trackStartOffsetSeconds + safeTrackPosition);
  }

  getPosition() {
    if (!this.context || !this.isPlaying) {
      return this.playbackOffsetSeconds;
    }

    return this.playbackOffsetSeconds + Math.max(0, this.context.currentTime - this.sourceStartTime);
  }

  getTrackPosition() {
    if (!this.trackDurationSeconds) {
      return 0;
    }

    const trackPosition = this.getPosition() - this.trackStartOffsetSeconds;
    return Math.max(0, Math.min(trackPosition, this.trackDurationSeconds));
  }

  getTrackDuration() {
    return this.trackDurationSeconds;
  }

  getDuration() {
    return this.getTrackDuration();
  }

  isTrackEnded() {
    if (!this.trackDurationSeconds) {
      return false;
    }

    return this.trackEnded || this.getPosition() >= this.trackStartOffsetSeconds + this.trackDurationSeconds;
  }

  setVolumes(trackVolume: number, clickVolume: number) {
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    this.trackGain?.gain.setTargetAtTime(clampVolume(trackVolume, DEFAULT_TRACK_VOLUME), now, 0.01);
    this.clickGain?.gain.setTargetAtTime(clampVolume(clickVolume, DEFAULT_CLICK_VOLUME), now, 0.01);
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

  private restartAtPosition(positionSeconds: number) {
    const shouldResume = this.isPlaying;

    this.playbackOffsetSeconds = positionSeconds;
    this.playbackToken += 1;
    this.isPlaying = false;
    this.stopActiveSources();
    this.disconnectOutput();

    if (this.context && this.activeSong && shouldResume) {
      this.connectOutput();
      this.startClockedPlayback(this.context, this.playbackOffsetSeconds);
    }
  }

  private startClockedPlayback(context: AudioContext, songPositionOffset: number) {
    const token = this.playbackToken + 1;

    this.playbackToken = token;
    this.playbackOffsetSeconds = Math.max(0, songPositionOffset);
    this.sourceStartTime = context.currentTime + PLAYBACK_START_DELAY_SECONDS;
    this.trackEnded = this.isTrackEnded();
    this.isPlaying = true;

    this.startTrackSource(context, token);

    this.startClickLoopSource(context);
  }

  private startTrackSource(context: AudioContext, token: number) {
    if (!this.activeTrackBuffer || !this.trackGain) {
      return;
    }

    const trackPosition = this.playbackOffsetSeconds - this.trackStartOffsetSeconds;

    if (trackPosition >= this.activeTrackBuffer.duration) {
      this.trackEnded = true;
      return;
    }

    const safeTrackOffset = Math.max(0, trackPosition);
    const startTime =
      trackPosition < 0 ? this.sourceStartTime + Math.abs(trackPosition) : this.sourceStartTime;
    const trackSource = context.createBufferSource();

    trackSource.buffer = this.activeTrackBuffer;
    trackSource.connect(this.trackGain);
    trackSource.start(startTime, safeTrackOffset);
    trackSource.onended = () => {
      if (token === this.playbackToken) {
        this.trackSource = null;
        this.trackEnded = true;
      }
    };

    this.trackSource = trackSource;
  }

  private startClickLoopSource(context: AudioContext) {
    if (!this.activeClickLoopBuffer || !this.clickGain || !this.shouldRunClickLoop) {
      return;
    }

    const clickSource = context.createBufferSource();
    const offset = this.clickLoopDurationSeconds
      ? this.playbackOffsetSeconds % this.clickLoopDurationSeconds
      : 0;

    clickSource.buffer = this.activeClickLoopBuffer;
    clickSource.loop = true;
    clickSource.connect(this.clickGain);
    clickSource.start(this.sourceStartTime, offset);
    this.clickLoopSource = clickSource;
  }

  private stopActiveSources() {
    if (this.trackSource) {
      try {
        this.trackSource.stop();
      } catch {
        // Source may already be stopped.
      }
    }

    this.trackSource = null;

    if (this.clickLoopSource) {
      try {
        this.clickLoopSource.stop();
      } catch {
        // Source may already be stopped.
      }
    }

    this.clickLoopSource = null;
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

  private createMonoTrackBuffer(context: AudioContext, trackBuffer: AudioBuffer) {
    const output = context.createBuffer(1, trackBuffer.length, trackBuffer.sampleRate);
    const outputChannel = output.getChannelData(0);

    for (let channelIndex = 0; channelIndex < trackBuffer.numberOfChannels; channelIndex += 1) {
      const inputChannel = trackBuffer.getChannelData(channelIndex);

      for (let frameIndex = 0; frameIndex < trackBuffer.length; frameIndex += 1) {
        outputChannel[frameIndex] += inputChannel[frameIndex] / trackBuffer.numberOfChannels;
      }
    }

    return output;
  }

  private createClickLoopBuffer(context: AudioContext, timeSignatureNumerator: number) {
    const sampleRate = context.sampleRate;
    const beatsInLoop = Math.max(1, timeSignatureNumerator * CLICK_LOOP_BARS);
    const durationSeconds = beatsInLoop * this.beatInterval;
    const bufferLength = Math.max(1, Math.round(durationSeconds * sampleRate));
    const buffer = context.createBuffer(1, bufferLength, sampleRate);
    const output = buffer.getChannelData(0);

    this.clickLoopDurationSeconds = bufferLength / sampleRate;

    for (let beatIndex = 0; beatIndex < beatsInLoop; beatIndex += 1) {
      const beatTime = getBeatTime(0, beatIndex, this.beatInterval);
      const startFrame = Math.round(beatTime * sampleRate);
      const isAccent = beatIndex % timeSignatureNumerator === 0;

      this.renderClick(output, startFrame, sampleRate, isAccent);
    }

    return buffer;
  }

  private renderClick(
    output: Float32Array,
    startFrame: number,
    sampleRate: number,
    isAccent: boolean
  ) {
    const frequency = isAccent ? ACCENT_FREQUENCY : NORMAL_FREQUENCY;
    const amplitude = isAccent ? 0.9 : 0.65;
    const durationFrames = Math.round(CLICK_DURATION_SECONDS * sampleRate);
    const attackFrames = Math.max(1, Math.round(0.004 * sampleRate));

    for (let frameOffset = 0; frameOffset < durationFrames; frameOffset += 1) {
      const frameIndex = startFrame + frameOffset;

      if (frameIndex >= output.length) {
        break;
      }

      const time = frameOffset / sampleRate;
      const phase = (time * frequency) % 1;
      const wave = phase < 0.5 ? 1 : -1;
      const attack = Math.min(frameOffset / attackFrames, 1);
      const decay = Math.max(1 - frameOffset / durationFrames, 0);
      output[frameIndex] += wave * amplitude * attack * decay;
    }
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
}
