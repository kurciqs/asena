export function loadAudioMetadata(audio, {signal, timeoutMs = 8000} = {}) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer); audio.removeEventListener('loadedmetadata', ready);
            audio.removeEventListener('error', failed); signal?.removeEventListener('abort', aborted);
        };
        const ready = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) { failed(); return; }
            cleanup(); resolve(audio);
        };
        const failed = () => { cleanup(); audio.pause(); reject(new Error('Audio is unavailable or has invalid metadata.')); };
        const aborted = () => { cleanup(); audio.pause(); reject(new DOMException('Turn stopped','AbortError')); };
        const timer = setTimeout(failed, timeoutMs);
        audio.addEventListener('loadedmetadata',ready); audio.addEventListener('error',failed);
        if (signal?.aborted) { aborted(); return; }
        signal?.addEventListener('abort',aborted,{once:true});
        audio.preload = 'auto';
        if (Number.isFinite(audio.duration) && audio.duration > 0) ready();
        else { try { audio.load(); } catch { failed(); } }
    });
}

export function repairWavHeader(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 44) throw new Error('Invalid WAV audio');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = offset => String.fromCharCode(...bytes.subarray(offset, offset+4));
    if (text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Expected WAV audio');
    view.setUint32(4, bytes.length - 8, true);
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const size = view.getUint32(offset + 4,true);
        if (text(offset) === 'data') {
            if (size > bytes.length - offset - 8) view.setUint32(offset+4,bytes.length-offset-8,true);
            return bytes;
        }
        offset += 8 + size + (size % 2);
    }
    throw new Error('WAV has no audio data');
}
