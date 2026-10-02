export type TempoEstimate = {
  bpm: number;
  confidence: number;
  pulseCount: number;
};

const MIN_BPM = 55;
const MAX_BPM = 210;

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function normalizeBpm(bpm: number, min = 70, max = 190) {
  let normalized = bpm;

  while (normalized < min) {
    normalized *= 2;
  }

  while (normalized > max) {
    normalized /= 2;
  }

  return normalized;
}

export function estimateTempoFromPulseTimes(pulseTimesMs: number[]): TempoEstimate | null {
  if (pulseTimesMs.length < 3) {
    return null;
  }

  const intervals = pulseTimesMs
    .slice(1)
    .map((time, index) => time - pulseTimesMs[index])
    .filter((interval) => interval >= 240 && interval <= 2200);

  if (intervals.length < 2) {
    return null;
  }

  const center = median(intervals);
  const filtered = intervals.filter((interval) => Math.abs(interval - center) <= center * 0.28);
  const stableIntervals = filtered.length >= 2 ? filtered : intervals;
  const averageInterval =
    stableIntervals.reduce((total, interval) => total + interval, 0) / stableIntervals.length;
  const deviations = stableIntervals.map((interval) => Math.abs(interval - averageInterval));
  const relativeDeviation = median(deviations) / averageInterval;
  const confidence = Math.max(0, Math.min(1, 1 - relativeDeviation * 4));

  return {
    bpm: Math.round(normalizeBpm(60_000 / averageInterval) * 10) / 10,
    confidence,
    pulseCount: pulseTimesMs.length
  };
}

export function estimateTempoFromAudioBuffer(buffer: AudioBuffer): TempoEstimate | null {
  const sampleRate = buffer.sampleRate;
  const frameSize = 1024;
  const hopSize = 512;
  const frameRate = sampleRate / hopSize;
  const maxFrames = Math.min(Math.floor((buffer.length - frameSize) / hopSize), Math.floor(frameRate * 180));

  if (maxFrames < frameRate * 4) {
    return null;
  }

  const novelty = new Float32Array(maxFrames);
  let previousEnergy = 0;

  for (let frameIndex = 0; frameIndex < maxFrames; frameIndex += 1) {
    const start = frameIndex * hopSize;
    let energy = 0;

    for (let sampleIndex = 0; sampleIndex < frameSize; sampleIndex += 1) {
      let monoSample = 0;

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        monoSample += buffer.getChannelData(channelIndex)[start + sampleIndex] ?? 0;
      }

      monoSample /= buffer.numberOfChannels;
      energy += monoSample * monoSample;
    }

    energy = Math.sqrt(energy / frameSize);
    novelty[frameIndex] = Math.max(0, energy - previousEnergy * 0.92);
    previousEnergy = energy;
  }

  const localWindow = Math.max(3, Math.round(frameRate * 0.08));
  const onsets: number[] = [];
  let lastOnsetFrame = -Infinity;

  for (let frameIndex = localWindow; frameIndex < novelty.length - localWindow; frameIndex += 1) {
    let localTotal = 0;
    let isPeak = true;

    for (let offset = -localWindow; offset <= localWindow; offset += 1) {
      localTotal += novelty[frameIndex + offset];
      if (novelty[frameIndex + offset] > novelty[frameIndex]) {
        isPeak = false;
      }
    }

    const localAverage = localTotal / (localWindow * 2 + 1);
    const enoughSeparation = frameIndex - lastOnsetFrame > frameRate * 0.16;

    if (isPeak && enoughSeparation && novelty[frameIndex] > localAverage * 1.65) {
      onsets.push((frameIndex / frameRate) * 1000);
      lastOnsetFrame = frameIndex;
    }
  }

  if (onsets.length < 4) {
    return null;
  }

  const minLag = Math.floor((frameRate * 60) / MAX_BPM);
  const maxLag = Math.ceil((frameRate * 60) / MIN_BPM);
  let bestLag = 0;
  let bestScore = -Infinity;
  let scoreTotal = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;

    for (let frameIndex = lag; frameIndex < novelty.length; frameIndex += 1) {
      score += novelty[frameIndex] * novelty[frameIndex - lag];
    }

    const bpm = (60 * frameRate) / lag;
    const preferredTempoWeight = 1 - Math.min(Math.abs(bpm - 120) / 300, 0.18);
    score *= preferredTempoWeight;
    scoreTotal += Math.max(0, score);

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!bestLag || bestScore <= 0) {
    return null;
  }

  const rawBpm = (60 * frameRate) / bestLag;
  const normalizedBpm = normalizeBpm(rawBpm);
  const confidence = Math.max(0.1, Math.min(0.99, (bestScore / Math.max(scoreTotal, bestScore)) * 8));

  return {
    bpm: Math.round(normalizedBpm * 10) / 10,
    confidence,
    pulseCount: onsets.length
  };
}
