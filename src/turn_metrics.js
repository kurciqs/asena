// Per-turn local diagnostics. Control tokens and PCM are never exported.
export function reportData(value) {
    if(Array.isArray(value))return value.map(reportData);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
        .filter(([key])=>!['token','pcm','audio'].includes(key)).map(([key,item])=>[key,reportData(item)]));
    return value;
}

export class TurnMetrics {
    constructor(id,config,now=()=>performance.now()) {
        this.id=id;this.config=structuredClone(config);this.now=now;this.started=now();
        this.milestones={submitted:0};this.ended=null;this.status='requesting';this.speech=null;this.clock=null;
        this.expressionEdits=[];
    }
    mark(name,seconds=(this.now()-this.started)/1000) {
        if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid turn milestone');
        this.milestones[name]??=seconds;
    }
    observeSpeech(report) {
        this.speech=reportData(report);
        const first=report.browser?.firstPlaybackSeconds;
        if(Number.isFinite(first)&&this.milestones.speechRequested!==undefined)
            this.mark('firstAudio',this.milestones.speechRequested+first);
    }
    observeClock(clock) {
        this.clock={...clock};
        if(Number.isFinite(clock.firstPlaybackSeconds)&&clock.playedFrames>0&&this.milestones.speechRequested!==undefined)
            this.mark('firstAudio',this.milestones.speechRequested+clock.firstPlaybackSeconds);
    }
    finish(status) {this.status=status;this.ended??=(this.now()-this.started)/1000;}
    recordExpressionChange(settings){if(this.ended===null){this.expressionEdits.push({seconds:(this.now()-this.started)/1000,settings:{...settings}});this.expressionEdits=this.expressionEdits.slice(-32);}}
    snapshot() {
        const m=this.milestones,span=(a,b)=>Number.isFinite(m[a])&&Number.isFinite(m[b])?m[b]-m[a]:null;
        return {turnId:this.id,status:this.status,config:this.config,elapsedSeconds:this.ended??(this.now()-this.started)/1000,
            milestones:{...m},durations:{reply:span('submitted','firstText'),parsing:span('firstText','parsed'),
                gesturePreparation:span('gesturePreparation','gesturesReady'),speechStartup:span('speechRequested','firstAudio'),
                memoryExtraction:span('memoryStart','memoryEnd')},speech:this.speech,clock:this.clock,
            expressionEdits:this.expressionEdits.slice(),measurement:'Local monotonic timings. Scripted replies are not LLM latency. First audio uses the estimated audible output clock.',
            unmeasured:['service/model boot','pure Kokoro inference','combined LLM/TTS peak memory']};
    }
}
