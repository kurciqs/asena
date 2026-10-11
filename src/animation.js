import { buildExpressionTracks } from './expression_tracks.js';
import { LatestLoad, loadAnimationSet, withDeadline } from './asset_loading.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './load_mixamo_animation.js';

// ------- CONFIGS AND GLOBALS -------
const MODELS_INDEX_PATH = '/vrm_models/models.json';
const MODELS_PATH = "/vrm_models/"
const ANIMATIONS_PATH = '/animations/';
const ANIMATIONS_INDEX_PATH = '/animations/animations.json';

// ------- ANIMATION AND RENDERING -------
let animations = {};
let animationsLoaded = false;
const playbackStateListeners = new Set();
const clock = new THREE.Clock();
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
let blinkTimeout = 240;
const ANIMATION_CROSSFADE = 0.5;

// pick one: angry, happy, relaxed, sad, Surprised, Extra (extra is the lol face)
let currentExpression = { name: "Neutral", value: 1 }
let expressionOptions = ["angry", "happy", "relaxed", "sad", "surprised"]
let currentAnimation = null;
let activeAudio = null;
let performanceAction = null;
let performanceGeneration = 0;
let gestureGeneration = 0;
const gestureTimers = new Set();
function scheduleGesture(callback, seconds) {
    const timer = setTimeout(() => { gestureTimers.delete(timer); callback(); }, Math.max(0, seconds) * 1000);
    gestureTimers.add(timer);
}
export function stopPerformance() {
    performanceGeneration++;
    gestureGeneration++;
    for (const timer of gestureTimers) clearTimeout(timer);
    gestureTimers.clear();
    if (activeAudio) { activeAudio.pause(); try { activeAudio.currentTime = 0; } catch {} activeAudio = null; }
    if (performanceAction && currentMixer) {
        const clip = performanceAction.getClip();
        performanceAction.stop(); currentMixer.uncacheClip(clip); performanceAction = null;
    }
    if (currentVrm) {
        for (const name of new Set([...Object.values(rhubarbToVRM), ...expressionOptions])) {
            if (currentVrm.expressionManager.getExpression(name)) currentVrm.expressionManager.setValue(name, 0);
        }
    }
    if (animations.idle) {
        if (currentAnimation && currentAnimation !== animations.idle) currentAnimation.fadeOut(ANIMATION_CROSSFADE);
        animations.idle.reset().fadeIn(ANIMATION_CROSSFADE).play();
        currentAnimation = animations.idle;
    }
    notifyPlaybackState();
}

// ------- THREE JS AND MORE RENDERING -------
// orga idk
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
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
        const indexed = await assetIndex(ANIMATIONS_INDEX_PATH);
        const result = await loadAnimationSet(indexed, file => loadMixamoAnimation(ANIMATIONS_PATH + file, candidate));
        if (!isCurrent()) { VRMUtils.deepDispose(candidate.scene); return; }
        stopPerformance();
        currentMixer?.stopAllAction();
        if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
        currentVrm = candidate;
        currentMixer = mixer;
        animations = Object.fromEntries([...result.clips].map(([key, clip]) => [key, mixer.clipAction(clip)]));
        currentAnimation = null;
        animationSelect.replaceChildren();
        for (const key of Object.keys(animations)) {
            const option = document.createElement('option'); option.value = key; option.textContent = key;
            animationSelect.appendChild(option);
        }
        if (animations.idle) {
            animationSelect.value = 'idle';
            currentAnimation = animations.idle;
            currentAnimation.play();
        } else animationSelect.selectedIndex = -1; // Rest pose is safer than looping an arbitrary gesture.
        candidate.lookAt && (candidate.lookAt.target = lookAtTarget);
        candidate.scene.traverse(object => { object.frustumCulled = false; if (object.isMesh) object.castShadow = object.receiveShadow = true; });
        scene.add(candidate.scene);
        modelSelect.value = name;
        animationsLoaded = true; // A usable avatar may have only a rest-pose gesture fallback.
        animationSelect.disabled = !Object.keys(animations).length;
        assetState = { loading: false, model: name, requestedModel: name,
            loadMilliseconds: Math.round(performance.now() - started), missingClips: result.missing,
            error: animations.idle ? null : 'Idle animation unavailable; using the avatar rest pose.' };
        candidate = null;
        notifyPlaybackState();
    } catch (error) {
        if (candidate) VRMUtils.deepDispose(candidate.scene);
        if (!isCurrent()) return;
        animationsLoaded = Boolean(currentVrm);
        animationSelect.disabled = !Object.keys(animations).length;
        if (assetState.model) modelSelect.value = assetState.model;
        assetState = { ...assetState, loading: false, loadMilliseconds: Math.round(performance.now() - started), error: error.message };
        notifyPlaybackState();
    }
}

