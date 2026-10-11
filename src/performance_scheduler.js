const abortError = () => new DOMException('Turn stopped', 'AbortError');

// Timers only detect failure. Performance time always comes from played audio.
export class AudioPerformanceScheduler {
    constructor({onSegment=()=>{}, onTime=()=>{}, onSegmentEnd=()=>{}, onState=()=>{},
        maxSegments=4, maxQueuedSeconds=180, maxTotalSeconds=600, stallMs=8000,
        now=()=>performance.now(), repeat=callback=>setInterval(callback,100), cancel=id=>clearInterval(id)}={}) {
        Object.assign(this,{onSegment,onTime,onSegmentEnd,onState,maxSegments,maxQueuedSeconds,maxTotalSeconds,stallMs,now,repeat,cancel});
        this.queue=[]; this.current=null; this.phase='idle'; this.generation=0;
        this.offset=0; this.time=0; this.closed=true; this.userPaused=false; this.running=false;
    }
    snapshot() {
        return {phase:this.phase, segmentTime:this.time, playedSeconds:this.offset+this.time,
            queuedSegments:this.queue.length, bufferedSeconds:this.queue.reduce((sum,item)=>sum+item.audio.duration,0),
            accepting:this.running&&!this.closed, paused:this.userPaused,
            limits:{segments:this.maxSegments, bufferedSeconds:this.maxQueuedSeconds}, error:this.error??null};
    }
    publish(phase=this.phase) { this.phase=phase; this.onState(this.snapshot()); }
    begin({signal}={}) {
        this.stop(); this.generation++; this.queue=[]; this.current=null;
        this.offset=0; this.time=0; this.total=0; this.accepted=0; this.seen=new WeakSet();
        this.closed=false; this.userPaused=false; this.running=true; this.error=null;
        this.lastProgress=this.now(); this.observed=0; this.signal=signal;
        this.done=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
        this.done.catch(()=>{}); // Producers may enqueue before the consumer awaits done.
        this.aborted=()=>this.stop();
        signal?.addEventListener('abort',this.aborted,{once:true});
        this.watch=this.repeat(()=>this.checkProgress());
        this.publish('buffering');
        if(signal?.aborted) this.stop();
        return this.done;
    }
    enqueue(segment) {
        if(!this.running || this.closed) throw new Error('The speech queue is closed.');
        const audio=segment?.audio, duration=audio?.duration;
        if(!audio || !Number.isFinite(duration) || duration<=0 || duration>this.maxQueuedSeconds ||
            !['play','pause','addEventListener','removeEventListener'].every(key=>typeof audio[key]==='function')) {
            throw new Error('A speech segment needs playable audio with finite duration within the queue limit.');
        }
        for(const name of ['visemes','emotions','actions']) {
            const cues=segment[name]??[];
            if(!Array.isArray(cues) || cues.length>4096 || cues.some(cue=>!cue || typeof cue.value!=='string' || !Number.isFinite(cue.start) || cue.start<0 ||
                cue.start>duration || (name!=='actions' && (!Number.isFinite(cue.end) || cue.end<cue.start || cue.end>duration+.05)))) {
                throw new Error(`Invalid or oversized ${name} in speech segment.`);
            }
        }
        const held=[...this.queue,...(this.current?[this.current.segment]:[])];
        if(held.length>=this.maxSegments || held.reduce((sum,item)=>sum+item.audio.duration,0)+duration>this.maxQueuedSeconds) {
            throw new Error('Speech queue is full; wait for playback before adding another segment.');
        }
        if(this.seen.has(audio)) throw new Error('Each speech segment needs its own audio instance.');
        if(this.accepted>=256 || this.total+duration>this.maxTotalSeconds) throw new Error('Speech turn exceeds its segment or duration limit.');
        this.seen.add(audio); this.accepted++; this.total+=duration;
        const record={...segment};
        for(const name of ['visemes','emotions','actions'])record[name]=(segment[name]??[]).map(cue=>({...cue}));
        this.queue.push(record);
        this.advance(); this.publish();
    }
    finish() {
        if(!this.running) return;
        this.closed=true; this.advance(); this.publish();
    }
    play(segments,options={}) {
        const done=this.begin(options);
        try { for(const segment of segments) this.enqueue(segment); this.finish(); }
        catch(error) { this.fail(error); }
        return done;
    }
    advance() {
        if(!this.running || this.current) return;
        if(!this.queue.length) {
            if(this.closed) this.settle('completed');
            else {this.lastProgress=this.now();this.publish(this.userPaused?'paused':'buffering');}
            return;
        }
        if(this.userPaused) return;
        const segment=this.queue.shift(),audio=segment.audio;
        const owner={segment,listeners:[],generation:this.generation}; this.current=owner;
        this.time=0; this.observed=0; this.lastProgress=this.now();
        const listen=(name,callback)=>{audio.addEventListener(name,callback);owner.listeners.push([name,callback]);};
        const active=()=>this.running&&this.current===owner;
        listen('ended',()=>{if(active())this.endSegment();});
        listen('error',()=>{if(active())this.fail(new Error('Audio playback failed.'));});
        for(const name of ['waiting','stalled']) listen(name,()=>{if(active()&&!this.userPaused)this.publish('waiting');});
        listen('playing',()=>{if(active()&&!this.userPaused)this.publish('playing');});
        listen('pause',()=>{if(active()&&!audio.ended)this.publish(this.userPaused?'paused':'waiting');});
        try {
            audio.currentTime=0; this.onSegment(segment); this.publish('starting');
            this.startAudio(owner);
        } catch(error) {this.fail(error);}
    }
    startAudio(owner) {
        const audio=owner.segment.audio;
        Promise.resolve().then(()=>{
            if(!this.running || this.current!==owner || this.userPaused) return;
            return audio.play();
        }).then(()=>{
            if(!this.running || this.current!==owner) {
                if(this.current?.segment.audio!==audio) audio.pause();
            } else if(this.userPaused) audio.pause();
            else this.publish('playing');
        }).catch(error=>{if(this.running&&this.current===owner&&!this.userPaused)this.fail(error);});
    }
    sample(wallDelta=0) {
        if(!this.current) return;
        const duration=this.current.segment.audio.duration;
        this.time=Math.max(0,Math.min(duration,Number(this.current.segment.audio.currentTime)||0));
        this.onTime(this.time,wallDelta,this.current.segment);
    }
    checkProgress() {
        if(!this.running || this.userPaused) return;
        const audio=this.current?.segment.audio;
        if(audio && audio.currentTime!==this.observed) {
            this.observed=audio.currentTime; this.lastProgress=this.now();
            if(!audio.paused && this.phase!=='playing') this.publish('playing');
        }
        if(this.now()-this.lastProgress>=this.stallMs) {
            this.fail(new Error(audio?'Audio playback stalled; retry this reply.':'Speech segment did not arrive in time.'));
        }
    }
    pause() {
        if(!this.running || this.userPaused) return;
        this.sample(); this.userPaused=true; this.current?.segment.audio.pause(); this.publish('paused');
    }
    resume() {
        if(!this.running || !this.userPaused) return;
        this.userPaused=false; this.lastProgress=this.now();
        if(this.current) {this.publish('starting');this.startAudio(this.current);}
        else this.advance();
    }
    release(owner) {
        const audio=owner.segment.audio;
        owner.listeners.forEach(([name,listener])=>audio.removeEventListener(name,listener));
        audio.pause();
        try { owner.segment.release?.(); } catch {}
    }
    endSegment() {
        const owner=this.current;
        try {
            this.time=owner.segment.audio.duration; this.onTime(this.time,0,owner.segment);
            this.release(owner); this.current=null;
            this.onSegmentEnd(owner.segment); this.offset+=this.time;this.time=0;
            this.advance();
        } catch(error) {this.fail(error);}
    }
    settle(phase,error) {
        if(!this.running) return;
        this.running=false; this.closed=true; this.userPaused=false; this.generation++;
        let failure=error;
        const clean=callback=>{try{callback();}catch(cleanupError){failure??=cleanupError;}};
        clean(()=>this.cancel(this.watch));this.watch=null;
        clean(()=>this.signal?.removeEventListener('abort',this.aborted));
        const owner=this.current; this.current=null;
        if(owner) {clean(()=>this.release(owner));clean(()=>this.onSegmentEnd(owner.segment));}
        this.queue.splice(0).forEach(segment=>{clean(()=>segment.audio.pause());clean(()=>segment.release?.());});
        this.seen=null;this.error=failure?.name==='AbortError'?null:failure?.message??null;
        clean(()=>this.publish(failure && phase==='completed'?'failed':phase));
        if(failure)this.reject(failure);else this.resolve();
    }
    fail(error) {this.settle('failed',typeof error?.message==='string'?error:new Error('Audio playback failed.'));}
    stop() {this.settle('stopped',abortError());}
}
