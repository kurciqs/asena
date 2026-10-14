import * as THREE from 'three';
import {prepareVrmExpressionTracks,MOUTH_EXPRESSIONS} from './expression_tracks.js';

// Precompute interrupted fades so skipped frames can seek directly to a pose,
// rather than firing old gesture timers in a burst when rendering resumes.
export class ClockedBodyPlayback {
    constructor(actions,cues,duration,fade=.5) {
        this.actions=actions;this.fade=fade;this.entries=[];
        const weights=Object.fromEntries(Object.entries(actions).map(([name,action])=>[name,action.isRunning()?action.getEffectiveWeight():0]));
        const total=Object.values(weights).reduce((sum,value)=>sum+value,0);
        for(const name of Object.keys(weights))weights[name]=total?weights[name]/total:Number(name==='idle');
        let origins=Object.fromEntries(Object.entries(actions).map(([name,action])=>[name,-action.time]));
        const events=[{time:0,name:'idle'}];
        const ordered=cues.filter(cue=>actions[cue.value]).map(cue=>({...cue})).sort((a,b)=>a.start-b.start);
        ordered.forEach((cue,index)=>{
            if(cue.value==='idle') {events.push({time:cue.start,name:'idle'});return;}
            const clipDuration=actions[cue.value].getClip().duration;
            events.push({time:cue.start,name:cue.value});
            const end=Math.min(duration,cue.start+clipDuration-Math.min(fade,clipDuration/2));
            if(end>cue.start && (!ordered[index+1] || ordered[index+1].start>end)) events.push({time:end,name:'idle'});
        });
        for(const event of events.sort((a,b)=>a.time-b.time)) {
            const previous=this.state(event.time);
            const starts=previous?.weights??weights;
            origins={...origins};
            if(event.name!=='idle')origins[event.name]=event.time;
            if(actions[event.name])this.entries.push({...event,starts,origins});
        }
    }
    state(time) {
        const entry=this.entries.findLast(entry=>entry.time<=time);
        if(!entry)return null;
        const blend=Math.max(0,Math.min(1,(time-entry.time)/this.fade));
        return {...entry,weights:Object.fromEntries(Object.keys(this.actions).map(name=>
            [name,entry.starts[name]*(1-blend)+Number(name===entry.name)*blend]))};
    }
    sample(time,wallDelta=0) {
        const state=this.state(time);
        if(!state)return null;
        for(const [name,action] of Object.entries(this.actions)) {
            const weight=state.weights[name];
            if(weight>0 || name==='idle') {
                if(!action.isRunning())action.reset().play();
                action.stopFading();action.setEffectiveWeight(weight);
                const duration=action.getClip().duration;
                action.time=name==='idle' ? (action.time+wallDelta)%duration : Math.max(0,time-state.origins[name])%duration;
            } else action.stop();
        }
        return this.actions[state.name];
    }
}

export class ClockedAvatarPerformance {
    constructor({mixer,manager,animations,bodyPlayback,data}) {
        Object.assign(this,{mixer,manager,animations,bodyPlayback});
        this.emotions=data.emotions??[];
        const {tracks,warning}=prepareVrmExpressionTracks({duration:data.audio.duration,visemes:data.visemes,emotions:data.emotions,expressionSettings:data.expressionSettings},manager);
        this.inspection={trackCount:tracks.length,peakMouthWeight:0,peakMouthMorphWeight:0,warning};
        if(warning)data.onWarning?.(warning);
        const clip=new THREE.AnimationClip('SpeechExpressions',data.audio.duration,tracks.map(track=>
            new THREE.NumberKeyframeTrack(track.name,track.times,track.values,THREE.InterpolateLinear)));
        this.action=mixer.clipAction(clip);this.action.setLoop(THREE.LoopOnce,0);this.action.clampWhenFinished=true;
        this.action.play();this.action.paused=true; // Only explicit audio-time samples advance facial animation.
        this.body=new ClockedBodyPlayback(animations,data.actions,data.audio.duration);
        if(bodyPlayback)bodyPlayback.transitionState=null;
    }
    sample(time,wallDelta=0) {
        const target=this.body.sample(time,wallDelta);
        this.action.time=time;this.mixer.update(0);
        return target;
    }
    stop() {
        this.action.stop();this.mixer.uncacheClip(this.action.getClip());
        for(const name of [...MOUTH_EXPRESSIONS,'happy','angry','sad','relaxed','surprised']) {
            if(this.manager.getExpression(name))this.manager.setValue(name,0);
        }
        this.manager.update();
        if(this.bodyPlayback && this.animations.idle) {
            this.bodyPlayback.current=null;this.bodyPlayback.transition(this.animations.idle);
        }
    }
}
