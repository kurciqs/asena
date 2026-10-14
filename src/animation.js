import { assets } from './runtime_config.js';
import { MOUTH_EXPRESSIONS, resolveExpressionBinding } from './expression_tracks.js';
import { BodyPlayback } from './body_blending.js';
import { AudioPerformanceScheduler } from './performance_scheduler.js';
import { ClockedAvatarPerformance } from './clocked_avatar_performance.js';
import {CHANNELS,boundedWeights} from './rhubarb_mouth.js';
import { LatestLoad, withAbort, withDeadline } from './asset_loading.js';
import { LazyAnimations } from './lazy_animations.js';
import {dueGestures} from './gesture_clock.js';
import { RENDER_PROFILES, RENDER_STORAGE_KEY, renderPreferences, pixelRatio, RenderLoop, BlinkClock } from './render_policy.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './load_mixamo_animation.js';

// ------- CONFIGS AND GLOBALS -------
const MODELS_INDEX_PATH = assets.modelsIndex;
const MODELS_PATH = assets.models;
const ANIMATIONS_PATH = assets.animations;
const ANIMATIONS_INDEX_PATH = assets.animationsIndex;

// ------- ANIMATION AND RENDERING -------
let animations = {};
let animationsLoaded = false;
const playbackStateListeners = new Set();
let elapsedTime = 0;
const blinkClock = new BlinkClock();
let animationLibrary = null;
let rhubarbToVRM = {
    "A": "aa",    // “ah” sound → VRM A
    "B": "neutral",          // “m/b/p” → no open mouth / silence
    "C": "oh",   // “oh” → VRM O
    "D": "ee",   // “th/dh” → approximate VRM E
    "E": "ee",   // “eh/ae” → VRM E
    "F": "ou",   // “f/v” → closest VRM U
    "G": "aa",   // “k/g” → fallback VRM A
    "H": "aa",   // “h” → light A or silence
    "X": "neutral"           // “rest” → silence / neutral
}
let vrmModels = {};
const animationSelect = document.getElementById('select-animation');
const modelSelect = document.getElementById("select-model")
const ANIMATION_CROSSFADE = 0.5;

// pick one: angry, happy, relaxed, sad, Surprised, Extra (extra is the lol face)
let currentExpression = { name: "Neutral", value: 1 }
let expressionOptions = ["angry", "happy", "relaxed", "sad", "surprised"]
let currentAnimation = null;
let bodyPlayback = null;
let expressionPlayback = { trackCount: 0, peakMouthWeight: 0, peakMouthMorphWeight: 0 };
let lastPlaybackNotification = 0;
let gestureGeneration = 0;
let clockedPerformance = null;
let pcmPerformance = null;
let previewRemaining = null;
const performanceScheduler = new AudioPerformanceScheduler({
    onSegment:data=>{
        clockedPerformance=new ClockedAvatarPerformance({mixer:currentMixer,manager:currentVrm.expressionManager,
            animations,bodyPlayback,data});
        expressionPlayback=clockedPerformance.inspection;
    },
    onTime:(time,wallDelta)=>{if(clockedPerformance)currentAnimation=clockedPerformance.sample(time,wallDelta)??currentAnimation;},
    onSegmentEnd:()=>{clockedPerformance?.stop();clockedPerformance=null;currentAnimation=animations.idle??null;},
    onState:()=>{
        animationSelect.disabled=performanceScheduler.running || !animationLibrary?.files.size;
        notifyPlaybackState();
    }
});
export function stopPerformance() {
    gestureGeneration++;
    previewRemaining=null;
    pcmPerformance=null;
    performanceScheduler.stop();
    if (currentVrm) {
        currentVrm.scene.traverse(mesh=>{const index=mesh.morphTargetDictionary?.Fcl_MTH_Close;if(index!==undefined)mesh.morphTargetInfluences[index]=0;});
        for(const name of CHANNELS.slice(0,5))if(currentVrm.expressionManager.getExpression(name))currentVrm.expressionManager.setValue(name,0);
        for (const name of new Set([...Object.values(rhubarbToVRM), ...expressionOptions])) {
            if (currentVrm.expressionManager.getExpression(name)) currentVrm.expressionManager.setValue(name, 0);
        }
        currentVrm.expressionManager.update(); // Apply the reset before publishing the stopped snapshot.
    }
    if (animations.idle) {
        transitionBody(animations.idle);
    }
    animationSelect.disabled=!animationLibrary?.files.size;
    notifyPlaybackState();
}

