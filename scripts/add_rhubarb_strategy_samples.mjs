// Extend, never prune, the existing studio with actual measured Rhubarb outputs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHANNELS,RHUBARB,boundedWeights} from '../src/lip-sync-lab/mouth-adapters.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'src/lip-sync-lab');
const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/rhubarb-optimization-2026-10-12.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'samples.json'),'utf8'));
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
function pose(cues,time) {
  const result=CHANNELS.map(()=>0);
  for(const cue of cues)if(time>=cue.start && time<=cue.end && cue.end>cue.start) {
    RHUBARB[cue.value].forEach((v,i)=>result[i]=Math.max(result[i],v));
  }
  return result;
}
function frames(cues,duration) {
  const result=Array.from({length:Math.ceil(duration*60)+1},(_,i)=>{
    const t=i/60,before=pose(cues,Math.max(0,t-.02)),here=pose(cues,t),after=pose(cues,Math.min(duration,t+.02));
    return boundedWeights(here.map((v,j)=>(before[j]+2*v+after[j])/4)).map(v=>Number(v.toFixed(5)));
  });
  result[result.length-1]=CHANNELS.map(()=>0);return result;
}
const added=[
 ...[1,2,3].map(hop=>({id:'rh-native-'+hop+'s',label:'Rhubarb · native '+hop+'s windows',
  notes:`${hop}-second retained regions with ±250ms context; measured native ARM64 execution. Overlap is analysed but never played twice.`,hop})),
 {id:'rh-native-sentences',label:'Rhubarb · native sentence boundaries',notes:'Cuts at punctuation-derived boundaries between captioned words; ±250ms context. Saved audio is unchanged; no separate TTS requests were made.',hop:'sentences'},
 {id:'rh-known-text',label:'Rhubarb · known-text alignment prototype',notes:'Experimental acoustic alignment of the exact transcript, bypassing word search. Fast, but silence/pronunciation differences change the cues. Not enabled in production.',force:true},
 {id:'rh-phonetic',label:'Rhubarb · phonetic recognizer',notes:'Upstream language-independent recognizer. Separate quality/speed tradeoff; the live English path remains PocketSphinx.',phonetic:true}
];
manifest.methods=manifest.methods.filter(m=>!added.some(a=>a.id===m.id));
manifest.methods.push(...added.map(({hop,force,phonetic,...m})=>m));
for(const scene of manifest.cases) {
  const dataPath=path.join(directory,scene.id+'.json');
  const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
  const base=evidence.summary.find(c=>c.clip===scene.id);
  scene.timings={rhubarb:{seconds:base.nativeMeanSeconds,platform:'Native ARM64',basis:'Whole-recording alignment; mean of two runs'},
    legacy:{seconds:base.nativeMeanSeconds,platform:'Native ARM64',basis:'Same detector as whole-recording Rhubarb; renderer cost is not timed separately'},
    'rhubarb-batches':{seconds:manifest.rhubarbBatches[scene.id].measurements.reduce((s,w)=>s+w.seconds,0),platform:'Original Intel executable',basis:'Recorded one-second window preparation'}};
  for(const candidate of added) {
    let result;
    if(candidate.force) {
      const jobs=evidence.workers.force.jobs.filter(j=>j.id.startsWith(scene.id+'-r'));
      result={cues:jobs[0].cues,seconds:mean(jobs.map(j=>j.seconds)),agreement:jobs[0].agreement};
    } else if(candidate.phonetic) {
      result=evidence.matrix['native-phonetic'].find(r=>r.clip===scene.id);
    } else {
      result=[...evidence.matrix.window,...evidence.matrix['streaming-policy']].find(r=>r.clip===scene.id && r.hop===candidate.hop && r.context===.25);
    }
    data.variants[candidate.id]=frames(result.cues,data.duration);
    scene.timings[candidate.id]={seconds:result.seconds,platform:'Native ARM64',
       basis:candidate.force?'Fresh decoder per worker request; mean of three runs; process/export overhead excluded':candidate.phonetic?'Whole recording; one run':'Total processing for all windows; excludes audio arrival time',
       agreement:result.agreement ?? null};
  }
  fs.writeFileSync(dataPath,JSON.stringify(data));
}
manifest.rhubarbOptimization={prepared:'2026-10-12',report:'docs/rhubarb-optimization-2026-10-12.md',
 note:'Timings exclude TTS. All motion remains precomputed. Original methods retained.'};
fs.writeFileSync(path.join(directory,'samples.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.cases.length,'recordings ×',manifest.methods.length,'methods; original comparisons retained.');
