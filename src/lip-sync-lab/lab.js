import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';
import {loadMixamoAnimation} from '../load_mixamo_animation.js';
import {CHANNELS,boundedWeights,sampleFrames} from './mouth-adapters.js';

const $=id=>document.getElementById(id);
const audio=$('audio'),stage=$('stage');
let manifest,data,currentCase,vrm,mixer,renderer,camera,scene,selected='a';
let calibration=null,stopped=true,generation=0,frame=null,lastTime=0,lastInspection=0,peak=0;
let bindings=[],mouthBindings=[],applied=CHANNELS.map(()=>0);
const loaded=new Map();

async function json(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Saved data unavailable (${response.status})`);
  return response.json();
}

function method() {return manifest.methods.find(m=>m.id===$('method-'+selected).value);}
function showMethod(side) {
  selected=side;calibration=null;
  $('view-a').setAttribute('aria-pressed',String(side==='a'));
  $('view-b').setAttribute('aria-pressed',String(side==='b'));
  $('active-method').textContent=method().label;
  $('method-notes').textContent=method().notes;
  peak=0;
  requestDraw();
}

function reset() {
  audio.pause();audio.currentTime=0;calibration=null;stopped=true;peak=0;
  $('seek').value=0;$('play').textContent='Play line';
  requestDraw();
}

async function loadScene() {
  const token=++generation;
  reset();
  for(const id of ['play','restart','stop','seek'])$(id).disabled=true;
  const candidate=manifest.cases.find(c=>c.id===$('scene').value);
  try {
    const result=loaded.get(candidate.id) ?? await json(candidate.data);
    if(token!==generation)return;
    if(result.channels.join(',')!==CHANNELS.join(',') || result.fps!==60 || Math.abs(result.duration-candidate.duration)>.01)throw new Error('Mouth/audio data mismatch');
    for(const values of Object.values(result.variants)) {
      if(values.length!==Math.ceil(result.duration*60)+1)throw new Error('Invalid mouth frame count');
      values.forEach(boundedWeights);
    }
    loaded.set(candidate.id,result);data=result;currentCase=candidate;
    // No live audio transport; this source is an existing local Kokoro fixture.
    audio.src=candidate.audio;audio.load();
    $('seek').max=candidate.duration;
    $('transcript').textContent=candidate.text;
    $('status').textContent=vrm?'Ready. Choose two methods and play the same recording.':'Recordings ready. Loading avatar…';
    for(const id of ['play','restart','stop','seek'])$(id).disabled=!vrm;
    requestDraw();
  } catch(error) {if(token===generation)$('status').textContent=error.message;}
}

async function play() {
  calibration=null;stopped=false;
  try {
    if(audio.ended)audio.currentTime=0;
    await audio.play();
  } catch(error) {if(error.name!=='AbortError')$('status').textContent=`Audio playback failed: ${error.message}`;}
}
$('play').addEventListener('click',()=>audio.paused?play():audio.pause());
$('restart').addEventListener('click',()=>{reset();play();});
$('stop').addEventListener('click',reset);
$('seek').addEventListener('input',()=>{calibration=null;stopped=false;audio.currentTime=Number($('seek').value);requestDraw();});
$('loop').addEventListener('change',()=>{audio.loop=$('loop').checked;});
$('scene').addEventListener('change',loadScene);
for(const side of ['a','b']) {
  $('view-'+side).addEventListener('click',()=>showMethod(side));
  $('method-'+side).addEventListener('change',()=>showMethod(side));
}
$('strength').addEventListener('input',()=>{$('strength-value').textContent=Number($('strength').value).toFixed(2)+'×';requestDraw();});
$('smile').addEventListener('change',requestDraw);
for(const event of ['play','pause','ended'])audio.addEventListener(event,()=>{
  $('play').textContent=audio.paused?'Play line':'Pause';
  $('status').textContent=audio.ended?'Finished. Switch methods and replay, or choose another scene.':audio.paused?'Paused. Mouth position follows the recording cursor.':'Playing saved Kokoro audio.';
  requestDraw();
});
audio.addEventListener('error',()=>{$('status').textContent='Saved audio failed to load. No live service was called.';});
for(const button of $('calibration').querySelectorAll('button'))button.addEventListener('click',()=>{
  if(!vrm)return;
  audio.pause();
  calibration=CHANNELS.map(name=>Number(name===button.dataset.pose)*.65);
  $('status').textContent=`Rig check: ${button.textContent}. Play returns to the recording.`;
  requestDraw();
});

function applyMouth(weights) {
  applied=boundedWeights(weights.map(v=>v*Number($('strength').value)));
  CHANNELS.slice(0,5).forEach((name,i)=>vrm.expressionManager.setValue(name,applied[i]));
  vrm.expressionManager.setValue('happy',$('smile').checked ? .3 : 0);
  vrm.update(0);
  // The uncombined raw mouth-close morph is not a VRM preset on this avatar.
  for(const {mesh,index} of bindings)mesh.morphTargetInfluences[index]=applied[5];
}

function resize() {
  if(!renderer)return;
  const {width,height}=stage.getBoundingClientRect();
  renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  requestDraw();
}

function requestDraw() {
  if(renderer && camera && vrm && frame===null && !document.hidden)frame=requestAnimationFrame(draw);
}

function draw(now) {
  frame=null;
  if(document.hidden)return;
  const delta=Math.min(.05,(now-lastTime)/1000||0);lastTime=now;
  if(vrm) {
    const weights=calibration ?? (data && !stopped?sampleFrames(data.variants[method().id],data.fps,audio.currentTime,data.duration):CHANNELS.map(()=>0));
    applyMouth(weights);
    renderer.render(scene,camera);
    const actualValues=new Map();
    for(const {mesh,index,name} of mouthBindings)actualValues.set(name,Math.max(actualValues.get(name)??0,mesh.morphTargetInfluences[index]));
    const actual=[...actualValues].map(([name,value])=>({name,value}));
    const motion=Math.max(0,...actual.map(m=>m.value));peak=Math.max(peak,motion);
    $('position').textContent=audio.currentTime.toFixed(2)+'s';
    $('seek').value=audio.currentTime;
    if(now-lastInspection>150 || audio.paused) {
      lastInspection=now;
      $('motion-status').textContent=`Applied mouth: ${motion.toFixed(2)} · peak ${peak.toFixed(2)}`;
      $('inspection').textContent=JSON.stringify({method:method().id,voice:manifest.voice,audioTime:audio.currentTime,
        paused:audio.paused,weights:Object.fromEntries(CHANNELS.map((name,i)=>[name,Number(applied[i].toFixed(3))])),
        actualMorphs:actual.map(m=>({...m,value:Number(m.value.toFixed(3))})),mouthBindingCount:mouthBindings.length,peakAppliedMorph:peak,
        sourceAudioSha256:currentCase?.audioSha256},null,2);
    }
  }
  if(!audio.paused && !document.hidden)frame=requestAnimationFrame(draw);
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){audio.pause();if(frame!==null)cancelAnimationFrame(frame);frame=null;}
  else if(renderer && frame===null){lastTime=performance.now();requestDraw();}
});
window.addEventListener('resize',resize);
window.addEventListener('pagehide',()=>{audio.pause();if(frame!==null)cancelAnimationFrame(frame);renderer?.dispose();});

try {
  manifest=await json('/lip-sync-lab/samples.json');
  for(const candidate of manifest.cases) {
    const option=document.createElement('option');option.value=candidate.id;option.textContent=candidate.label;$('scene').append(option);
  }
  for(const side of ['a','b'])for(const candidate of manifest.methods) {
    const option=document.createElement('option');option.value=candidate.id;option.textContent=candidate.label;$('method-'+side).append(option);
  }
  $('method-a').value='rhubarb';$('method-b').value=manifest.methods.some(m=>m.id==='lam')?'lam':'headaudio';
  for(const item of manifest.unavailable) {
    const p=document.createElement('p');p.textContent=`${item.name}: ${item.reason}`;$('unavailable').append(p);
  }
  showMethod('a');
  await loadScene();
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  stage.append(renderer.domElement);scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x777588,1.3));
  const light=new THREE.DirectionalLight(0xffffff,1.2);light.position.set(2,3,4);scene.add(light);
  camera=new THREE.PerspectiveCamera(30,1,.05,100);
  const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
  const gltf=await loader.loadAsync('/vrm_models/asena_sfw.vrm');
  vrm=gltf.userData.vrm;VRMUtils.rotateVRM0(vrm);vrm.scene.updateMatrixWorld(true);
  for(const name of CHANNELS.slice(0,5))if(!vrm.expressionManager.getExpression(name))throw new Error(`Missing ${name} mouth expression`);
  vrm.scene.traverse(mesh=>{
    const index=mesh.morphTargetDictionary?.Fcl_MTH_Close;
    if(index!==undefined)bindings.push({mesh,index});
    for(const [name,index] of Object.entries(mesh.morphTargetDictionary??{}))if(/^Fcl_MTH_[AIUEO]$|^Fcl_MTH_Close$/.test(name))mouthBindings.push({mesh,index,name});
    mesh.frustumCulled=false;
  });
  if(!bindings.length)throw new Error('The closed-mouth morph is missing');
  scene.add(vrm.scene);mixer=new THREE.AnimationMixer(vrm.scene);
  try {
    const idle=await loadMixamoAnimation('/animations/idle.fbx',vrm);
    mixer.clipAction(idle).play();mixer.setTime(1.5); // Hold one identical pose across every comparison.
  } catch { $('status').textContent='Idle unavailable. Mouth comparison uses a fixed pose.'; }
  const head=vrm.humanoid.getNormalizedBoneNode('head');
  const target=head.getWorldPosition(new THREE.Vector3());target.y+=.04;
  camera.position.set(target.x,target.y,target.z+.72);camera.lookAt(target);
  resize();
  for(const id of ['scene','method-a','method-b','view-a','view-b','play','restart','stop','seek'])$(id).disabled=false;
  $('status').textContent='Ready. Nine methods, three recordings. No live generation.';
  lastTime=performance.now();requestDraw();
} catch(error) {
  audio.pause();$('status').textContent=`Comparison unavailable: ${error.message}`;
  if(frame!==null)cancelAnimationFrame(frame);renderer?.dispose();
}
