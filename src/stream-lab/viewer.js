import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';
import {loadMixamoAnimation} from '../load_mixamo_animation.js';
import {CHANNELS,boundedWeights} from '../rhubarb_mouth.js';

export async function createViewer(stage) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;stage.append(renderer.domElement);
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x777588,1.3));
  const light=new THREE.DirectionalLight(0xffffff,1.2);light.position.set(2,3,4);scene.add(light);
  const camera=new THREE.PerspectiveCamera(30,1,.05,100);
  const loader=new GLTFLoader();loader.register(p=>new VRMLoaderPlugin(p));
  let vrm;
  try {
    const gltf=await loader.loadAsync('/vrm_models/asena_sfw.vrm');vrm=gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm);vrm.scene.updateMatrixWorld(true);
    const close=[],actual=[];
    vrm.scene.traverse(mesh=>{
      const index=mesh.morphTargetDictionary?.Fcl_MTH_Close;
      if(index!==undefined)close.push({mesh,index});
      for(const [name,index] of Object.entries(mesh.morphTargetDictionary??{}))if(/^Fcl_MTH_[AIUEO]$|^Fcl_MTH_Close$/.test(name))actual.push({mesh,index,name});
      mesh.frustumCulled=false;
    });
    for(const name of CHANNELS.slice(0,5))if(!vrm.expressionManager.getExpression(name))throw new Error(`Missing ${name} binding`);
    if(!close.length)throw new Error('Missing mouth closure binding');
    scene.add(vrm.scene);
    try {const idle=await loadMixamoAnimation('/animations/idle.fbx',vrm);const mixer=new THREE.AnimationMixer(vrm.scene);mixer.clipAction(idle).play();mixer.setTime(1.5);}catch{}
    const target=vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3());target.y+=.04;
    camera.position.set(target.x,target.y,target.z+.72);camera.lookAt(target);
    let previous=CHANNELS.map(()=>0);
    function draw(weights) {
        weights=boundedWeights(weights);previous=weights;CHANNELS.slice(0,5).forEach((name,i)=>vrm.expressionManager.setValue(name,weights[i]));
        vrm.expressionManager.setValue('happy',0);vrm.update(0);
        for(const {mesh,index} of close)mesh.morphTargetInfluences[index]=weights[5];
        renderer.render(scene,camera);
        return {mouthBindingCount:actual.length,peakAppliedMorph:Math.max(0,...actual.map(({mesh,index})=>mesh.morphTargetInfluences[index]))};
    }
    const resize=()=>{const {width,height}=stage.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();draw(previous);};
    window.addEventListener('resize',resize);resize();
    return {
      draw,
      dispose(){window.removeEventListener('resize',resize);renderer.dispose();VRMUtils.deepDispose(vrm.scene);}
    };
  } catch(error) {renderer.dispose();throw error;}
}
