import { readRuntimeMode } from './replay.js';
import { normalizeBudget } from './context_budget.js';
import { requestJSON } from './service_client.js';

export const runtimeConfig = await requestJSON('/runtime', { cache:'no-store', timeoutMs:8000 });
export const RUNTIME_MODE = readRuntimeMode(runtimeConfig);
export const contextBudget = normalizeBudget(runtimeConfig.budget);
export const assets = runtimeConfig.assets;
if (typeof runtimeConfig.chatModel !== 'string' || !runtimeConfig.chatModel || typeof runtimeConfig.voice !== 'string' || !['rhubarb','dictionary'].includes(runtimeConfig.lipSync) || !assets || ['modelsIndex','models','animationsIndex','animations','systemPrompt','dictionary'].some(key=>typeof assets[key]!=='string' || !assets[key].startsWith('/'))) {
    throw new Error('Runtime configuration is incomplete. Restart the website server.');
}
