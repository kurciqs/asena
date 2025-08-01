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
const FLASK_SERVER = 'http://localhost:58762';

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

// ------- THREE JS AND MORE RENDERING -------
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.getElementById("main-container").appendChild(renderer.domElement);
renderer.domElement.id = "bg-canvas"
const camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 200.0);
camera.position.set(0.0, 1.5, 2.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = true;
controls.target.set(0.0, 1.5, 0.0);
controls.update();
const scene = new THREE.Scene();
const ambientLight = new THREE.AmbientLight(0xffffff, 2); // soft global light
scene.add(ambientLight);
const floorGeo = new THREE.PlaneGeometry(20, 20);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x5F93FF, roughness: 1 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2; // flip it on the side ig
floor.position.y = -0.01;
floor.receiveShadow = true;
scene.add(floor);
const axesHelper = new THREE.AxesHelper(5);
scene.background = new THREE.Color(0xFFA1EC);
const gridHelper = new THREE.GridHelper(10, 10);
scene.add(gridHelper);
let currentVrm = undefined;
let currentMixer = undefined;
const loader = new GLTFLoader();
loader.crossOrigin = 'anonymous';
loader.register((parser) => {
    return new VRMLoaderPlugin(parser);
});

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
            currentMixer = new THREE.AnimationMixer(currentVrm.scene);
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
                // load animations with base dust loaded
                if (name === "dust") {
                    loadModel(url);
                    modelSelect.value = "dust"
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
    const minInterval = 120; // in frames
    const maxInterval = 360;
    blinkTimeout = Math.random() * (maxInterval - minInterval) + minInterval;
}

function animate() {

    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    if (currentVrm) {
        if (blinkTimeout <= 0) {
            const s = Math.cos(Math.PI * clock.elapsedTime);
            currentVrm.expressionManager.setValue('blinkLeft', 1);
            currentVrm.expressionManager.setValue('blinkRight', 1);
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

    blinkTimeout--;
    renderer.render(scene, camera);

}

export function startExperience(data) {
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
        if (times.length == 0) { times = [0.0]; values = [0.0]; }
        let currentTrack = new THREE.NumberKeyframeTrack(
            currentVrm.expressionManager.getExpressionTrackName(vrmExpression), // name
            times, // times
            values, // values
            THREE.InterpolateLinear // interpolation
        );
        tracks.push(currentTrack);
    });

    const mouthShapesTrack = new THREE.AnimationClip('MouthShapes', audio.duration, tracks);
    const action = currentMixer.clipAction(mouthShapesTrack);
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    action.play();
    audio.play();
}

function playAnimationFromSelect() {
    const selectedOption = animationSelect.value;

    Object.keys(animations).forEach((animationName) => {
        if (selectedOption === animationName) {
            let animation = animations[animationName];
            animation.reset().fadeIn(1.0).play();
        }
        else if (!animations[animationName].paused) {
            let animation = animations[animationName];
            animation.fadeOut(1.0);
        }
    })
}
