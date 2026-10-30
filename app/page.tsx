"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type DialPhase = "idle" | "dialing" | "returning";

type LineAudio = {
  limiter: Tone.Limiter;
  masterGain: Tone.Gain;
  filter: Tone.Filter;
  delay: Tone.FeedbackDelay;
  reverb: Tone.Reverb;
  lineGain: Tone.Gain;
  signalGain: Tone.Gain;
  linePan: Tone.Panner;
  signalPan: Tone.Panner;
  lineSynth: Tone.PolySynth;
  signalSynth: Tone.Synth;
  loop: Tone.Loop;
};

const DIAL_DIGITS: Digit[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const MAX_DIGITS = 6;
const TEMPO = 72;
const LINE_FREQUENCY = 425;

// A symmetrical pentatonic family tuned around the 425 Hz line signal.
const DIGIT_FREQUENCIES: Record<Digit, number> = {
  "0": 425,
  "1": 505,
  "2": 567,
  "3": 637,
  "4": 757,
  "5": 850,
  "6": 757,
  "7": 637,
  "8": 567,
  "9": 505,
};

function pulseCount(digit: Digit) {
  return digit === "0" ? 10 : Number(digit);
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [digits, setDigits] = useState<Digit[]>([]);
  const [activeStep, setActiveStep] = useState(-1);
  const [dialPhase, setDialPhase] = useState<DialPhase>("idle");
  const [activeDigit, setActiveDigit] = useState<Digit | null>(null);
  const [dialRotation, setDialRotation] = useState(0);
  const [lineHint, setLineHint] = useState("");
  const [distance, setDistance] = useState(24);
  const [master, setMaster] = useState(72);
  const [audioError, setAudioError] = useState("");

  const audio = useRef<LineAudio | null>(null);
  const digitsRef = useRef<Digit[]>([]);
  const currentStep = useRef(0);
  const dialPhaseRef = useRef<DialPhase>("idle");
  const lineOpenRef = useRef(false);
  const unlockPromise = useRef<Promise<void> | null>(null);
  const starting = useRef(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((item) => item !== timer);
      callback();
    }, delay);
    timers.current.push(timer);
    return timer;
  }, []);

  const unlockAudio = useCallback(() => {
    if (Tone.getContext().state === "running") return Promise.resolve();

    if (!unlockPromise.current) {
      unlockPromise.current = Tone.start()
        .then(() => {
          if (Tone.getContext().state !== "running") {
            throw new Error("Линия не открылась. Нажмите ещё раз.");
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
    const reverb = new Tone.Reverb({
      decay: 1.3 + d * 3.5,
      wet: 0.06 + d * 0.42,
    }).connect(masterGain);
    const delay = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.08 + d * 0.24,
      wet: 0.04 + d * 0.24,
    }).connect(reverb);
    const filter = new Tone.Filter({
      type: "lowpass",
      frequency: 2900 - d * 1350,
      Q: 0.75 + d * 1.1,
    }).connect(delay);

    const linePan = new Tone.Panner(-0.025 - d * 0.08).connect(filter);
    const signalPan = new Tone.Panner(0.025 + d * 0.08).connect(filter);
    const lineGain = new Tone.Gain(0.64).connect(linePan);
    const signalGain = new Tone.Gain(0.18).connect(signalPan);

    const lineSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.018, decay: 0.16, sustain: 0.28, release: 0.55 },
    }).connect(lineGain);
    const signalSynth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.055, sustain: 0.04, release: 0.08 },
    }).connect(signalGain);

    const loop = new Tone.Loop((time) => {
      const step = currentStep.current % MAX_DIGITS;
      const digit = digitsRef.current[step];

      Tone.Draw.schedule(() => {
        if (lineOpenRef.current) setActiveStep(step);
      }, time);

      if (digit) {
        const frequency = DIGIT_FREQUENCIES[digit];
        lineSynth.triggerAttackRelease(frequency, "8n", time, 0.72);

      }

      currentStep.current = (step + 1) % MAX_DIGITS;
    }, "4n");

    const transport = Tone.getTransport();
    transport.bpm.value = TEMPO;
    transport.swing = 0;
    transport.position = 0;

    audio.current = {
      limiter,
      masterGain,
      filter,
      delay,
      reverb,
      lineGain,
      signalGain,
      linePan,
      signalPan,
      lineSynth,
      signalSynth,
      loop,
    };
    setReady(true);
    return audio.current;
  }, [distance, master]);

  const updateDigits = useCallback((nextDigits: Digit[]) => {
    const normalized = nextDigits.slice(-MAX_DIGITS);
    digitsRef.current = normalized;
    setDigits(normalized);
  }, []);

  const stopLine = useCallback((withClick = true) => {
    const currentAudio = audio.current;
    const transport = Tone.getTransport();

    if (currentAudio) {
      transport.stop();
      transport.position = 0;
      currentAudio.loop.stop();
      currentAudio.loop.cancel(0);
      currentAudio.lineSynth.releaseAll();
      currentAudio.signalSynth.triggerRelease();

      if (withClick && Tone.getContext().state === "running") {
        currentAudio.signalSynth.triggerAttackRelease(LINE_FREQUENCY, "64n", Tone.now(), 0.34);
      }
    }

    lineOpenRef.current = false;
    currentStep.current = 0;
    setLineOpen(false);
    setActiveStep(-1);
    setLineHint("СВЯЗЬ ЗАВЕРШЕНА");
    later(() => setLineHint(""), 1200);
  }, [later]);

  const startLine = useCallback(async () => {
    if (starting.current || lineOpenRef.current) return;
    starting.current = true;

    try {
      const unlock = unlockAudio();
      setAudioError("");
      await unlock;
      const currentAudio = initAudio();

      if (digitsRef.current.length === 0) {
        currentAudio.lineSynth.triggerAttackRelease(LINE_FREQUENCY, 0.8, Tone.now(), 0.42);
        setLineHint("СИГНАЛ 425 ГЦ — НАБЕРИТЕ НОМЕР");
        later(() => setLineHint(""), 1700);
        return;
      }

      const transport = Tone.getTransport();
      transport.stop();
      transport.position = 0;
      currentAudio.loop.stop();
      currentAudio.loop.cancel(0);
      currentAudio.loop.start(0);
      currentStep.current = 0;
      lineOpenRef.current = true;
      setLineOpen(true);
      setActiveStep(0);
      setLineHint("");
      transport.start();
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Не удалось открыть линию.");
    } finally {
      starting.current = false;
    }
  }, [initAudio, later, unlockAudio]);

  const toggleLine = useCallback(() => {
    if (lineOpenRef.current) {
      stopLine();
      return;
    }

    void startLine();
  }, [startLine, stopLine]);

  const dialDigit = useCallback(async (digit: Digit) => {
    if (dialPhaseRef.current !== "idle") return;
    dialPhaseRef.current = "dialing";
    setDialPhase("dialing");
    setActiveDigit(digit);

    const pulses = pulseCount(digit);
    setDialRotation(24 + pulses * 21);

    try {
      const unlock = unlockAudio();
      setAudioError("");
      await unlock;
      const currentAudio = initAudio();

      later(() => {
        dialPhaseRef.current = "returning";
        setDialPhase("returning");
        setDialRotation(0);

        for (let index = 0; index < pulses; index += 1) {
          later(() => {
            if (dialPhaseRef.current === "returning") {
              currentAudio.signalSynth.triggerAttackRelease(
                LINE_FREQUENCY,
                "128n",
                Tone.now(),
                0.2,
              );
            }
          }, 15 + index * 47);
        }

        const returnDuration = 160 + pulses * 42;
        later(() => {
          updateDigits([...digitsRef.current, digit]);
          currentAudio.lineSynth.triggerAttackRelease(
            DIGIT_FREQUENCIES[digit],
            "8n",
            Tone.now(),
            0.62,
          );
          dialPhaseRef.current = "idle";
          setDialPhase("idle");
          setActiveDigit(null);
        }, returnDuration);
      }, 170);
    } catch (error) {
      dialPhaseRef.current = "idle";
      setDialPhase("idle");
      setActiveDigit(null);
      setDialRotation(0);
      setAudioError(error instanceof Error ? error.message : "Диск не отвечает.");
    }
  }, [initAudio, later, unlockAudio, updateDigits]);

  const clearNumber = useCallback(() => {
    clearTimers();
    audio.current?.signalSynth.triggerRelease(Tone.now());
    dialPhaseRef.current = "idle";
    setDialPhase("idle");
    setDialRotation(0);
    setActiveDigit(null);
    if (lineOpenRef.current) stopLine(false);
    updateDigits([]);
    setActiveStep(-1);
    setLineHint("НОМЕР СБРОШЕН");
    later(() => setLineHint(""), 1000);
  }, [clearTimers, later, stopLine, updateDigits]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (event.key === "Escape") {
        event.preventDefault();
        clearNumber();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input")) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        void dialDigit(event.key as Digit);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        toggleLine();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearNumber, dialDigit, toggleLine]);

  useEffect(() => {
    const currentAudio = audio.current;
    if (!currentAudio) return;

    const d = distance / 100;
    currentAudio.filter.frequency.rampTo(2900 - d * 1350, 0.12);
    currentAudio.filter.Q.rampTo(0.75 + d * 1.1, 0.12);
    currentAudio.delay.wet.rampTo(0.04 + d * 0.24, 0.12);
    currentAudio.delay.feedback.rampTo(0.08 + d * 0.24, 0.12);
    currentAudio.reverb.wet.rampTo(0.06 + d * 0.42, 0.12);
    currentAudio.linePan.pan.rampTo(-0.025 - d * 0.08, 0.12);
    currentAudio.signalPan.pan.rampTo(0.025 + d * 0.08, 0.12);
  }, [distance, ready]);

  useEffect(() => {
    audio.current?.masterGain.gain.rampTo(master / 100, 0.1);
  }, [master, ready]);

  useEffect(() => () => {
    clearTimers();
    const currentAudio = audio.current;
    if (!currentAudio) return;

    try {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel(0);
      currentAudio.loop.stop();
      currentAudio.loop.dispose();
      currentAudio.lineSynth.releaseAll();

      [
        currentAudio.lineSynth,
        currentAudio.signalSynth,
        currentAudio.lineGain,
        currentAudio.signalGain,
        currentAudio.linePan,
        currentAudio.signalPan,
        currentAudio.filter,
        currentAudio.delay,
        currentAudio.reverb,
        currentAudio.masterGain,
        currentAudio.limiter,
      ].forEach((node) => node.dispose());
    } catch {
      // Development hot reload can dispose Tone nodes before React cleanup.
    }

    audio.current = null;
  }, [clearTimers]);

  const status = useMemo(() => {
    if (lineHint) return lineHint;
    if (lineOpen) return "ЛИНИЯ ОТКРЫТА";
    if (dialPhase !== "idle") return `НАБОР ${activeDigit ?? ""}`;
    if (digits.length === MAX_DIGITS) return "НОМЕР ГОТОВ";
    if (digits.length > 0) return `НОМЕР ГОТОВ · ${digits.length}/${MAX_DIGITS}`;
    return "СВОБОДНО";
  }, [activeDigit, dialPhase, digits.length, lineHint, lineOpen]);

  const slots = Array.from({ length: MAX_DIGITS }, (_, index) => digits[index] ?? null);
  const handsetLabel = lineOpen
    ? "Положить трубку и остановить мелодию"
    : digits.length
      ? "Поднять трубку и запустить мелодию"
      : "Проверить сигнал линии 425 герц";

  return (
    <main className="line-stage">
      <section className={`line-shell ${lineOpen ? "is-open" : ""}`} aria-label="Музыкальный телефон ЛИНИЯ 425">
        <header className="phone-header">
          <div className="line-brand">
            <p>TONWERK / АППАРАТ 02</p>
            <h1>ЛИНИЯ <span>425</span></h1>
            <small>музыкальная связь с прошлым</small>
          </div>

          <div className="line-status" role="status" aria-live="polite">
            <i className={lineOpen || dialPhase !== "idle" ? "is-active" : ""} aria-hidden="true" />
            <div><span>СОСТОЯНИЕ</span><strong>{status}</strong></div>
          </div>
        </header>

        <button
          type="button"
          className={`handset-button ${lineOpen ? "is-open" : ""} ${lineHint.includes("425") ? "is-active" : ""}`}
          aria-label={handsetLabel}
          aria-pressed={lineOpen}
          disabled={dialPhase !== "idle"}
          onClick={toggleLine}
        >
          <span className="handset-cup handset-cup-left" aria-hidden="true"><i /></span>
          <span className="handset-grip">
            <b>{lineOpen ? "ПОЛОЖИТЬ ТРУБКУ" : "ПОДНЯТЬ ТРУБКУ"}</b>
            <small>{lineOpen ? "РАЗОРВАТЬ СВЯЗЬ" : "СЛУШАТЬ НОМЕР"}</small>
          </span>
          <span className="handset-cup handset-cup-right" aria-hidden="true"><i /></span>
        </button>

        <section className="phone-body">
          <div className="number-display" aria-label="Набранный номер">
            <span>НАБРАННЫЙ НОМЕР</span>
            <div className="number-slots" aria-live="polite">
              {slots.map((digit, index) => (
                <b
                  key={index}
                  className={`number-slot ${digit ? "is-active" : ""} ${lineOpen && activeStep === index ? "is-playing" : ""}`}
                >
                  {digit ?? "—"}
                </b>
              ))}
            </div>
            <small>{digits.length ? "ПРОБЕЛ — ТРУБКА" : "ПРИМЕР ДЛЯ НАБОРА: 12 04 61"}</small>
          </div>

          <div className="rotary-wrap" aria-label="Дисковый номеронабиратель">
            <div
              className={`rotary-dial ${dialPhase === "dialing" ? "is-dialing" : ""} ${dialPhase === "returning" ? "is-returning" : ""}`}
              style={
                {
                  "--dial-rotation": `${dialRotation}deg`,
                  "--dial-counter-rotation": `${-dialRotation}deg`,
                  "--dial-duration": `${activeDigit ? 160 + pulseCount(activeDigit) * 42 : 540}ms`,
                } as React.CSSProperties
              }
            >
              {DIAL_DIGITS.map((digit, index) => (
                <button
                  type="button"
                  key={digit}
                  className={`dial-number ${activeDigit === digit ? "is-active" : ""}`}
                  style={
                    {
                      "--digit-angle": `${-48 + index * 36}deg`,
                      "--digit-counter-angle": `${48 - index * 36}deg`,
                    } as React.CSSProperties
                  }
                  aria-label={`Набрать цифру ${digit}`}
                  disabled={dialPhase !== "idle"}
                  onClick={() => { void dialDigit(digit); }}
                >
                  <span>{digit}</span>
                </button>
              ))}

              <div className="dial-center" aria-hidden="true">
                <span>ЛИНИЯ</span><strong>425</strong><small>ГЦ</small>
              </div>
            </div>
            <span className="dial-stop" aria-hidden="true"><i /></span>
          </div>

          <div className="phone-controls">
            <label className="distance-control">
              <span>ДАЛЬНОСТЬ</span>
              <input
                type="range"
                min="0"
                max="100"
                value={distance}
                aria-label="Дальность линии"
                onChange={(event) => setDistance(Number(event.target.value))}
              />
              <small><b>БЛИЗКО</b><b>ДАЛЕКО</b></small>
            </label>

            <button
              type="button"
              className="clear-button"
              disabled={digits.length === 0 && !lineOpen}
              onClick={clearNumber}
            >
              СБРОС НОМЕРА
            </button>

            <label className="master-control">
              <span>ГРОМКОСТЬ</span>
              <input
                type="range"
                min="0"
                max="100"
                value={master}
                aria-label="Громкость"
                onChange={(event) => setMaster(Number(event.target.value))}
              />
              <output>{master}</output>
            </label>
          </div>
        </section>

        <footer className="line-footer">
          <span>ЦИФРЫ 0–9 — НАБОР</span>
          <span>SPACE — ТРУБКА</span>
          <span>ESC — СБРОС</span>
          <strong>{TEMPO} УД/МИН</strong>
        </footer>

        {audioError ? <p className="line-error" role="alert">{audioError}</p> : null}
      </section>
    </main>
  );
}