let rendererStarted = false;
export async function loadThreeVRM() {
    if (!rendererStarted) { rendererStarted = true; animate(); }
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
        await loadModel(vrmModels[preferred], preferred);
    } catch (error) { assetState.error = error.message; notifyPlaybackState(); }
}
modelSelect.addEventListener('change', () => loadModel(vrmModels[modelSelect.value], modelSelect.value));
animationSelect.addEventListener('change', playAnimationFromSelect);

// insane blinking system i know 
async function resetBlink() {
    await new Promise(res => setTimeout(res, 100)); // hold blink
    const minInterval = 60; // in frames
    const maxInterval = 240;
    blinkTimeout = Math.random() * (maxInterval - minInterval) + minInterval;
}

function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export function playAnimationByName(name) {
    const animation = animations[name];
    if (!animation || !currentMixer) return false;
    const generation = ++gestureGeneration;
    const performance = performanceGeneration;
    currentAnimation?.fadeOut(ANIMATION_CROSSFADE);
    animation.reset().fadeIn(ANIMATION_CROSSFADE).play();
    currentAnimation = animation;
    notifyPlaybackState();
    scheduleGesture(() => {
        if (generation !== gestureGeneration || performance !== performanceGeneration) return;
        if (animation === currentAnimation && animations.idle) {
            animations.idle.reset().fadeIn(ANIMATION_CROSSFADE).play();
            currentAnimation = animations.idle;
            animation.fadeOut(ANIMATION_CROSSFADE);
            notifyPlaybackState();
        }
    }, animation.getClip().duration - ANIMATION_CROSSFADE);
    return true;
}

export function setExpression(name, value) {
    currentExpression = { name: name, value: value };
}

function scheduleAnimationByName(name, time) {
    const generation = performanceGeneration;
    scheduleGesture(() => { if (generation === performanceGeneration) playAnimationByName(name); }, time);
}

function animate() {
    // handle resizing after like a week of ignoring it straight
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    if (currentVrm) {
        // blinking TODO: some emotions have closed eyes and blinking looks bad on them, go case by case 
        if (blinkTimeout <= 0) {
            let eyesClosed = false;
            currentVrm.expressionManager.expressions.forEach((expr) => {
                if (expr.name === "happy" && expr.weight > 0.5) eyesClosed = true;
            });
            if (!eyesClosed) {
                currentVrm.expressionManager.setValue('blinkLeft', 1);
                currentVrm.expressionManager.setValue('blinkRight', 1);
            }
            resetBlink();
        }
        else {
            currentVrm.expressionManager.setValue('blinkLeft', 0.0);
            currentVrm.expressionManager.setValue('blinkRight', 0.0);
        }
        currentVrm.update(deltaTime);
    }

    if (currentMixer) {

        currentMixer.update(deltaTime);

    }

    // subtle circular eye movement i think aha it follows the camera now that's also cool ig
    lookAtTarget.position.y = Math.sin(Math.PI * clock.elapsedTime) * 0.2;

    blinkTimeout--;
    renderer.render(scene, camera);
}

export function getPlaybackState() {
    return { ...assetState, ready: animationsLoaded, clips: Object.keys(animations),
        currentClip: Object.entries(animations).find(([, action]) => action === currentAnimation)?.[0] ?? null };
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
    const audio = data.audio;
    activeAudio = audio;
    audio.currentTime = 0;

    const descriptors = buildExpressionTracks({ duration: audio.duration, visemes: data.visemes, emotions: data.emotions }, name => {
        const expression = currentVrm.expressionManager.expressions.find(expression => expression.name.toLowerCase() === name.toLowerCase());
        return expression ? currentVrm.expressionManager.getExpressionTrackName(expression.name) : null;
    });
    const tracks = descriptors.map(track => new THREE.NumberKeyframeTrack(track.name, track.times, track.values, THREE.InterpolateLinear));

    data.actions.forEach((action) => {
        scheduleAnimationByName(action.value, action.start)
        // console.log(animations[action.value], currentMixer.time + action.start)
    });

    const mouthShapesTrack = new THREE.AnimationClip('MouthShapes', audio.duration, tracks);
    const action = currentMixer.clipAction(mouthShapesTrack);
    action.setLoop(THREE.LoopOnce, 0);
    action.play();
    performanceAction = action;
    return audio.play();
}

function playAnimationFromSelect() {
    gestureGeneration++;
    const selectedOption = animationSelect.value;

    Object.keys(animations).forEach((animationName) => {
        if (selectedOption === animationName) {
            let animation = animations[animationName];
            animation.reset().fadeIn(ANIMATION_CROSSFADE).play();
            currentAnimation = animation;
        }
        else if (!animations[animationName].paused) {
            let animation = animations[animationName];
            animation.fadeOut(ANIMATION_CROSSFADE);
        }
    })
    notifyPlaybackState();
}

