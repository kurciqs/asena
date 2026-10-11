// Turn cancellation and a deadline cover both the fetch and its response body.
export async function requestJSON(url, { signal, timeoutMs = 100000, ...options } = {}) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    try {
        const response = await fetch(url, { ...options, signal: combined });
        let data;
        try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Retry when ready.'); }
        if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status}). Retry when ready.`);
        if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response.');
        return data;
    } catch (error) {
        if (signal?.aborted) throw new DOMException('Turn stopped', 'AbortError');
        if (deadline.signal.aborted) throw new Error('The request timed out. Check the local service, then retry.');
        if (error instanceof TypeError) throw new Error('The website server is unavailable. Restart it, then retry.');
        throw error;
    } finally { clearTimeout(timer); }
}
