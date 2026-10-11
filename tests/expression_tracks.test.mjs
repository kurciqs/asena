import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExpressionTracks} from '../src/expression_tracks.js';
import {repairWavHeader,loadAudioMetadata} from '../src/audio.js';

test('aliased mouth cues create exactly one sorted finite track per actual binding', () => {
    const tracks = buildExpressionTracks({duration:2,visemes:[
        {value:'G',start:1,end:1.5},{value:'A',start:0,end:0.6},{value:'H',start:0.5,end:1.2},
        {value:'D',start:0,end:0.3},{value:'E',start:0.3,end:0.7}],emotions:[]}, name => ['aa','ee'].includes(name) ? name : null);
    assert.equal(tracks.length,2);
    for (const track of tracks) {
        assert.equal(new Set(track.times).size,track.times.length);
        assert.ok(track.times.every((time,i) => Number.isFinite(time) && (i===0 || time>track.times[i-1])));
        assert.ok(track.values.every(value => value>=0 && value<=1));
        assert.equal(track.values.at(-1),0);
    }
    const empty = buildExpressionTracks({duration:1},name => name==='aa'?'actual-binding':null);
    assert.deepEqual(empty,[{name:'actual-binding',times:[0,1],values:[0,0]}]);
    assert.throws(() => buildExpressionTracks({duration:NaN},()=>null),/metadata/);
    assert.throws(() => buildExpressionTracks({duration:1,visemes:[{value:'A',start:NaN,end:1}]},()=>null),/timing/);
});

test('WAV placeholder lengths are repaired without changing PCM payload', () => {
    const bytes = new Uint8Array(48), view=new DataView(bytes.buffer);
    for (const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) bytes.set([...text].map(c=>c.charCodeAt(0)),offset);
    view.setUint32(16,16,true); view.setUint32(4,0xffffffff,true); view.setUint32(40,0xffffffff,true);
    bytes.set([1,2,3,4],44); repairWavHeader(bytes);
    assert.equal(view.getUint32(4,true),40); assert.equal(view.getUint32(40,true),4);
    assert.deepEqual([...bytes.slice(44)],[1,2,3,4]);
});

test('stalled audio loading rejects promptly on turn abort', async () => {
    const audio=new EventTarget(); audio.duration=NaN; audio.load=()=>{}; audio.pause=()=>{};
    const controller=new AbortController();
    const loading=loadAudioMetadata(audio,{signal:controller.signal}); controller.abort();
    await assert.rejects(loading,{name:'AbortError'});
});
