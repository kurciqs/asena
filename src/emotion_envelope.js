export const EMOTION_NAMES=['happy','sad','angry','surprised','relaxed'];
export const EXPRESSION_PRESETS={
    soft:{strength:.55,attack:.65,hold:2.5,release:1.2,talkingSmile:.35},
    balanced:{strength:.75,attack:.45,hold:4,release:.9,talkingSmile:.5},
    expressive:{strength:1,attack:.25,hold:6,release:.6,talkingSmile:.75}
};
export const EXPRESSION_LIMITS={strength:[0,1],attack:[.05,2],hold:[.5,12],release:[.1,3],talkingSmile:[0,1]};
export function expressionPreferences(value={}) {
    const defaults=EXPRESSION_PRESETS.balanced;
    return Object.fromEntries(Object.entries(EXPRESSION_LIMITS).map(([key,[min,max]])=>
        [key,Number.isFinite(value?.[key])?Math.max(min,Math.min(max,value[key])):defaults[key]]));
}
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

// Stateless sampling makes expression fades pause/seek with the audible clock.
export function emotionWeightsAt(cues,time,{settings=EXPRESSION_PRESETS.balanced,duration=Infinity,speaking=false}={}) {
    settings=expressionPreferences(settings);
    const output=Object.fromEntries(EMOTION_NAMES.map(name=>[name,0]));
    if(!Number.isFinite(time)||time<0)return output;
    for(const cue of cues??[]){
        if(!EMOTION_NAMES.includes(cue.value)||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.end<=cue.start)continue;
        const end=Math.min(duration,cue.end+settings.release,cue.start+settings.attack+settings.hold+settings.release);
        if(time<cue.start||time>=end)continue;
        const attack=Math.min(settings.attack,(end-cue.start)/2);
        const release=Math.min(settings.release,(end-cue.start)/2);
        const envelope=ease((time-cue.start)/attack)*(1-ease((time-(end-release))/release));
        const base=cue.value==='happy'?.3:.5;
        const speakingScale=speaking&&cue.value==='happy'?settings.talkingSmile:1;
        output[cue.value]=Math.max(output[cue.value],base*settings.strength*speakingScale*envelope);
    }
    const total=Object.values(output).reduce((sum,n)=>sum+n,0);
    if(total>.6)for(const name of EMOTION_NAMES)output[name]*=.6/total;
    return output;
}
