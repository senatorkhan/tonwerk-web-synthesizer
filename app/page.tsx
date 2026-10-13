"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

type Wave = "sine" | "triangle" | "square" | "sawtooth";
type ADSR = { attack: number; decay: number; sustain: number; release: number };
type KnobSize = "small" | "medium" | "large" | "master";

const KEYS = [["A","C4",false],["W","C#4",true],["S","D4",false],["E","D#4",true],["D","E4",false],["F","F4",false],["T","F#4",true],["G","G4",false],["Y","G#4",true],["H","A4",false],["U","A#4",true],["J","B4",false],["K","C5",false]] as const;
const KEY_MAP = Object.fromEntries(KEYS.map(([key,note])=>[key.toLowerCase(),note]));
const PULSE_NOTES = ["F2","Ab2","C3","Bb2","Db3","C3","G2","Ab2"];
const RATE_VALUES = ["4n","8n","16n","32n"] as const;
const RATE_LABELS = ["1/4","1/8","1/16","1/32"];

function Knob({label,value,min=0,max=100,step=1,unit="",display,size="medium",accent=false,onChange}:{label:string;value:number;min?:number;max?:number;step?:number;unit?:string;display?:string;size?:KnobSize;accent?:boolean;onChange:(v:number)=>void}) {
  const ratio=(value-min)/(max-min),angle=-135+ratio*270;
  return <label className={`knob-control knob-${size} ${accent?"knob-accent":""}`}>
    <span className="knob-scale" style={{"--turn":`${angle}deg`,"--level":`${ratio*270}deg`} as React.CSSProperties}>
      <span className="knob"><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/><i/></span>
    </span>
    <span className="control-label">{label}</span>
    <output>{display??`${Number.isInteger(value)?value:value.toFixed(1)}${unit}`}</output>
  </label>;
}

function MiniSlider({label,value,max=1,onChange}:{label:string;value:number;max?:number;onChange:(v:number)=>void}) {
  return <label className="mini-slider"><span className="slider-track"><input aria-label={label} type="range" min="0" max={max} step="0.01" value={value} onChange={e=>onChange(Number(e.target.value))}/></span><span>{label}</span><output>{value.toFixed(2)}</output></label>;
}

function ShapeControl({value,onChange,pulse=false}:{value:Wave;onChange:(w:Wave)=>void;pulse?:boolean}) {
  const waves:{id:Wave;mark:string}[]=pulse?[{id:"triangle",mark:"⌃"},{id:"sawtooth",mark:"⌁"},{id:"square",mark:"⊓"}]:[{id:"sine",mark:"⌃"},{id:"triangle",mark:"⌁"},{id:"square",mark:"⊓"}];
  const index=Math.max(0,waves.findIndex(w=>w.id===value));
  return <div className="shape-control">
    <Knob label="SHAPE" value={index} min={0} max={2} size="large" display={waves[index].id.toUpperCase()} onChange={v=>onChange(waves[Math.round(v)].id)}/>
    <div className="wave-marks" role="group" aria-label="Waveform">{waves.map(w=><button type="button" key={w.id} aria-label={w.id} aria-pressed={value===w.id} className={value===w.id?"selected":""} onClick={()=>onChange(w.id)}><i/>{w.mark}</button>)}</div>
  </div>;
}

function PanSlider({value,onChange}:{value:number;onChange:(v:number)=>void}) {
  return <label className="pan-slider"><span className="pan-track"><input aria-label="Pan" type="range" min="-100" max="100" value={value} onChange={e=>onChange(Number(e.target.value))}/></span><span className="pan-ends"><b>L</b><b>R</b></span><output>{value}</output></label>;
}

