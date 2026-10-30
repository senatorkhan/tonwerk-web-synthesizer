"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

type PerformanceKey = {
  key: string;
  note: string;
  traceNote: string;
  label: string;
};

const PERFORMANCE_KEYS: PerformanceKey[] = [
  { key: "A", note: "F4", traceNote: "F2", label: "F" },
  { key: "S", note: "Ab4", traceNote: "Ab2", label: "A♭" },
  { key: "D", note: "Bb4", traceNote: "Bb2", label: "B♭" },
  { key: "F", note: "C5", traceNote: "C3", label: "C" },
  { key: "G", note: "Eb5", traceNote: "Eb3", label: "E♭" },
  { key: "H", note: "F5", traceNote: "F3", label: "F" },
  { key: "J", note: "Ab5", traceNote: "Ab3", label: "A♭" },
  { key: "K", note: "Bb5", traceNote: "Bb3", label: "B♭" },
];

const KEY_MAP = Object.fromEntries(
  PERFORMANCE_KEYS.map((performanceKey) => [
    performanceKey.key.toLowerCase(),
    performanceKey,
  ]),
) as Record<string, PerformanceKey>;

const EMPTY_TRACE: Array<string | null> = Array.from({ length: 8 }, () => null);
const TEMPO = 90;

function noteLabel(note: string | null) {
  return note ? note.replace("b", "♭").replace(/\d/g, "") : "—";
}

