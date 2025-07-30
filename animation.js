import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './load_mixamo_animation.js';

const MODELS_INDEX_PATH = '/vrm_models/models.json';
const MODELS_PATH = "/vrm_models/"
const ANIMATIONS_PATH = '/animations/';
const ANIMATIONS_INDEX_PATH = '/animations/animations.json';
const ANIMATION_DATA_PATH = '/data/animation_data.json'; // or '/animation_data.json'; --- IGNORE ---, flask needs no slash fuck this
// "there's a difference between those two you know" – greggory house, at some point for sure
const AUDIO_PATH = "/data/tts.wav";
const FLASK_SERVER = 'http://localhost:58762';

let animationData = {};
let animations = {};
let animationsLoaded = false;

let vrmModels = {};

const animationSelect = document.getElementById('select-animation');
const modelSelect = document.getElementById("select-model")

// renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;

document.getElementById("main-container").appendChild(renderer.domElement);
renderer.domElement.id = "bg-canvas"

// camera
const camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 200.0);
camera.position.set(0.0, 1.5, 2.0);

// camera controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = true;
controls.target.set(0.0, 1.5, 0.0);
controls.update();

// scene
const scene = new THREE.Scene();

// light
const ambientLight = new THREE.AmbientLight(0xffffff, 2); // soft global light
scene.add(ambientLight);

// Floor
const floorGeo = new THREE.PlaneGeometry(20, 20);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x5F93FF, roughness: 1 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2; // flip it on the side ig
floor.position.y = -0.01;
floor.receiveShadow = true;
scene.add(floor);

const axesHelper = new THREE.AxesHelper(5);
//scene.add(axesHelper);

scene.background = new THREE.Color(0xFFA1EC);

// helpers
const gridHelper = new THREE.GridHelper(10, 10);
scene.add(gridHelper);

// gltf and vrm
let currentVrm = undefined;
let currentMixer = undefined;
let currentAction = undefined;
const loader = new GLTFLoader();
loader.crossOrigin = 'anonymous';

loader.register((parser) => {

    return new VRMLoaderPlugin(parser);

});

function loadAllFBXAnimations(vrm, mixer, animationPath, indexPath) {
    animations = {};
    animationSelect.innerHTML = ''; // wipe anims
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
            // Wait for all animations to be loaded before starting idle
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
                if (obj.Mesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });

            currentVrm = vrm;			
            currentMixer = new THREE.AnimationMixer( currentVrm.scene );
            scene.add(vrm.scene);

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
                // load animations with base asena loaded
                if (name === "asena_sfw") {
                    loadModel(url);
                }
            });
        })
}

export async function loadThreeVRM() {
    // first wipe the fucking animation data from the file at the beginning

    let _data = { "visemes": [], "soundFile": "" };
    fetch(`${FLASK_SERVER}/save_json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json_data: _data, filename: ANIMATION_DATA_PATH })
    })
        .then(response => response.json())
        .then(data => {
            if (!data || data.error) {
                console.error('ERROR: Error saving animation_data.json:', data?.error);
                return Promise.reject(data?.error);
            }
            console.log('LOG: animation_data.json wiped:', data.saved_to);
        })
        .catch(error => {
            console.error('ERROR: Error wiping animation_data.json:', error);
        });

    await registerVRMModels(MODELS_PATH, MODELS_INDEX_PATH);
    modelSelect.addEventListener('change', function () {
        console.log("LOG: Loading model", vrmModels[modelSelect.value], modelSelect.value);
        loadModel(vrmModels[modelSelect.value]);
    });
    animate();
}

// animate
const clock = new THREE.Clock();
let startTime = 0;
// TODO: combine vrm visemes to mimic rhubarb visemes in more detail
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
let audio = new Audio(AUDIO_PATH); // reload even the file, might have changed
audio.onended = function () {
    // Code to run after audio finishes
    audio_over = true;
    console.log('LOG: Audio finished!');
};
let audio_over = false;


function animate() {

    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    let currentTime = clock.getElapsedTime();
    let relCurrentTime = currentTime - startTime;

    if (currentVrm) {

        currentVrm.update(deltaTime);

    }

    if (currentMixer) {

        currentMixer.update(deltaTime);

    }

    renderer.render(scene, camera);

}

export function startExperience() {
    if (!animationsLoaded) {
        console.error('ERROR: Animations not loaded yet.');
        return;
    }
    audio = new Audio(`${AUDIO_PATH}?t=${Date.now()}`);
    fetch(ANIMATION_DATA_PATH)
        .then(response => response.json())
        .then(data => {
            audio.pause();
            audio.currentTime = 0;

            animationData = data;
            let audio_over = false;

            // Remove old mouthShapesTrack actions
            if (currentMixer) {
                currentMixer._actions.forEach(act => {
                    if (act._clip && act._clip.name === 'MouthShapes') {
                        act.stop();
                        currentMixer.uncacheAction(act._clip);
                    }
                });
            }

            let tracks = [];
            // loop over rhubarbToVRM and create tracks
            Object.keys(rhubarbToVRM).forEach((key) => {
                const vrmExpression = rhubarbToVRM[key];
                const times = [];
                const values = [];
                animationData.visemes.forEach((viseme) => {
                    if (viseme.value === key) {
                        times.push(viseme.start);
                        values.push(1.0);
                    }
                    else {
                        times.push(viseme.start);
                        values.push(0.0);
                        times.push(viseme.end);
                        values.push(0.0);
                    }
                })
                let currentTrack = new THREE.NumberKeyframeTrack(
                    currentVrm.expressionManager.getExpressionTrackName(vrmExpression), // name
                    times, // times
                    values, // values
                    THREE.InterpolateLinear // interpolation
                );
                tracks.push(currentTrack);
            });

            const mouthShapesTrack = new THREE.AnimationClip('MouthShapes', audio.duration + 1, tracks);
            const action = currentMixer.clipAction(mouthShapesTrack);
            action.setLoop(THREE.LoopOnce, 0);
            action.blendMode = THREE.AdditiveAnimationBlendMode;

            action.clampWhenFinished = true;
            action.play();

            audio.play();
            audio_over = false;
            startTime = clock.getElapsedTime();
        })
        .catch(error => console.error('ERROR: Error loading JSON:', error));
}

function playAnimationFromSelect() {
    const selectedOption = animationSelect.value;

    Object.keys(animations).forEach((animationName) => {
        if (selectedOption === animationName) {
            let animation = animations[animationName];
            animation.reset().fadeIn(1.0).play();
            currentAction = animation;
        }
        else if (!animations[animationName].paused) {
            let animation = animations[animationName];
            animation.fadeOut(1.0);
        }
    })
}
