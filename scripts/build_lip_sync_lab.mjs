import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Processor} from '../src/lip-sync-lab/vendor/headaudio/processor.mjs';
import {Training} from '../src/lip-sync-lab/vendor/headaudio/training.mjs';
import {FrequencyAnalyzer} from '../src/lip-sync-lab/vendor/frequency/FrequencyAnalyzer.js';
import {dictionaryVisemes} from '../src/dictionary_visemes.js';
import {CHANNELS,RHUBARB,OCULUS,DICTIONARY,LEGACY,boundedWeights,arkitToMouth} from '../src/lip-sync-lab/mouth-adapters.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.runtime/lip-sync-lab');
const destination = path.join(root, 'src/lip-sync-lab');
const read = name => JSON.parse(fs.readFileSync(path.join(work, name), 'utf8'));
const inputs = read('inputs.json');
const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'src/dictionary/cmudict.json'), 'utf8'));
const batches = fs.existsSync(path.join(work, 'rhubarb-batches.json')) ? read('rhubarb-batches.json') : null;
const neural = fs.existsSync(path.join(work, 'lam-results.json')) ? read('lam-results.json') : null;
const neuralOrder = JSON.parse(fs.readFileSync(path.join(destination, 'lam-channel-order.json'), 'utf8'));
const zero = () => CHANNELS.map(() => 0);
const fps = 60;
let clock = 0;
const realPerformance = globalThis.performance;
Object.defineProperty(globalThis, 'performance', {value:{now:()=>clock*1000}, configurable:true});

function targetAt(cues, mapping, time, pulse=false) {
  const result = zero();
  for (const cue of cues) {
    if (time < cue.start || time > cue.end || cue.end === cue.start) continue;
    let pose = mapping[cue.value];
    if (!pose) continue;
    if (typeof pose === 'string') pose = CHANNELS.map(name => Number(name === pose));
    const strength = pulse ? 1 - Math.abs(2*(time-cue.start)/(cue.end-cue.start)-1) : 1;
    pose.forEach((value,i)=>{result[i]=Math.max(result[i], value*strength);});
  }
  return result;
}

function curve(cues, mapping, duration, {pulse=false, smooth=true}={}) {
  const frames = [];
  for (let i=0;i<=Math.ceil(duration*fps);i++) {
    const t=i/fps;
    let weights=targetAt(cues,mapping,t,pulse);
    if (smooth && !pulse) {
      const before=targetAt(cues,mapping,Math.max(0,t-.02));
      const after=targetAt(cues,mapping,Math.min(duration,t+.02));
      weights=weights.map((v,j)=>(before[j]+2*v+after[j])/4);
    }
    frames.push(boundedWeights(weights).map(v=>Number(v.toFixed(5))));
  }
  frames[frames.length-1]=zero();
  return frames;
}

function eventsToCues(events,duration) {
  return events.sort((a,b)=>a.t-b.t).map((event,i)=>({value:event.value,
    start:Math.max(0,event.t),end:Math.min(duration,events[i+1]?.t ?? duration)}))
    .filter(cue=>cue.end>cue.start);
}

const modelData = fs.readFileSync(path.join(destination,'vendor/headaudio/model-en-mixed.bin'));
const training = new Training();
const model = await training.loadModel('data:application/octet-stream;base64,'+modelData.toString('base64'));

function analyser(spectra,size) {
  return {fftSize:size,smoothingTimeConstant:.8,index:0,
    get frequencyBinCount(){return this.fftSize/2;},
    getByteFrequencyData(output){output.set(spectra[String(this.fftSize)][this.index].frequency);},
    getByteTimeDomainData(output){output.set(spectra[String(this.fftSize)][this.index].timeDomain);},
    connect(){},disconnect(){}};
}