function distanceName(distance: number) {
  if (distance < 34) return "NOW";
  if (distance < 68) return "TRACE";
  return "GONE";
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [audioError, setAudioError] = useState("");
  const [memoryNotes, setMemoryNotes] = useState<Array<string | null>>([
    ...EMPTY_TRACE,
  ]);
  const [capturing, setCapturing] = useState(false);
  const [captureIndex, setCaptureIndex] = useState(-1);
  const [distance, setDistance] = useState(28);
  const [master, setMaster] = useState(72);
  const [pressedNotes, setPressedNotes] = useState<string[]>([]);

  const audio = useRef<any>(null);
  const held = useRef(new Set<string>());
  const requestedNotes = useRef(new Set<string>());
  const currentStep = useRef(0);
  const memoryNotesRef = useRef<Array<string | null>>([...EMPTY_TRACE]);
  const captureIndexRef = useRef(-1);
  const unlockPromise = useRef<Promise<void> | null>(null);
  const starting = useRef(false);

  const unlockAudio = useCallback(() => {
    if (Tone.getContext().state === "running") return Promise.resolve();

    if (!unlockPromise.current) {
      unlockPromise.current = Tone.start()
        .then(() => {
          if (Tone.getContext().state !== "running") {
            throw new Error("Audio is still suspended. Press a key again.");
          }
        })
        .finally(() => {
          unlockPromise.current = null;
        });
    }

    return unlockPromise.current;
  }, []);

  const initAudio = useCallback(() => {
    if (audio.current) return audio.current;

    const d = distance / 100;
    const limiter = new Tone.Limiter(-1).toDestination();
    const masterGain = new Tone.Gain(master / 100).connect(limiter);

    const panNodeA = new Tone.Panner(-0.08 - d * 0.28).connect(masterGain);
    const presentGain = new Tone.Gain(0.9 - d * 0.42).connect(panNodeA);
    const delayNode = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.12 + d * 0.43,
      wet: 0.04 + d * 0.48,
    }).connect(presentGain);
    const chorusNode = new Tone.Chorus({
      frequency: 2.2,
      delayTime: 2.5,
      depth: 0.18 + d * 0.64,
      wet: 0.05 + d * 0.38,
    })
      .connect(delayNode)
      .start();
    const filterA = new Tone.Filter({
      frequency: 9000 - d * 7600,
      type: "lowpass",
      Q: 1.2 + d * 2.8,
    }).connect(chorusNode);
    const synthA = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.035, decay: 0.24, sustain: 0.58, release: 0.8 },
    }).connect(filterA);

    const panNodeB = new Tone.Panner(0.08 + d * 0.28).connect(masterGain);
    const memoryGain = new Tone.Gain(0.22 + d * 0.62).connect(panNodeB);
    const reverbNode = new Tone.Reverb({
      decay: 2.1 + d * 3.2,
      wet: 0.08 + d * 0.58,
    }).connect(memoryGain);
    const distortionNode = new Tone.Distortion({
      distortion: 0.05 + d * 0.55,
      wet: 0.64,
    }).connect(reverbNode);
    const filterB = new Tone.Filter({
      frequency: 2200 - d * 1550,
      type: "lowpass",
      Q: 4.5,
    }).connect(distortionNode);
    const synthB = new Tone.MonoSynth({
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.18, sustain: 0.32, release: 0.24 },
    }).connect(filterB);

    const loop = new Tone.Loop((time) => {
      const step = currentStep.current % 8;
      const traceNote = memoryNotesRef.current[step];
      setActiveStep(step);

      if (traceNote) {
        synthB.triggerAttackRelease(
          traceNote,
          "16n",
          time,
          step === 0 || step === 4 ? 0.86 : 0.68,
        );
      }

      currentStep.current = (step + 1) % 8;
    }, "8n");

    const transport = Tone.getTransport();
    transport.bpm.value = TEMPO;
    transport.swing = 0.02 + d * 0.34;
    transport.swingSubdivision = "8n";

    audio.current = {
      limiter,
      masterGain,
      panNodeA,
      presentGain,
      delayNode,
      chorusNode,
      filterA,
      synthA,
      panNodeB,
      memoryGain,
      reverbNode,
      distortionNode,
      filterB,
      synthB,
      loop,
    };

    setReady(true);
    return audio.current;
  }, [distance, master]);

  const recordTraceNote = useCallback((traceNote: string) => {
    const index = captureIndexRef.current;
    if (index < 0 || index > 7) return;

    const nextTrace = [...memoryNotesRef.current];
    nextTrace[index] = traceNote;
    memoryNotesRef.current = nextTrace;
    setMemoryNotes(nextTrace);

    const nextIndex = index + 1;
    if (nextIndex >= 8) {
      captureIndexRef.current = -1;
      setCaptureIndex(-1);
      setCapturing(false);
      return;
    }

    captureIndexRef.current = nextIndex;
    setCaptureIndex(nextIndex);
  }, []);

  const noteOn = useCallback(
    async (performanceKey: PerformanceKey) => {
      const { note, traceNote } = performanceKey;
      requestedNotes.current.add(note);
      setPressedNotes((current) =>
        current.includes(note) ? current : [...current, note],
      );
      recordTraceNote(traceNote);

      try {
        const unlock = unlockAudio();
        setAudioError("");
        await unlock;
        const currentAudio = initAudio();
        if (requestedNotes.current.has(note)) {
          currentAudio.synthA.triggerAttack(note);
        }
      } catch (error) {
        setAudioError(
          error instanceof Error ? error.message : "Audio could not start",
        );
      }
    },
    [initAudio, recordTraceNote, unlockAudio],
  );

  const noteOff = useCallback((note: string) => {
    requestedNotes.current.delete(note);
    setPressedNotes((current) => current.filter((item) => item !== note));
    audio.current?.synthA.triggerRelease(note);
  }, []);

  const beginCapture = useCallback(() => {
    const emptyTrace = [...EMPTY_TRACE];
    memoryNotesRef.current = emptyTrace;
    setMemoryNotes(emptyTrace);
    captureIndexRef.current = 0;
    setCaptureIndex(0);
    setCapturing(true);
  }, []);

  const holdCapture = useCallback(() => {
    captureIndexRef.current = -1;
    setCaptureIndex(-1);
    setCapturing(false);
  }, []);

  const clearTrace = useCallback(() => {
    const emptyTrace = [...EMPTY_TRACE];
    memoryNotesRef.current = emptyTrace;
    setMemoryNotes(emptyTrace);
    captureIndexRef.current = -1;
    setCaptureIndex(-1);
    setCapturing(false);
    audio.current?.synthB.triggerRelease();
  }, []);

  const startPlayback = useCallback(async () => {
    if (playing || starting.current) return;
    starting.current = true;

    try {
      const unlock = unlockAudio();
      setAudioError("");
      await unlock;
      const currentAudio = initAudio();
      currentStep.current = 0;
      currentAudio.loop.start(0);
      Tone.getTransport().start();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      setAudioError(
        error instanceof Error ? error.message : "Audio could not start",
      );
    } finally {
      starting.current = false;
    }
  }, [initAudio, playing, unlockAudio]);

  const stopPlayback = useCallback(() => {
    const currentAudio = audio.current;
    if (currentAudio) {
      Tone.getTransport().stop();
      currentAudio.loop.stop();
      currentAudio.synthB.triggerRelease();
    }

    currentStep.current = 0;
    setActiveStep(-1);
    setPlaying(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const performanceKey = KEY_MAP[event.key.toLowerCase()];
      if (!performanceKey || event.repeat || held.current.has(performanceKey.note)) {
        return;
      }

      held.current.add(performanceKey.note);
      void noteOn(performanceKey);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const performanceKey = KEY_MAP[event.key.toLowerCase()];
      if (!performanceKey) return;
      held.current.delete(performanceKey.note);
      noteOff(performanceKey.note);
    };

    const releaseAll = () => {
      held.current.clear();
      requestedNotes.current.clear();
      setPressedNotes([]);
      audio.current?.synthA.releaseAll();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseAll);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseAll);
    };
  }, [noteOff, noteOn]);

  useEffect(() => {
    const currentAudio = audio.current;
    if (!currentAudio) return;

    const d = distance / 100;
    currentAudio.presentGain.gain.rampTo(0.9 - d * 0.42, 0.08);
    currentAudio.memoryGain.gain.rampTo(0.22 + d * 0.62, 0.08);
    currentAudio.filterA.frequency.rampTo(9000 - d * 7600, 0.08);
    currentAudio.filterA.Q.rampTo(1.2 + d * 2.8, 0.08);
    currentAudio.chorusNode.wet.rampTo(0.05 + d * 0.38, 0.08);
    currentAudio.chorusNode.depth = 0.18 + d * 0.64;
    currentAudio.delayNode.wet.rampTo(0.04 + d * 0.48, 0.08);
    currentAudio.delayNode.feedback.rampTo(0.12 + d * 0.43, 0.08);
    currentAudio.panNodeA.pan.rampTo(-0.08 - d * 0.28, 0.08);
    currentAudio.filterB.frequency.rampTo(2200 - d * 1550, 0.08);
    currentAudio.distortionNode.distortion = 0.05 + d * 0.55;
    currentAudio.reverbNode.wet.rampTo(0.08 + d * 0.58, 0.08);
    currentAudio.panNodeB.pan.rampTo(0.08 + d * 0.28, 0.08);
    Tone.getTransport().swing = 0.02 + d * 0.34;
  }, [distance, ready]);

  useEffect(() => {
    audio.current?.masterGain.gain.rampTo(master / 100, 0.08);
  }, [master, ready]);

  useEffect(
    () => () => {
      const currentAudio = audio.current;

      try {
        currentAudio?.loop.stop();
        currentAudio?.loop.dispose();
        const transport = Tone.getTransport();
        transport.stop();
        transport.cancel(0);

        if (currentAudio) {
          [
            currentAudio.synthA,
            currentAudio.filterA,
            currentAudio.chorusNode,
            currentAudio.delayNode,
            currentAudio.presentGain,
            currentAudio.panNodeA,
            currentAudio.synthB,
            currentAudio.filterB,
            currentAudio.distortionNode,
            currentAudio.reverbNode,
            currentAudio.memoryGain,
            currentAudio.panNodeB,
            currentAudio.masterGain,
            currentAudio.limiter,
          ].forEach((node) => node.dispose?.());
        }
      } catch {
        // Tone nodes may already be disposed during a development hot reload.
      }

      audio.current = null;
    },
    [],
  );

  const recordedCount = memoryNotes.filter(Boolean).length;
  return (
    <main className="nachklang-stage">
      <section className="nachklang-shell" aria-label="NACHKLANG musical instrument">
        <header className="nachklang-header">
          <div className="nachklang-brand">
            <p className="nachklang-overline">TONWERK / INSTRUMENT 01</p>
            <h1>NACHKLANG</h1>
            <p className="nachklang-subtitle">an instrument for present and memory</p>
          </div>

          <div className="nachklang-status" aria-live="polite">
            <span className={`nachklang-status-light ${ready ? "is-ready" : ""}`} />
            <span>{ready ? "AUDIO READY" : "PRESS A KEY"}</span>
          </div>
        </header>

        <section className="distance-section" aria-labelledby="distance-title">
          <div className="distance-copy distance-copy-now">
            <span>01</span>
            <h2>NOW</h2>
            <p>what your hands make</p>
          </div>

          <label
            className="distance-control"
            style={
              {
                "--distance-position": `${distance}%`,
              } as React.CSSProperties
            }
          >
            <span className="distance-label" id="distance-title">DISTANCE</span>
            <span className="distance-rail" aria-hidden="true"><i /></span>
            <input
              className="distance-input"
              aria-label="Distance between present and memory"
              type="range"
              min="0"
              max="100"
              value={distance}
              onChange={(event) => setDistance(Number(event.target.value))}
            />
            <output className="distance-output">{distanceName(distance)}</output>
            <span className="distance-scale" aria-hidden="true">
              <b>NOW</b><b>TRACE</b><b>GONE</b>
            </span>
          </label>

          <div className="distance-copy distance-copy-trace">
            <span>02</span>
            <h2>TRACE</h2>
            <p>what the machine remembers</p>
          </div>
        </section>

        <section className="trace-section" aria-labelledby="trace-title">
          <header className="trace-header">
            <div><span>02 / MEMORY</span><h2 id="trace-title">TRACE</h2></div>
            <p aria-live="polite">
              {capturing
                ? `CAPTURING ${captureIndex + 1} OF 8`
                : recordedCount
                  ? `${recordedCount} NOTES HELD`
                  : "EMPTY — CAPTURE EIGHT NOTES"}
            </p>
          </header>

          <ol className="trace-cells" aria-label="Eight recorded trace notes">
            {memoryNotes.map((note, index) => (
              <li
                key={index}
                className={`${note ? "is-filled" : ""} ${activeStep === index ? "is-playing" : ""} ${captureIndex === index ? "is-armed" : ""}`}
                aria-current={activeStep === index ? "step" : undefined}
                aria-label={`Trace step ${index + 1}: ${note ?? "empty"}`}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{noteLabel(note)}</strong>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>
        </section>

        <section className="performance-section" aria-labelledby="now-title">
          <header className="performance-header">
            <div><span>01 / HANDS</span><h2 id="now-title">NOW</h2></div>
            <p>F MINOR / A S D F G H J K</p>
          </header>

          <div className="performance-keys" role="group" aria-label="F minor performance keys">
            {PERFORMANCE_KEYS.map((performanceKey) => {
              const pressed = pressedNotes.includes(performanceKey.note);

              return (
                <button
                  type="button"
                  key={performanceKey.note}
                  className={pressed ? "is-pressed" : ""}
                  aria-label={`${performanceKey.key}: play ${performanceKey.note}`}
                  aria-pressed={pressed}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    void noteOn(performanceKey);
                  }}
                  onPointerUp={() => noteOff(performanceKey.note)}
                  onPointerCancel={() => noteOff(performanceKey.note)}
                  onLostPointerCapture={() => noteOff(performanceKey.note)}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                      event.preventDefault();
                      void noteOn(performanceKey);
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      noteOff(performanceKey.note);
                    }
                  }}
                >
                  <span>{performanceKey.key}</span>
                  <strong>{performanceKey.label}</strong>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="nachklang-controls">
          <div className="transport-controls" aria-label="Transport controls">
            <button
              type="button"
              className={`transport-play ${playing ? "is-playing" : ""}`}
              aria-label="Play the trace"
              onPointerDown={() => { void unlockAudio().catch(() => {}); }}
              onClick={() => { void startPlayback(); }}
            >
              <i aria-hidden="true" /><span>{playing ? "PLAYING" : "PLAY"}</span>
            </button>
            <button type="button" className="transport-stop" aria-label="Stop the trace" onClick={stopPlayback}>
              <i aria-hidden="true" /><span>STOP</span>
            </button>
          </div>

          <div className="memory-controls" aria-label="Trace memory controls">
            <button
              type="button"
              className={`capture-button ${capturing ? "is-capturing" : ""}`}
              aria-pressed={capturing}
              onClick={capturing ? holdCapture : beginCapture}
            >
              <i aria-hidden="true" /><span>{capturing ? "HOLD" : "CAPTURE"}</span>
            </button>
            <button type="button" className="clear-button" onClick={clearTrace}>CLEAR TRACE</button>
          </div>

          <label className="master-control">
            <span>MASTER</span>
            <input
              aria-label="Master volume"
              type="range"
              min="0"
              max="100"
              value={master}
              onChange={(event) => setMaster(Number(event.target.value))}
            />
            <output>{master}</output>
          </label>

          <div className="tempo-mark" aria-label={`Fixed tempo ${TEMPO} beats per minute`}>
            <span>TEMPO</span><strong>{TEMPO}</strong><small>BPM</small>
          </div>
        </footer>

        {audioError ? <p className="nachklang-error" role="alert">{audioError}</p> : null}
      </section>
    </main>
  );
}
