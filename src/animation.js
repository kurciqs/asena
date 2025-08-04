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

function loadAllFBXAnimations(vrm, mixer, animationPath, indexPath) {
    animations = {};
    animationSelect.innerHTML = '';
    fetch(indexPath)
        .then(response => response.json())
        .then(animationFiles => {
            let idleFound = false;
            animationFiles.forEach(async (file) => {
                const url = animationPath + file;
                const clip = await loadMixamoAnimation(url, vrm);
                const action = mixer.clipAction(clip);
                const name = file.split('.').slice(0, -1).join('.');
                animations[name] = action;
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                animationSelect.appendChild(option);
                console.log("LOG: Loaded animation:", name)
                if (name === 'idle') idleFound = true;
            });
            animationSelect.addEventListener('change', playAnimationFromSelect);
            Promise.all(animationFiles.map(file => {
                const name = file.split('.').slice(0, -1).join('.');
                return new Promise(resolve => {
                    const check = () => {
                        if (animations[name]) resolve();
                        else setTimeout(check, 10);
                    };
                    check();
                });
            })).then(() => {
                if (idleFound && animations['idle']) {
                    animationSelect.value = 'idle';
                    currentAnimation = animations['idle'];
                    playAnimationFromSelect();
                }
                console.log("LOG: Starting idle...")
            });
            animationsLoaded = true;
        })
}

function loadModel(url) {

    loader.load(

        url,

        (gltf) => {

            const vrm = gltf.userData.vrm;
            animationsLoaded = false;
            // calling these functions greatly improves the performance
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.combineSkeletons(gltf.scene);
            VRMUtils.combineMorphs(vrm);

            if (currentVrm) {

                scene.remove(currentVrm.scene);
                VRMUtils.deepDispose(currentVrm.scene);

            }

            // Disable frustum culling
            vrm.scene.traverse((obj) => {
                obj.frustumCulled = false;
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });

            currentVrm = vrm;
            currentMixer = new THREE.AnimationMixer(currentVrm.scene);
            scene.add(vrm.scene);

            currentVrm.lookAt.target = lookAtTarget;

            loadAllFBXAnimations(currentVrm, currentMixer, ANIMATIONS_PATH, ANIMATIONS_INDEX_PATH);

            // rotate if the VRM is VRM0.0
            VRMUtils.rotateVRM0(vrm);

            console.log(vrm);
        },

        (progress) => console.log('Loading model...', 100.0 * (progress.loaded / progress.total), '%'),

        (error) => console.error(error)

    );

}

async function registerVRMModels(modelPath, indexPath) {
    await fetch(indexPath)
        .then(response => response.json())
        .then(modelFiles => {
            modelFiles.forEach(async (file) => {
                const url = modelPath + file;
                const name = file.split('.').slice(0, -1).join('.');
                vrmModels[name] = url;
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                modelSelect.appendChild(option);

                console.log("LOG: Registered model:", name)
                // load animations with base dust loaded
                if (name === "asena_sfw") {
                    loadModel(url);
                    modelSelect.value = "asena_sfw"
                }
            });
        })
}

export async function loadThreeVRM() {
    await registerVRMModels(MODELS_PATH, MODELS_INDEX_PATH);
    modelSelect.addEventListener('change', function () {
        console.log("LOG: Loading model", vrmModels[modelSelect.value], modelSelect.value);
        loadModel(vrmModels[modelSelect.value]);
    });
    // initial three.js render, then it loops with requestAnimationFrame()
    animate();
}

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