export default function Home() {
  const [ready,setReady]=useState(false),[playing,setPlaying]=useState(false),[activeStep,setActiveStep]=useState(-1);
  const [audioError,setAudioError]=useState("");
  const [steps,setSteps]=useState([true,true,true,true,true,true,true,true]);
  const [bpm,setBpm]=useState(90),[swing,setSwing]=useState(0),[length,setLength]=useState(8),[rate,setRate]=useState(1);
  const [waveA,setWaveA]=useState<Wave>("triangle"),[waveB,setWaveB]=useState<Wave>("square");
  const [pitchA,setPitchA]=useState(0),[pitchB,setPitchB]=useState(0);
  const [cutA,setCutA]=useState(64),[resA,setResA]=useState(3.2),[panA,setPanA]=useState(-18),[chorus,setChorus]=useState(28),[delay,setDelay]=useState(24),[mixA,setMixA]=useState(66);
  const [cutB,setCutB]=useState(42),[resB,setResB]=useState(5.5),[panB,setPanB]=useState(22),[drive,setDrive]=useState(18),[space,setSpace]=useState(20),[mixB,setMixB]=useState(58);
  const [master,setMaster]=useState(72),[character,setCharacter]=useState(38);
  const [adsrA,setAdsrA]=useState<ADSR>({attack:.04,decay:.22,sustain:.62,release:.7});
  const [adsrB,setAdsrB]=useState<ADSR>({attack:.01,decay:.18,sustain:.32,release:.24});
  const audio=useRef<any>(null),held=useRef(new Set<string>()),requestedNotes=useRef(new Set<string>()),currentStep=useRef(0);
  const unlockPromise=useRef<Promise<void>|null>(null),starting=useRef(false);
  const stepPattern=useRef(steps),sequenceLength=useRef(length);

  const unlockAudio=useCallback(()=>{
    if(Tone.getContext().state==="running")return Promise.resolve();
    if(!unlockPromise.current){unlockPromise.current=Tone.start().then(()=>{if(Tone.getContext().state!=="running")throw new Error("Audio is still suspended. Click Play again.")}).finally(()=>{unlockPromise.current=null})}
    return unlockPromise.current;
  },[]);

  const initAudio=useCallback(()=>{
    if(audio.current)return audio.current;
    const limiter=new Tone.Limiter(-1).toDestination(),masterGain=new Tone.Gain(master/100).connect(limiter);
    const panNodeA=new Tone.Panner(panA/100).connect(masterGain),delayNode=new Tone.FeedbackDelay("8n",.24).connect(panNodeA);
    const chorusNode=new Tone.Chorus(2.2,2.5,.35).connect(delayNode).start(),filterA=new Tone.Filter(3200,"lowpass").connect(chorusNode);
    const synthA=new Tone.PolySynth(Tone.Synth,{oscillator:{type:waveA},envelope:adsrA}).connect(filterA);
    const panNodeB=new Tone.Panner(panB/100).connect(masterGain),reverbNode=new Tone.Reverb({decay:2.2,wet:.2}).connect(panNodeB);
    const distortionNode=new Tone.Distortion(.18).connect(reverbNode),filterB=new Tone.Filter(1500,"lowpass").connect(distortionNode);
    const synthB=new Tone.MonoSynth({oscillator:{type:waveB},envelope:adsrB}).connect(filterB);
    const loop=new Tone.Loop(time=>{const i=currentStep.current%sequenceLength.current;setActiveStep(i);if(stepPattern.current[i])synthB.triggerAttackRelease(PULSE_NOTES[i],"16n",time,i===0||i===4?.86:.7);currentStep.current=(i+1)%sequenceLength.current},RATE_VALUES[rate]);
    audio.current={Tone,limiter,masterGain,panNodeA,delayNode,chorusNode,filterA,synthA,panNodeB,reverbNode,distortionNode,filterB,synthB,loop};
    Tone.getTransport().bpm.value=bpm;Tone.getTransport().swing=swing/100;Tone.getTransport().swingSubdivision="8n";setReady(true);return audio.current;
  },[adsrA,adsrB,bpm,master,panA,panB,rate,swing,waveA,waveB]);

  const noteOn=useCallback(async(note:string)=>{requestedNotes.current.add(note);try{const unlock=unlockAudio();setAudioError("");await unlock;const a=initAudio();if(requestedNotes.current.has(note))a.synthA.triggerAttack(note)}catch(error){setAudioError(error instanceof Error?error.message:"Audio could not start")}},[initAudio,unlockAudio]);
  const noteOff=useCallback((note:string)=>{requestedNotes.current.delete(note);audio.current?.synthA.triggerRelease(note)},[]);
  const stopPlayback=useCallback(()=>{const a=audio.current;if(!a)return;a.Tone.getTransport().stop();a.loop.stop();a.synthB.triggerRelease();currentStep.current=0;setActiveStep(-1);setPlaying(false)},[]);
  const startPlayback=async()=>{if(playing||starting.current)return;starting.current=true;try{const unlock=unlockAudio();setAudioError("");await unlock;const a=initAudio();currentStep.current=0;a.loop.start(0);a.Tone.getTransport().start();setPlaying(true)}catch(error){setPlaying(false);setAudioError(error instanceof Error?error.message:"Audio could not start")}finally{starting.current=false}};
  const resetPatch=()=>{setPitchA(0);setPitchB(0);setWaveA("triangle");setWaveB("square");setCutA(64);setResA(3.2);setPanA(-18);setChorus(28);setDelay(24);setMixA(66);setCutB(42);setResB(5.5);setPanB(22);setDrive(18);setSpace(20);setMixB(58);setSteps([true,true,true,true,true,true,true,true]);setBpm(90);setSwing(0);setLength(8);setRate(1);setMaster(72);setCharacter(38)};

  useEffect(()=>{const down=(e:KeyboardEvent)=>{const note=KEY_MAP[e.key.toLowerCase()];if(!note||e.repeat||held.current.has(note))return;held.current.add(note);noteOn(note)};const up=(e:KeyboardEvent)=>{const note=KEY_MAP[e.key.toLowerCase()];if(!note)return;held.current.delete(note);noteOff(note)};const blur=()=>{held.current.clear();requestedNotes.current.clear();audio.current?.synthA.releaseAll()};window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",blur);return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",blur)}},[noteOn,noteOff]);
  useEffect(()=>{const a=audio.current;if(!a)return;a.Tone.getTransport().bpm.rampTo(bpm,.1);a.Tone.getTransport().swing=swing/100;a.loop.interval=RATE_VALUES[rate]},[bpm,swing,rate,ready]);
  useEffect(()=>{stepPattern.current=steps;sequenceLength.current=length;if(currentStep.current>=length)currentStep.current=0;setActiveStep(prev=>prev>=length?-1:prev)},[steps,length]);
  useEffect(()=>{const a=audio.current;if(!a)return;const warmth=character/100;a.synthA.set({oscillator:{type:waveA},envelope:adsrA,detune:pitchA*1200});a.filterA.frequency.rampTo((180*Math.pow(70,cutA/100))*(1-warmth*.28),.05);a.filterA.Q.value=resA;a.panNodeA.pan.rampTo(panA/100,.05);a.chorusNode.wet.rampTo((chorus/100)*(mixA/100),.05);a.delayNode.wet.rampTo((delay/100)*(mixA/100),.05);a.delayNode.feedback.value=.08+delay/250},[waveA,adsrA,pitchA,cutA,resA,panA,chorus,delay,mixA,character,ready]);
  useEffect(()=>{const a=audio.current;if(!a)return;const warmth=character/100;a.synthB.set({oscillator:{type:waveB},envelope:adsrB,detune:pitchB*1200});a.filterB.frequency.rampTo(120*Math.pow(65,cutB/100),.05);a.filterB.Q.value=resB;a.panNodeB.pan.rampTo(panB/100,.05);a.distortionNode.distortion=Math.min(.75,drive/100+warmth*.3);a.distortionNode.wet.rampTo(mixB/100,.05);a.reverbNode.wet.rampTo((space/100)*(mixB/100),.05)},[waveB,adsrB,pitchB,cutB,resB,panB,drive,space,mixB,character,ready]);
  useEffect(()=>{const a=audio.current;if(!a)return;const warmth=character/100;a.masterGain.gain.rampTo(master/100,.05);a.chorusNode.depth=.2+warmth*.65},[master,character,ready]);
  useEffect(()=>()=>{const a=audio.current;try{a?.loop.stop();a?.loop.dispose();const transport=Tone.getTransport();transport.stop();transport.cancel(0);if(a)[a.synthA,a.filterA,a.chorusNode,a.delayNode,a.panNodeA,a.synthB,a.filterB,a.distortionNode,a.reverbNode,a.panNodeB,a.masterGain,a.limiter].forEach((node:any)=>node.dispose?.())}catch{}audio.current=null},[]);

  const envelope=(adsr:ADSR,set:(v:ADSR)=>void)=><div className="envelope-bank"><h3>ENVELOPE</h3><div className="sliders"><MiniSlider label="A" value={adsr.attack} max={1.5} onChange={v=>set({...adsr,attack:v})}/><MiniSlider label="D" value={adsr.decay} max={1.5} onChange={v=>set({...adsr,decay:v})}/><MiniSlider label="S" value={adsr.sustain} onChange={v=>set({...adsr,sustain:v})}/><MiniSlider label="R" value={adsr.release} max={2} onChange={v=>set({...adsr,release:v})}/></div></div>;

  const voicePanel=(voice:"A"|"B")=>{
    const isA=voice==="A";
    const pitch=isA?pitchA:pitchB;
    return <article className={`voice-panel voice-${voice.toLowerCase()}`}>
      <header className="voice-title"><span className="voice-letter">{voice}</span><div><h2>{isA?"TONE":"PULSE"}</h2><p>{isA?"melodic voice":"rhythmic voice"}</p></div></header>
      <div className="voice-body">
        <section className="oscillator-bank"><h3>OSCILLATOR</h3><div className="control-pair"><Knob label="PITCH" value={pitch} min={-1} max={1} size="large" display={`${pitch>0?"+":""}${pitch} OCT`} onChange={isA?setPitchA:setPitchB}/><ShapeControl value={isA?waveA:waveB} onChange={isA?setWaveA:setWaveB} pulse={!isA}/></div></section>
        {isA?envelope(adsrA,setAdsrA):envelope(adsrB,setAdsrB)}
        <section className="filter-bank"><h3>FILTER</h3><div className="control-pair"><Knob label="CUTOFF" value={isA?cutA:cutB} size="large" accent={!isA} onChange={isA?setCutA:setCutB}/><Knob label="RESONANCE" value={isA?resA:resB} min={.5} max={12} step={.1} size="large" onChange={isA?setResA:setResB}/></div></section>
        <section className="effects-bank"><h3>EFFECTS</h3><div className="effect-controls">{isA?<><Knob label="CHORUS" value={chorus} size="small" onChange={setChorus}/><Knob label="DELAY" value={delay} size="small" onChange={setDelay}/><Knob label="MIX" value={mixA} size="small" accent onChange={setMixA}/></>:<><Knob label="DRIVE" value={drive} size="small" accent onChange={setDrive}/><Knob label="REVERB" value={space} size="small" onChange={setSpace}/><Knob label="MIX" value={mixB} size="small" accent onChange={setMixB}/></>}</div></section>
        <section className="pan-bank"><h3>PAN</h3><PanSlider value={isA?panA:panB} onChange={isA?setPanA:setPanB}/></section>
      </div>
    </article>;
  };

  return <main className="stage"><section className="synth-shell">
    <header className="topbar">
      <div className="brand"><h1>TONWERK</h1><p>WEB SYNTHESIZER</p></div>
      <div className="preset"><span>PRESET</span><div><button type="button" onClick={resetPatch} aria-label="Previous preset">‹</button><b>Я СОШЛА С УМА</b><button type="button" onClick={resetPatch} aria-label="Next preset">›</button></div></div>
      <div className="character-cluster"><div className="character-meter"><span>CHARACTER</span><i><b style={{width:`${character}%`}}/></i></div><Knob label="CHARACTER" value={character} size="medium" accent onChange={setCharacter}/><span className={`power-light ${ready?"on":""} ${audioError?"error":""}`} title={audioError||"Audio status"}/></div>
    </header>

    <section className="voices">{voicePanel("A")}{voicePanel("B")}</section>

    <section className="sequencer-strip">
      <div className="sequence-label"><h3>SEQUENCER</h3><p>8 STEPS</p></div>
      <div className="steps">{steps.map((active,i)=><button type="button" key={i} disabled={i>=length} aria-pressed={active} onClick={()=>setSteps(prev=>prev.map((v,n)=>n===i?!v:v))} className={`${active?"active":""} ${activeStep===i?"playing":""}`}><i/><span>{i+1}</span></button>)}</div>
      <div className="sequence-controls"><Knob label="RATE" value={rate} min={0} max={3} size="medium" display={RATE_LABELS[rate]} onChange={v=>setRate(Math.round(v))}/><Knob label="SWING" value={swing} min={0} max={65} size="medium" accent display={`${swing}%`} onChange={setSwing}/><Knob label="LENGTH" value={length} min={1} max={8} size="medium" display={`${length}`} onChange={setLength}/></div>
    </section>

    <section className="bottom-strip">
      <div className="keyboard-block"><div className="bottom-label"><h3>KEYBOARD</h3><p>C4 — C5</p></div><div className="keys">{KEYS.map(([key,note,black])=><button type="button" key={note} aria-label={`${key}: ${note}`} className={black?"black":"white"} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);noteOn(note)}} onPointerUp={()=>noteOff(note)} onPointerCancel={()=>noteOff(note)} onLostPointerCapture={()=>noteOff(note)}><span>{key}</span></button>)}</div></div>
      <div className="transport-block"><button type="button" className={`round-button play ${playing?"active":""}`} aria-label="Play" onPointerDown={()=>{void unlockAudio().catch(()=>{})}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")void unlockAudio().catch(()=>{})}} onClick={()=>{void startPlayback()}}>▶</button><button type="button" className="round-button stop" aria-label="Stop" onClick={stopPlayback}><i aria-hidden="true"/></button><button type="button" className="round-button panic" aria-label="Release all notes" onClick={()=>{requestedNotes.current.clear();const a=audio.current;a?.synthA.releaseAll();a?.synthB.triggerRelease()}}><i/></button><label className="bpm-input"><span>BPM</span><input type="number" min="60" max="180" value={bpm} onChange={e=>setBpm(Math.max(60,Math.min(180,Number(e.target.value))))}/></label></div>
      <div className="master-block"><span>MASTER</span><Knob label="VOLUME" value={master} size="master" accent onChange={setMaster}/><button type="button" className="reset-button" aria-label="Reset patch" title="Reset patch" onClick={resetPatch}>⚙</button></div>
    </section>
  </section></main>;
}
