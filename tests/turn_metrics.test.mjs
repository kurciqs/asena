import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnMetrics,reportData} from '../src/turn_metrics.js';

test('turn latency includes model wait before speech, separates extraction, and freezes on stop',()=>{
    let now=1000;const profile={openingSeconds:1,policy:'2s',startupSeconds:2};
    const metrics=new TurnMetrics(7,{mode:'preview',profile},()=>now);
    profile.startupSeconds=4;now=2000;metrics.mark('firstText');now=2100;metrics.mark('parsed');
    now=2500;metrics.mark('speechRequested');
    metrics.observeSpeech({browser:{firstPlaybackSeconds:3},events:[{token:'secret',pcm:'samples'}]});
    now=9000;metrics.mark('memoryStart');now=10000;metrics.mark('memoryEnd');metrics.finish('completed');
    now=20000;const report=metrics.snapshot();
    assert.equal(report.milestones.firstAudio,4.5);assert.equal(report.durations.reply,1);
    assert.equal(report.durations.speechStartup,3);assert.equal(report.durations.memoryExtraction,1);
    assert.equal(report.elapsedSeconds,9);assert.equal(report.config.profile.startupSeconds,2);
    assert.deepEqual(report.speech.events,[{}]);
    assert.deepEqual(reportData({token:'secret',nested:{pcm:'large',n:1}}),{nested:{n:1}});
});
