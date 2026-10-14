// Metadata and a prepared opening region are not audible playback yet.
export function dueGestures(actions,clock,seen,available,graceSeconds=.75) {
    if(clock.playedFrames<=0||clock.paused||clock.buffering||clock.finished)return [];
    const due=[];
    for(const cue of actions??[]){
        const key=`${cue.value}:${cue.start}`;
        if(cue.start>clock.playedSeconds||seen.has(key))continue;
        if(clock.playedSeconds-cue.start>graceSeconds){seen.add(key);continue;}
        if(!available.has(cue.value))continue;
        seen.add(key);due.push(cue);
    }
    return due;
}