let fakeAnalyser;
globalThis.window={AudioContext:class {
  sampleRate=44100;
  createAnalyser(){return fakeAnalyser;}
}};
const {Lipsync}=await import('../src/lip-sync-lab/vendor/wawa/lipsync.ts');
const measurements={};
const cases=[];
for (const input of inputs) {
  const started=realPerformance.now();
  const variants={};
  variants.legacy=curve(input.rhubarb,LEGACY,input.duration,{pulse:true,smooth:false});
  variants.rhubarb=curve(input.rhubarb,RHUBARB,input.duration);
  if (batches) variants['rhubarb-batches']=curve(batches[input.id].cues,RHUBARB,input.duration);
  const words=input.timestamps.map(stamp=>({...stamp,word:stamp.word.replaceAll('’',"'").replace(/^[^a-zA-Z]+|[^a-zA-Z']+$/g,'')}));
  const estimated=dictionaryVisemes(words,dictionary,input.duration);
  variants.dictionary=curve(estimated,DICTIONARY,input.duration);
  const unknown=words.filter(stamp=>/[a-z]/i.test(stamp.word) && !dictionary[stamp.word.toUpperCase()]).map(s=>s.word);

  // Use the real upstream processor/classifier, with its offline test hook.
  const events=[{t:0,value:'sil'}];
  const visemes=['aa','E','I','O','U','PP','SS','TH','DD','FF','kk','nn','RR','CH','sil'];
  const processor=new Processor({sampleRate:input.sampleRate,parameterData:{silMode:0}},
    {port:{postMessage(message){
      if(message.event==='viseme' && message.viseme!==null) events.push({t:message.t,value:visemes[message.viseme]});
      if(message.event==='ended') events.push({t:message.t,value:'sil'});
    }}});
  processor._onmessage({data:{event:'model',model:model.model}});
  const pcm=fs.readFileSync(path.join(work,input.id+'.pcm'));
  const waveform=Float32Array.from({length:pcm.length/2},(_,i)=>pcm.readInt16LE(i*2)/32768);
  for(let i=0;i<waveform.length;i+=128)processor.process(waveform.subarray(i,i+128));
  variants.headaudio=curve(eventsToCues(events,input.duration),OCULUS,input.duration);

  const spectra=read(input.id+'-spectra.json');
  fakeAnalyser=analyser(spectra,2048);clock=0;
  const wawa=new Lipsync();
  const bandAnalyser=analyser(spectra,256);
  const frequency=new FrequencyAnalyzer(bandAnalyser,input.sampleRate);
  const wawaEvents=[],bandEvents=[],amplitude=[];
  for(let i=0;i<variants.rhubarb.length;i++) {
    clock=i/fps;fakeAnalyser.index=i;bandAnalyser.index=i;
    wawa.processAudio();wawaEvents.push({t:clock,value:wawa.viseme.replace(/^viseme_/, '')});
    const detected=frequency.analyze();bandEvents.push({t:clock,value:detected.viseme});
    const end=Math.min(waveform.length,Math.round(clock*input.sampleRate));
    const samples=waveform.subarray(Math.max(0,end-1024),end);
    const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/Math.max(1,samples.length));
    amplitude.push([Math.min(.75,Math.max(0,(rms-.01)*4)),0,0,0,0,0]);
  }
  variants.wawa=curve(eventsToCues(wawaEvents,input.duration),OCULUS,input.duration);
  variants.frequency=curve(eventsToCues(bandEvents,input.duration),OCULUS,input.duration);
  variants.amplitude=amplitude;
  if(neural) {
    const raw=neural.cases[input.id].frames;
    const converted=raw.map(coefficients=>arkitToMouth(coefficients,neuralOrder.names));
    variants.lam=Array.from({length:variants.rhubarb.length},(_,i)=>{
      const position=i/2,left=Math.min(converted.length-1,Math.floor(position)),right=Math.min(converted.length-1,left+1);
      return converted[left].map((v,j)=>Number((v*(1-position%1)+converted[right][j]*(position%1)).toFixed(5)));
    });
    fs.writeFileSync(path.join(destination,input.id+'-lam-raw.json'),JSON.stringify({fps:30,names:neuralOrder.names,frames:raw}));
  }
  for(const frames of Object.values(variants))frames[frames.length-1]=zero();
  measurements[input.id]={preparationMilliseconds:realPerformance.now()-started,headAudioEvents:events.length,unknownDictionaryWords:unknown};
  const file=input.id+'.json';
  fs.writeFileSync(path.join(destination,file),JSON.stringify({fps,channels:CHANNELS,duration:input.duration,variants}));
  cases.push({...input,rhubarb:undefined,timestamps:undefined,data:'/lip-sync-lab/'+file});
}
const methods=[
 {id:'rhubarb',label:'Rhubarb · corrected & blended',notes:'Same recorded Rhubarb cues, source-correct shapes and 40ms transition blending. No re-analysis.'},
 {id:'legacy',label:'Current renderer · reference',notes:'Current letter mapping and triangular pulses. Includes the known Rhubarb alphabet mismatch.'},
 ...(batches?[{id:'rhubarb-batches',label:'Rhubarb · short overlapping batches',notes:'One-second retained regions, ±250ms context, one worker. Same corrected adapter. Compare seams and pronunciation loss.'}]:[]),
 {id:'dictionary',label:'Dictionary · estimated timing',notes:'CMU phones split evenly inside saved word timestamps. This is an approximation, not Kokoro-native phone durations.'},
 {id:'headaudio',label:'HeadAudio · MFCC classifier',notes:'Upstream model and processor run offline; 15 source visemes projected onto Asena. Source frame-centre timestamps are retained; live buffering is not measured.'},
 {id:'wawa',label:'Wawa · frequency heuristic',notes:'Upstream Wawa algorithm on emulated Web Audio spectra. 2048 FFT, default smoothing, 60fps analysis.'},
 {id:'frequency',label:'lipsync-engine · frequency bands',notes:'Upstream FrequencyAnalyzer on emulated Web Audio inputs. 256 FFT, default controls. Its separate A–F alphabet is not used.'},
 {id:'amplitude',label:'Amplitude only · simple control',notes:'Energy opens one vowel. Included to reveal timing versus articulation; it cannot distinguish sounds.'},
 ...(neural?[{id:'lam',label:'LAM · neural continuous weights',notes:'One-second fixed ONNX windows, 500ms hop, overlapped predictions. Provisional 52-channel-to-VRoid adapter; eye and brow coefficients are excluded.'}]:[])
];
const manifest={version:1,prepared:'2026-10-12',voice:'Kokoro af_heart',cases,methods,measurements,
 rhubarbBatches:batches,neural:neural?{provenance:neural.provenance,channelOrder:neuralOrder,onnxruntime:neural.onnxruntime,peakRssBytes:neural.peakRssBytes,windowSeconds:1,hopSeconds:.5}:null,
 unavailable:[
  {name:'Kokoro native phone durations / HeadTTS',reason:'Saved fixtures contain words, not synthesis duration tensors. A matching metadata capture would require a separately prepared Kokoro run; guessed durations are not presented as native.'},
  ...(!neural?[{name:'LAM neural export',reason:'See the bounded probe report; no neural sample is substituted or fabricated.'}]:[]),
  {name:'SG Com',reason:'Commercial SDK access/licensing needed; no account or purchase arranged.'},
  {name:'MetaHuman Realistic / uLipSync',reason:'Unreal/Unity integrations; no compatible standalone Asena solver verified. Installing either engine is outside this removable small test.'},
  {name:'NeuroSync',reason:'Gated model and unverified maintained local API. No licence acceptance or account setup.'},
  {name:'Audio2Face Swift/MLX',reason:'Identity-specific geometry coefficients require a separate geometry retargeting implementation; treating them as VRM/ARKit weights would be invalid.'}
 ]};
fs.writeFileSync(path.join(destination,'samples.json'),JSON.stringify(manifest,null,2)+'\n');
Object.defineProperty(globalThis,'performance',{value:realPerformance,configurable:true});
console.log(cases.length,'saved Kokoro scenes ×',methods.length,'actual methods prepared.');
