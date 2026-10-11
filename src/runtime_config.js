import { readRuntimeMode } from './replay.js';
import { normalizeBudget } from './context_budget.js';
import { requestJSON } from './service_client.js';

// Importing this module does no network work: UI starts before configuration.
export let runtimeConfig = null;
export let RUNTIME_MODE = null;
export let contextBudget = normalizeBudget();
export let assets = null;
export async function loadRuntimeConfig() {
    const value = await requestJSON('/runtime', { cache:'no-store', timeoutMs:8000 });
    const mode = readRuntimeMode(value);
    const budget = normalizeBudget(value.budget);
    if (typeof value.chatModel !== 'string' || !value.chatModel || typeof value.voice !== 'string' ||
        !['rhubarb','dictionary'].includes(value.lipSync) || !value.assets ||
        ['modelsIndex','models','animationsIndex','animations','systemPrompt','dictionary'].some(
            key=>typeof value.assets[key]!=='string' || !value.assets[key].startsWith('/'))) {
        throw new Error('Runtime configuration is incomplete. Restart the website server.');
    }
    runtimeConfig = value; RUNTIME_MODE = mode; contextBudget = budget; assets = value.assets;
    return value;
}
