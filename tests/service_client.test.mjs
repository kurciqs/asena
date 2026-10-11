import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON } from '../src/service_client.js';

test('service requests enforce deadlines, preserve useful errors and honor cancellation', async () => {
    const original=globalThis.fetch;
    try {
        globalThis.fetch=async () => ({ok:false,status:503,json:async()=>({error:'Kokoro is unavailable. Retry when ready.'})});
        await assert.rejects(requestJSON('/fixture'),/Kokoro is unavailable/);
        globalThis.fetch=async () => ({ok:true,json:async()=>{throw new Error('bad JSON');}});
        await assert.rejects(requestJSON('/fixture'),/unreadable/);
        globalThis.fetch=async (url,{signal}) => new Promise((resolve,reject)=> {
            if(signal.aborted) reject(new DOMException('aborted','AbortError'));
            else signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
        });
        await assert.rejects(requestJSON('/fixture',{timeoutMs:5}),/timed out/);
        const controller=new AbortController();
        const pending=requestJSON('/fixture',{signal:controller.signal});controller.abort();
        await assert.rejects(pending,{name:'AbortError'});
    } finally { globalThis.fetch=original; }
});
