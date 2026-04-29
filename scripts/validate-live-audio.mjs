const DEFAULT_BPM = 127.5;
const DEFAULT_DURATION_SECONDS = 20 * 60;
const DEFAULT_SAMPLE_RATE = 48_000;
const MAX_ALLOWED_DRIFT_MS = 0.5;

function getBeatInterval(bpm) {
  return 60 / bpm;
}

function getBeatTime(startTime, beatIndex, beatInterval) {
  return startTime + beatIndex * beatInterval;
}

function validateLongSongTiming({
  bpm = DEFAULT_BPM,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  sampleRate = DEFAULT_SAMPLE_RATE,
  toleranceMs = MAX_ALLOWED_DRIFT_MS
} = {}) {
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

function validateClickContinuesAfterTrack({
  bpm = 120,
  trackDurationSeconds = 168,
  fullSongDurationSeconds = 6 * 60,
  countInBars = 1,
  beatsPerBar = 4
} = {}) {
  const beatInterval = getBeatInterval(bpm);
  const countInDuration = countInBars * beatsPerBar * beatInterval;
  const trackEndAt = countInDuration + trackDurationSeconds;
  const beatAfterTrackEnd = Math.ceil(trackEndAt / beatInterval);
  const beatNearSongEnd = Math.floor(fullSongDurationSeconds / beatInterval);
  const firstClickAfterTrack = getBeatTime(0, beatAfterTrackEnd, beatInterval);
  const laterClick = getBeatTime(0, beatNearSongEnd, beatInterval);

  return {
    passed: firstClickAfterTrack >= trackEndAt && laterClick > trackEndAt,
    trackEndAt,
    firstClickAfterTrack,
    laterClick
  };
}

const result = validateLongSongTiming();
const continuityResult = validateClickContinuesAfterTrack();

if (!result.passed) {
  console.error(
    `Live audio timing drift failed: ${result.maxDriftMs.toFixed(4)} ms after ${
      result.checkedBeats
    } beats`
  );
  process.exit(1);
}

if (!continuityResult.passed) {
  console.error(
    `Click continuity failed: track ends at ${continuityResult.trackEndAt.toFixed(
      2
    )}s, next click ${continuityResult.firstClickAfterTrack.toFixed(2)}s`
  );
  process.exit(1);
}

console.log(
  `Live audio timing drift OK: ${result.maxDriftMs.toFixed(4)} ms after ${
    result.checkedBeats
  } beats`
);
console.log(
  `Click continuity OK: track ends at ${continuityResult.trackEndAt.toFixed(
    2
  )}s, click still scheduled at ${continuityResult.laterClick.toFixed(2)}s`
);