// ------- THREE JS AND MORE RENDERING -------
// orga idk
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
let renderSettings = renderPreferences();
try { renderSettings = renderPreferences(JSON.parse(localStorage.getItem(RENDER_STORAGE_KEY) ?? '{}')); } catch {}
renderer.setPixelRatio(pixelRatio(renderSettings,window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = renderSettings.shadows;
document.getElementById("main-container").appendChild(renderer.domElement);
renderer.domElement.id = "bg-canvas"
const scene = new THREE.Scene();
// camera
const camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 200.0);
camera.position.set(0.0, 1.5, 2.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = true;
controls.target.set(0.0, 1.5, 0.0);
controls.update();
let resizeCount = 1;
function resizeRenderer() {
    const ratio = pixelRatio(renderSettings,window.devicePixelRatio);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== window.innerWidth || size.y !== window.innerHeight) {
        renderer.setSize(window.innerWidth,window.innerHeight); resizeCount++;
    }
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize',resizeRenderer);
// light, could i give the llm control over this?
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(5, 5, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-3, 3, 2);
// scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffeeee, 0.5);
rimLight.position.set(0, 5, -5);
scene.add(rimLight);
// helper
const axesHelper = new THREE.AxesHelper(5);
// scene.background = new THREE.Color(0xFFA1EC);
const gridHelper = new THREE.GridHelper(10, 10);
// scene.add(gridHelper);
// scene.add(axesHelper);
const helperRoot = new THREE.Group();
helperRoot.renderOrder = 10000;
scene.add(helperRoot);
// orga idk
let currentVrm = undefined;
let currentMixer = undefined;
const loader = new GLTFLoader();
loader.crossOrigin = 'anonymous';
loader.register((parser) => {
    // return new VRMLoaderPlugin(parser, { helperRoot }); // debugs for if you wanna look locked in while having it open
    return new VRMLoaderPlugin(parser);
});
// lookat target, gives good humanoid effect
const lookAtTarget = new THREE.Object3D();
camera.add(lookAtTarget);

const modelLoads = new LatestLoad();
let assetState = { loading: false, model: null, requestedModel: null, loadMilliseconds: 0, missingClips: [], error: null };
async function assetIndex(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Asset index unavailable (${response.status})`);
    return response.json();
}

export async function loadModel(url, name = modelSelect.value) {
    const isCurrent = modelLoads.begin();
    const started = performance.now();
    let candidate = null;
    stopPerformance();
    animationsLoaded = false;
    animationSelect.disabled = true;
    assetState = { ...assetState, loading: true, requestedModel: name, error: null };
    notifyPlaybackState();
    try {
        const gltf = await withDeadline(loader.loadAsync(url), 30000, 'Avatar', late => VRMUtils.deepDispose(late.scene));
        candidate = gltf.userData.vrm;
        if (!candidate) throw new Error('The selected model is not a VRM avatar');
        if (!isCurrent()) { VRMUtils.deepDispose(gltf.scene); return; }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.combineMorphs(candidate);
        VRMUtils.rotateVRM0(candidate);
        candidate.scene.updateMatrixWorld(true);
        const mixer = new THREE.AnimationMixer(candidate.scene);
        let indexed = [], indexError = null;
        try { indexed = await assetIndex(ANIMATIONS_INDEX_PATH); } catch (error) { indexError = error.message; }
        const avatar = candidate; // Lazy loaders must retain this model after candidate is cleared on commit.
        const library = new LazyAnimations(indexed, file => loadMixamoAnimation(ANIMATIONS_PATH + file, avatar));
        await library.get('idle'); // Only idle is needed to display a usable avatar.
        if (!isCurrent()) { VRMUtils.deepDispose(candidate.scene); return; }
        stopPerformance();
        currentMixer?.stopAllAction();
        if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
        currentVrm = candidate;
        currentMixer = mixer;
        animationLibrary = library;
        animations = Object.fromEntries([...library.clips].map(([key, clip]) => [key, mixer.clipAction(clip)]));
        currentAnimation = null;
        animationSelect.replaceChildren();
        for (const key of library.files.keys()) {
            const option = document.createElement('option'); option.value = key; option.textContent = key.replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
            animationSelect.appendChild(option);
        }
        if (animations.idle) {
            animationSelect.value = 'idle';
            currentAnimation = animations.idle;
            currentAnimation.play();
        } else animationSelect.selectedIndex = -1; // Rest pose is safer than looping an arbitrary gesture.
        bodyPlayback = new BodyPlayback(animations, ANIMATION_CROSSFADE);
        expressionPlayback = { trackCount: 0, peakMouthWeight: 0, peakMouthMorphWeight: 0 };
        candidate.lookAt && (candidate.lookAt.target = lookAtTarget);
        candidate.scene.traverse(object => { object.frustumCulled = false; if (object.isMesh) object.castShadow = object.receiveShadow = true; });
        scene.add(candidate.scene);
        modelSelect.value = name;
        animationsLoaded = true; // A usable avatar may have only a rest-pose gesture fallback.
        animationSelect.disabled = !library.files.size;
        assetState = { loading: false, model: name, requestedModel: name,
            loadMilliseconds: Math.round(performance.now() - started), missingClips: [...library.errors].map(([name,error])=>({name,error})),
            error: animations.idle ? null : `Idle animation unavailable; using the avatar rest pose.${indexError ? ' '+indexError : ''}` };
        candidate = null;
        if (!document.hidden) renderLoop.start();
        notifyPlaybackState();
    } catch (error) {
        if (candidate) VRMUtils.deepDispose(candidate.scene);
        if (!isCurrent()) return;
        animationsLoaded = Boolean(currentVrm);
        animationSelect.disabled = !Object.keys(animations).length;
        if (assetState.model) modelSelect.value = assetState.model;
        assetState = { ...assetState, loading: false, loadMilliseconds: Math.round(performance.now() - started), error: error.message };
        if (!currentVrm) renderLoop.stop();
        notifyPlaybackState();
    }
}

let rendererStarted = false;
export async function loadThreeVRM() {
    rendererStarted = true;
    try {
        const files = await assetIndex(MODELS_INDEX_PATH);
        if (!Array.isArray(files) || !files.length || !files.every(file => typeof file === 'string' && /^[\w .-]+\.vrm$/i.test(file))) {
            throw new Error('No valid avatars in the model index');
        }
        modelSelect.replaceChildren();
        for (const file of files) {
            const name = file.replace(/\.vrm$/i, '');
            vrmModels[name] = MODELS_PATH + file;
            const option = document.createElement('option'); option.value = name; option.textContent = name;
            modelSelect.appendChild(option);
        }
        const preferred = vrmModels.asena_sfw ? 'asena_sfw' : Object.keys(vrmModels)[0];
        modelSelect.value = preferred;
        modelSelect.disabled = false;
        await loadModel(vrmModels[preferred], preferred);
    } catch (error) { assetState.error = error.message; if (!currentVrm) renderLoop.stop(); notifyPlaybackState(); }
}
modelSelect.addEventListener('change', () => loadModel(vrmModels[modelSelect.value], modelSelect.value));
animationSelect.addEventListener('change', playAnimationFromSelect);

async function ensureAnimation(name, signal) {
    const library = animationLibrary, mixer = currentMixer;
    if (!library || !mixer) return null;
    const clip = await withAbort(library.get(name),signal);
    if (library !== animationLibrary || mixer !== currentMixer) return null;
    if (clip && !animations[name]) { animations[name] = mixer.clipAction(clip); bodyPlayback.add(animations[name]); }
    assetState.missingClips = [...library.errors].map(([name,error])=>({name,error}));
    notifyPlaybackState();
    return animations[name] ?? null;
}

export async function preparePerformance(actions, signal) {
    const usable = new Set();
    for (const name of new Set(actions.map(action=>action.value))) {
        if (await ensureAnimation(name,signal)) usable.add(name);
    }
    return actions.filter(action=>usable.has(action.value));
}

export function playAnimationByName(name) {
    const animation = animations[name];
    if (!animation || !currentMixer) return false;
    stopPerformance();
    transitionBody(animation);
    previewRemaining=Math.max(0,animation.getClip().duration-ANIMATION_CROSSFADE);
    notifyPlaybackState();
    return true;
}

function transitionBody(action) {
    bodyPlayback?.transition(action);
    currentAnimation = action;
}

export function setExpression(name, value) {
    currentExpression = { name: name, value: value };
}

function animate(deltaTime) {
    elapsedTime += deltaTime;
    const pcmState=pcmPerformance?.sample();
    const bodyDelta=pcmState&&(pcmState.paused||pcmState.buffering)&&currentAnimation!==animations.idle?0:deltaTime;

    let bodySettled=false;
    if(clockedPerformance) performanceScheduler.sample(deltaTime);
    else {
        if(previewRemaining!==null) {
            previewRemaining-=bodyDelta;
            if(previewRemaining<=0) {previewRemaining=null;if(animations.idle)transitionBody(animations.idle);}
        }
        bodySettled=bodyPlayback?.update(bodyDelta);
        currentMixer?.update(bodyDelta);
    }

    let pcmWeights=null;
    if(pcmPerformance&&currentVrm){
        const s=pcmState;pcmWeights=boundedWeights(s.weights);
        CHANNELS.slice(0,5).forEach((name,index)=>{if(currentVrm.expressionManager.getExpression(name))currentVrm.expressionManager.setValue(name,pcmWeights[index]);});
        for(const name of expressionOptions){
            const cue=(s.emotions??[]).findLast(c=>c.value===name&&c.start<=s.playedSeconds&&s.playedSeconds<c.end);
            if(currentVrm.expressionManager.getExpression(name))currentVrm.expressionManager.setValue(name,cue?(name==='happy'?.3:.5):0);
        }
        const due=dueGestures(s.actions,s,pcmPerformance.seen,new Set(Object.keys(animations)));
        const cue=due.at(-1);
        if(cue&&animations[cue.value]){transitionBody(animations[cue.value]);previewRemaining=Math.max(0,animations[cue.value].getClip().duration-ANIMATION_CROSSFADE);}
    }
    if (currentVrm) {
        const blink = blinkClock.update(deltaTime,(currentVrm.expressionManager.getValue('happy') ?? 0)>0.5);
        currentVrm.expressionManager.setValue('blinkLeft',Number(blink));
        currentVrm.expressionManager.setValue('blinkRight',Number(blink));
        currentVrm.update(Math.min(deltaTime,0.1)); // Bound spring physics after a busy frame.
        if(pcmWeights)for(const {mesh,index} of pcmPerformance.close)mesh.morphTargetInfluences[index]=pcmWeights[5];
    }

    if ((clockedPerformance||pcmPerformance) && currentVrm) {
        // Measure both the animated expression and the morph applied by the VRM
        // manager. A valid cue list alone cannot establish visible mouth motion.
        const mouth = mouthPlaybackState();
        expressionPlayback.peakMouthWeight = Math.max(expressionPlayback.peakMouthWeight, ...Object.values(mouth.weights));
        expressionPlayback.peakMouthMorphWeight = Math.max(expressionPlayback.peakMouthMorphWeight, mouth.morphWeight);
    }
    if (elapsedTime - lastPlaybackNotification > (clockedPerformance ? 0.25 : 1) &&
        !document.getElementById('utility-panels').hidden && !document.getElementById('replay-panel').hidden &&
        document.getElementById('replay-inspector')?.closest('details')?.open) {
        lastPlaybackNotification = elapsedTime;
        notifyPlaybackState();
    }
    if (bodySettled) notifyPlaybackState();

    // subtle circular eye movement i think aha it follows the camera now that's also cool ig
    lookAtTarget.position.y = Math.sin(Math.PI * elapsedTime) * 0.2;

    renderer.render(scene, camera);
}

const renderLoop = new RenderLoop({request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),
    frame:animate,fps:RENDER_PROFILES[renderSettings.quality].fps});
document.addEventListener('visibilitychange',()=>{
    if (document.hidden) renderLoop.stop();
    else if (rendererStarted && currentVrm) {
        performanceScheduler.sample();
        resizeRenderer(); renderLoop.start();
    }
});
export function setRenderPreferences(value) {
    renderSettings = renderPreferences(value);
    renderLoop.fps = RENDER_PROFILES[renderSettings.quality].fps;
    renderer.shadowMap.enabled = renderSettings.shadows;
    renderer.shadowMap.needsUpdate = true;
    resizeRenderer(); notifyPlaybackState();
}
export function disposeRenderer() { stopPerformance(); renderLoop.stop(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); }

export function getPlaybackState() {
    const pcmClock=pcmPerformance?.sample();
    return { ...assetState, ready: animationsLoaded, clips: [...(animationLibrary?.files.keys() ?? [])], loadedClips: Object.keys(animations),
        scheduler:pcmClock?{...pcmClock,streaming:true,phase:pcmClock.paused?'paused':pcmClock.buffering?'buffering':pcmClock.playedFrames>0?'playing':'starting'}:performanceScheduler.snapshot(),
        rendering: {...renderSettings, fpsLimit:renderLoop.fps, pixelRatio:renderer.getPixelRatio(),
            width:renderer.domElement.width,height:renderer.domElement.height,frames:renderLoop.frames,callbacks:renderLoop.callbacks,
            paused:!renderLoop.running,resizeCount,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
            drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles},
        currentClip: Object.entries(animations).find(([, action]) => action === currentAnimation)?.[0] ?? null,
        bodyWeights: Object.fromEntries(Object.entries(animations).filter(([, action]) => action.isRunning()).map(
            ([name, action]) => [name, Number(action.getEffectiveWeight().toFixed(3))])),
        expressions: { ...expressionPlayback, active: Boolean(clockedPerformance||pcmPerformance),
            boundMouthChannels: MOUTH_EXPRESSIONS.filter(name => currentVrm && resolveExpressionBinding(currentVrm.expressionManager, name)),
            missingMouthChannels: MOUTH_EXPRESSIONS.filter(name => currentVrm && !resolveExpressionBinding(currentVrm.expressionManager, name)),
            ...mouthPlaybackState() } };
}

function mouthPlaybackState() {
    const weights = {};
    let morphWeight = 0;
    for (const name of MOUTH_EXPRESSIONS) {
        const expression = currentVrm?.expressionManager.getExpression(name);
        if (!expression) continue;
        weights[name] = Number(expression.weight.toFixed(3));
        for (const bind of expression.binds) {
            for (const mesh of bind.primitives ?? []) morphWeight = Math.max(morphWeight, mesh.morphTargetInfluences?.[bind.index] ?? 0);
        }
    }
    return { weights, morphWeight: Number(morphWeight.toFixed(3)) };
}

export function onPlaybackStateChange(listener) {
    playbackStateListeners.add(listener);
    listener(getPlaybackState());
    return () => playbackStateListeners.delete(listener);
}

function notifyPlaybackState() {
    if (!playbackStateListeners.size) return;
    const state = getPlaybackState();
    for (const listener of playbackStateListeners) listener(state);
}

export function talk(data) {
    if (!animationsLoaded) {
        throw new Error('Avatar animations are not ready.');
    }

    stopPerformance();
    return performanceScheduler.play([data],{signal:data.signal});
}

export function pausePerformance() {
    const owner=pcmPerformance;
    if(owner)owner.player.pause().then(()=>{if(pcmPerformance===owner)notifyPlaybackState();}).catch(()=>{if(pcmPerformance===owner)stopPerformance();});
    else performanceScheduler.pause();
}
export function resumePerformance() {
    const owner=pcmPerformance;
    if(owner)owner.player.resume().then(()=>{if(pcmPerformance===owner)notifyPlaybackState();}).catch(()=>{if(pcmPerformance===owner)stopPerformance();});
    else performanceScheduler.resume();
}
// Streaming producers must prepare each complete segment before enqueueing it.
export function beginPerformance(options) {
    if(!animationsLoaded)throw new Error('Avatar animations are not ready.');
    stopPerformance();return performanceScheduler.begin(options);
}
export function enqueuePerformanceSegment(data) {performanceScheduler.enqueue(data);}
export function finishPerformance() {performanceScheduler.finish();}

export function beginPcmPerformance(sample,player) {
    if(!animationsLoaded)throw new Error('Avatar animations are not ready.');
    stopPerformance();
    const close=[];
    currentVrm.scene.traverse(mesh=>{const index=mesh.morphTargetDictionary?.Fcl_MTH_Close;if(index!==undefined)close.push({mesh,index});});
    pcmPerformance={sample,player,close,seen:new Set()};
    animationSelect.disabled=true;notifyPlaybackState();
}

async function playAnimationFromSelect() {
    const generation = ++gestureGeneration;
    const animation = await ensureAnimation(animationSelect.value);
    if (generation !== gestureGeneration) return;
    if (animation) transitionBody(animation);
    notifyPlaybackState();
}

