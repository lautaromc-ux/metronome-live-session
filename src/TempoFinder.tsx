import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  estimateTempoFromAudioBuffer,
  estimateTempoFromPulseTimes,
  type TempoEstimate
} from "./tempoDetection";

type TempoFinderProps = {
  onTempoDetected: (bpm: number) => void;
};

type DetectionSource = "tap" | "file" | "microphone";

function formatConfidence(confidence: number) {
  if (confidence >= 0.72) {
    return "Alta";
  }

  if (confidence >= 0.45) {
    return "Media";
  }

  return "Orientativa";
}

function ResultCard({ estimate, source }: { estimate: TempoEstimate; source: DetectionSource }) {
  const sourceLabel = source === "tap" ? "Tap tempo" : source === "file" ? "Archivo" : "Micrófono";

  return (
    <div className="tempo-result" aria-live="polite">
      <span>{sourceLabel}</span>
      <strong>{estimate.bpm}</strong>
      <small>BPM · Confianza {formatConfidence(estimate.confidence)}</small>
    </div>
  );
}

export default function TempoFinder({ onTempoDetected }: TempoFinderProps) {
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [estimate, setEstimate] = useState<TempoEstimate | null>(null);
  const [source, setSource] = useState<DetectionSource>("tap");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Marcá al menos 4 pulsos parejos.");
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const listenTimeoutRef = useRef<number | null>(null);
  const microphonePulsesRef = useRef<number[]>([]);

  const publishEstimate = useCallback(
    (nextEstimate: TempoEstimate, nextSource: DetectionSource) => {
      setEstimate(nextEstimate);
      setSource(nextSource);
      onTempoDetected(nextEstimate.bpm);
    },
    [onTempoDetected]
  );

  const stopMicrophone = useCallback(async () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (listenTimeoutRef.current !== null) {
      window.clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      void stopMicrophone();
    };
  }, [stopMicrophone]);

  function handleTap() {
    const now = performance.now();
    const shouldRestart = tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2500;
    const nextTimes = [...(shouldRestart ? [] : tapTimes), now].slice(-14);
    const nextEstimate = estimateTempoFromPulseTimes(nextTimes);

    setTapTimes(nextTimes);
    setSource("tap");
    setError("");
    setStatus(
      nextEstimate
        ? `${nextTimes.length} pulsos registrados. Seguí marcando para afinar el resultado.`
        : `${nextTimes.length} de 4 pulsos mínimos.`
    );

    if (nextEstimate) {
      publishEstimate(nextEstimate, "tap");
    }
  }

  function resetTap() {
    setTapTimes([]);
    setStatus("Marcá al menos 4 pulsos parejos.");
    setError("");
  }

  async function handleAudioFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setStatus(`Analizando ${file.name}...`);

    const context = new AudioContext();

    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const nextEstimate = estimateTempoFromAudioBuffer(buffer);

      if (!nextEstimate) {
        setError("No pude encontrar un pulso estable. Probá con un fragmento que tenga batería clara.");
        setStatus("Análisis terminado sin resultado confiable.");
        return;
      }

      publishEstimate(nextEstimate, "file");
      setStatus(`${file.name} analizado. Podés ajustar el valor a la mitad o al doble si hace falta.`);
    } catch {
      setError("No pude leer ese audio. Probá con MP3, WAV, M4A o AAC.");
      setStatus("El archivo no se pudo analizar.");
    } finally {
      await context.close();
      setIsAnalyzing(false);
    }
  }

  async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite escuchar el micrófono.");
      return;
    }

    await stopMicrophone();
    setError("");
    setStatus("Escuchando... acercá el dispositivo a la música durante 10–20 segundos.");
    microphonePulsesRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false
        }
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const sourceNode = context.createMediaStreamSource(stream);
      const samples = new Float32Array(analyser.fftSize);
      let ambientLevel = 0.012;
      let previousEnergy = 0;
      let lastPulseTime = -Infinity;

      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.12;
      sourceNode.connect(analyser);
      streamRef.current = stream;
      audioContextRef.current = context;
      setIsListening(true);

      const readAudio = () => {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;

        for (let index = 0; index < samples.length; index += 1) {
          energy += samples[index] * samples[index];
        }

        energy = Math.sqrt(energy / samples.length);
        ambientLevel = ambientLevel * 0.985 + energy * 0.015;
        const now = performance.now();
        const threshold = Math.max(0.035, ambientLevel * 1.7);
        const isOnset = energy > threshold && energy > previousEnergy * 1.3 && now - lastPulseTime > 260;

        if (isOnset) {
          lastPulseTime = now;
          const pulses = [...microphonePulsesRef.current, now].slice(-24);
          microphonePulsesRef.current = pulses;
          const nextEstimate = estimateTempoFromPulseTimes(pulses);

          if (nextEstimate) {
            publishEstimate(nextEstimate, "microphone");
            setStatus(`${pulses.length} golpes detectados. Seguí escuchando para estabilizar el tempo.`);
          } else {
            setStatus(`Escuchando... ${pulses.length} golpes detectados.`);
          }
        }

        previousEnergy = energy;
        animationFrameRef.current = window.requestAnimationFrame(readAudio);
      };

      readAudio();
      listenTimeoutRef.current = window.setTimeout(() => {
        void stopMicrophone();
        setStatus((currentStatus) =>
          microphonePulsesRef.current.length >= 3
            ? "Escucha terminada. Repetí si el tempo todavía oscila."
            : currentStatus
        );
      }, 25_000);
    } catch {
      await stopMicrophone();
      setError("No pude acceder al micrófono. Revisá el permiso de Safari o del navegador.");
      setStatus("Micrófono detenido.");
    }
  }

  function adjustTempo(multiplier: number) {
    if (!estimate) {
      return;
    }

    const bpm = Math.round(estimate.bpm * multiplier * 10) / 10;
    const nextEstimate = { ...estimate, bpm };
    setEstimate(nextEstimate);
    onTempoDetected(bpm);
  }

  return (
    <section className="tempo-finder panel-section" aria-labelledby="tempo-finder-title">
      <div className="tempo-finder-heading">
        <div>
          <span className="section-label">Herramienta rápida</span>
          <h2 id="tempo-finder-title">Sacar tempo</h2>
          <p>Marcá el pulso, cargá un audio o dejá que el micrófono escuche el tema.</p>
        </div>
        {estimate ? <ResultCard estimate={estimate} source={source} /> : null}
      </div>

      <div className="tempo-method-grid">
        <article className="tempo-method">
          <div>
            <span className="tempo-method-number">01</span>
            <h3>Tap tempo</h3>
            <p>Tocá al ritmo de la negra. Se reinicia solo después de 2,5 segundos.</p>
          </div>
          <button className="tap-tempo-button" type="button" onClick={handleTap}>
            TAP
            <small>{tapTimes.length > 0 ? `${tapTimes.length} pulsos` : "Tocá acá"}</small>
          </button>
          <button className="text-button" type="button" onClick={resetTap} disabled={tapTimes.length === 0}>
            Reiniciar tap
          </button>
        </article>

        <article className="tempo-method">
          <div>
            <span className="tempo-method-number">02</span>
            <h3>Cargar un tema</h3>
            <p>Analiza hasta los primeros 3 minutos. Funciona mejor con batería o ataques claros.</p>
          </div>
          <label className={isAnalyzing ? "file-button disabled" : "file-button"}>
            {isAnalyzing ? "Analizando..." : "Elegir audio"}
            <input
              accept=".mp3,.wav,.m4a,.aac,audio/*"
              disabled={isAnalyzing}
              type="file"
              onChange={(event) => void handleAudioFile(event)}
            />
          </label>
        </article>

        <article className="tempo-method">
          <div>
            <span className="tempo-method-number">03</span>
            <h3>Escuchar el tema</h3>
            <p>Usa el micrófono durante un máximo de 25 segundos. El audio no se guarda.</p>
          </div>
          {isListening ? (
            <button className="listening-button" type="button" onClick={() => void stopMicrophone()}>
              <span aria-hidden="true" /> Detener escucha
            </button>
          ) : (
            <button type="button" onClick={() => void startMicrophone()}>
              Escuchar con micrófono
            </button>
          )}
        </article>
      </div>

      <div className="tempo-status">
        <span>{status}</span>
        {error ? <strong>{error}</strong> : null}
        {estimate ? (
          <div className="tempo-adjustments">
            <span>¿Marcó medio/doble tempo?</span>
            <button type="button" onClick={() => adjustTempo(0.5)}>÷ 2</button>
            <button type="button" onClick={() => adjustTempo(2)}>× 2</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
