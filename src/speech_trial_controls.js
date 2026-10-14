export const SPEECH_TRIAL_KEY='asena.speech-trials.v1';
export function speechTrial(value,baseline){
    const choose=(key,allowed)=>allowed.includes(value?.[key])?value[key]:baseline[key];
    const settings={openingSeconds:choose('openingSeconds',[.5,1,2]),policy:choose('policy',['1s','2s','3s']),
        startupSeconds:choose('startupSeconds',[.5,1,2,4]),strategy:choose('strategy',['sentences','phrases','whole'])};
    const matches=Object.entries(settings).every(([key,n])=>n===baseline[key]);
    return {profile:{...baseline,...settings,id:matches?baseline.id:'custom',label:matches?baseline.label:'Custom trial'},
        speed:Number.isFinite(value?.speed)?Math.max(.5,Math.min(2,value.speed)):1};
}
export function setupSpeechTrials(document,storage,baseline){
    let saved={};try{saved=JSON.parse(storage.getItem(SPEECH_TRIAL_KEY)??'{}');}catch{}
    let current=speechTrial(saved,baseline);
    const ids={openingSeconds:'speech-opening',policy:'speech-regions',startupSeconds:'speech-reserve',strategy:'speech-strategy',speed:'speech-speed'};
    const render=()=>{
        for(const [key,id] of Object.entries(ids))document.getElementById(id).value=key==='speed'?current.speed:current.profile[key];
        document.getElementById('speech-speed-value').textContent=`${current.speed.toFixed(2)}×`;
    };
    const change=()=>{
        const values=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,['speed','openingSeconds','startupSeconds'].includes(key)?Number(document.getElementById(id).value):document.getElementById(id).value]));
        current=speechTrial(values,baseline);render();
        try{storage.setItem(SPEECH_TRIAL_KEY,JSON.stringify({...current.profile,speed:current.speed}));}catch{}
    };
    for(const id of Object.values(ids))document.getElementById(id).addEventListener('input',change);
    document.getElementById('speech-reset').addEventListener('click',()=>{
        current=speechTrial({},baseline);render();try{storage.removeItem(SPEECH_TRIAL_KEY);}catch{}
    });
    render();
    return {snapshot:()=>structuredClone(current),setSource:source=>{
        for(const [key,id] of Object.entries(ids))document.getElementById(id).disabled=source==='replay'||source!=='kokoro'&&['strategy','speed'].includes(key);
        document.getElementById('speech-trial-note').textContent=source==='kokoro'?
            'For the next turn. Whole-request mode is limited to 180 characters; long passages should use sentences.':
            source==='replay'?'Whole-WAV replay uses recorded audio; these settings apply in streamed preview/live mode.':
            'Saved voice uses existing audio/cues; region and reserve settings affect packaging/playback. No new TTS or Rhubarb runs.';
    }};
}