export async function playAnimationByName(name) {
    let animation = animations[name];
    if (animation === currentAnimation) return; // fuck that
    currentAnimation.fadeOut(ANIMATION_CROSSFADE);
    animation.reset().fadeIn(ANIMATION_CROSSFADE).play();
    currentAnimation = animation;

    // IT'S A HOUSE OF CARDS BABAY BUT IT'S STABLE IT'S STABLE
    await sleep(animation.getClip().duration - ANIMATION_CROSSFADE)

    // go back to idle, only if we have not changed current since then PROBLEM if someone double requests the same animation, lets hope asena won't do that
    if (animation === currentAnimation) {
        animations["idle"].reset().fadeIn(ANIMATION_CROSSFADE).play()
        currentAnimation = animations["idle"];
        animation.fadeOut(ANIMATION_CROSSFADE)
    }
}

export function setExpression(name, value) {
    currentExpression = { name: name, value: value };
}

async function scheduleAnimationByName(name, time) {
    await sleep(time);
    playAnimationByName(name);
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

export function talk(data) {
    if (!animationsLoaded) {
        console.error('ERROR: Animations not loaded yet.');
        return;
    }

    let audio = data.audio;
    audio.pause();
    audio.currentTime = 0;

    // Remove old mouthShapesTrack actions
    if (currentMixer) {
        currentMixer._actions.forEach(act => {
            if (act._clip && act._clip.name === 'MouthShapes') {
                act.stop();
                currentMixer.uncacheAction(act._clip);
            }
        });
    }

    // TODO: this breaks on empty animationData
    let tracks = [];
    Object.keys(rhubarbToVRM).forEach((key) => {
        const vrmExpression = rhubarbToVRM[key];
        let times = [];
        let values = [];
        data.visemes.forEach((viseme) => {
            if (viseme.value === key) {
                times.push((viseme.start + viseme.end) / 2);
                values.push(1.0);
            }
            else {
                times.push(viseme.end);
                values.push(0.0);
            }
        })
        if (times.length === 0) { times = [0.0]; values = [0.0]; }
        let currentTrack = new THREE.NumberKeyframeTrack(
            currentVrm.expressionManager.getExpressionTrackName(vrmExpression), // name
            times, // times
            values, // values
            THREE.InterpolateLinear // interpolation
        );
        tracks.push(currentTrack);
    });

    expressionOptions.forEach((key) => {
        let times = [0];
        let values = [0];
        data.emotions.forEach((emotion) => {
            let rEmotion = emotion.value;
            let intensity = key === "happy" ? 0.3 : 0.5; // being happy is very contageous, gotta level it, as per dr house
            if (rEmotion === key) {
                times.push(emotion.start - 0.05);
                values.push(0.0);
                times.push(emotion.start);
                values.push(intensity);
                times.push(emotion.end);
                values.push(intensity);
                times.push(emotion.end + 0.05);
                values.push(0.0);
            }
        });

        let trackName = currentVrm.expressionManager.getExpressionTrackName(key);
        if (trackName) {
            let currentTrack = new THREE.NumberKeyframeTrack(
                trackName, // name
                times, // times
                values, // values
                THREE.InterpolateLinear // interpolation
            );
            tracks.push(currentTrack);
        }
        else {
            // surprise is capitalised with some vrms which i have, there might be others like this but that depends on the VRM you load, i can't deal with that. if surprised with a small s failed, do the same for Surprised with a capitalised S
            console.log("WARNING: Non-Existent expression requested:", key)
            if (key === "surprised") {
                let currentTrack = new THREE.NumberKeyframeTrack(
                    "Surprised", // name
                    times, // times
                    values, // values
                    THREE.InterpolateLinear // interpolation
                );
                tracks.push(currentTrack);
                console.log("LOG: Expression corrected to:", "Surprised")
            }
        }
    });

    data.actions.forEach((action) => {
        scheduleAnimationByName(action.value, action.start)
        // console.log(animations[action.value], currentMixer.time + action.start)
    });

    const mouthShapesTrack = new THREE.AnimationClip('MouthShapes', audio.duration + 1, tracks);
    const action = currentMixer.clipAction(mouthShapesTrack);
    action.setLoop(THREE.LoopOnce, 0);
    action.play();
    audio.play();
}

function playAnimationFromSelect() {
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
}

