import {EMOTION_NAMES} from './emotion_envelope.js';

// Read the rig after animation, rather than recomputing the desired envelope.
// This also covers full-WAV mixer tracks and cleared/stopped performances.
export function sampleExpressionDisplay(manager,{emotions=[],time=0,cueTime=time,phase='idle',active=false}={}) {
    const weights={},missing=[];
    for(const name of EMOTION_NAMES){
        if(!manager?.getExpression(name)){missing.push(name);continue;}
        const value=manager.getValue(name);
        weights[name]=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
    }
    const cue=active?emotions.findLast(cue=>cue.start<=cueTime&&cueTime<cue.end)?.value??null:null;
    return {available:Boolean(manager),weights,missing,cue,time:Number.isFinite(time)?time:0,phase};
}

const title=name=>name[0].toUpperCase()+name.slice(1);
export function expressionDisplayText(display) {
    if(!display?.available)return {summary:'Avatar not ready',detail:'Expression weights appear once the avatar is ready.',clock:''};
    const active=EMOTION_NAMES.map(name=>({name,percent:Math.round((display.weights[name]??0)*100)}))
        .filter(item=>item.percent>0).sort((a,b)=>b.percent-a.percent);
    const states={idle:'Idle',starting:'Waiting for audio',playing:'Playing',paused:'Paused',waiting:'Waiting for audio',buffering:'Buffering',completed:'Finished',stopped:'Stopped',failed:'Stopped'};
    return {
        summary:active.length?active.map(item=>title(item.name)).join(' + '):display.missing.length===EMOTION_NAMES.length?'No emotion bindings':'Neutral',
        detail:(active.length?active.map(item=>`${title(item.name)} ${item.percent}%`).join(' · '):'All available weights below 0.5%.')+
            (display.missing.length?` Unavailable: ${display.missing.map(title).join(', ')}.`:''),
        clock:`${display.time.toFixed(1)}s · ${states[display.phase]??display.phase} · Cue: ${display.cue?title(display.cue):'none'}`
    };
}

export function createExpressionReadouts(document) {
    const views=[...document.querySelectorAll('[data-expression-readout]')].map(root=>{
        const label=document.createElement('span');label.className='eyebrow';label.textContent='CURRENTLY DISPLAYED';
        label.title='Rig expression weights after fades and speech scaling, rounded to the nearest percent.';
        const summary=document.createElement('strong'),detail=document.createElement('p'),clock=document.createElement('p');
        detail.className='field-hint';clock.className='field-hint expression-clock';
        root.append(label,summary,detail,clock);return {root,summary,detail,clock};
    });
    const visible=root=>!document.hidden&&!root.closest('[hidden]')&&(!root.closest('details')||root.closest('details').open);
    return {update(display){
        const targets=views.filter(view=>visible(view.root));if(!targets.length)return;
        const text=expressionDisplayText(display);
        for(const view of targets)for(const key of ['summary','detail','clock'])if(view[key].textContent!==text[key])view[key].textContent=text[key];
    }};
}
