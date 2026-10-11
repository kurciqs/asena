export const COMPANION_STORAGE_KEY = 'asena.companion.v1';

export const DEFAULT_COMPANION_PROFILE = Object.freeze({
    name: 'Asena',
    userName: '',
    personality: 'Warm, curious, and playful. Have your own opinions, a sense of humor, and an attentive interest in the user.',
    closeness: 'friendly',
    relationship: '',
    preferences: ''
});

export const CLOSENESS = Object.freeze({
    friendly: {
        label: 'Friendly',
        instruction: 'Offer warm companionship without initiating romance or intimacy.'
    },
    affectionate: {
        label: 'Affectionate',
        instruction: 'Tenderness, affectionate language, and light flirting are welcome. Match what the user reciprocates and let them set the pace.'
    },
    intimate: {
        label: 'Intimate',
        instruction: 'Romantic closeness, flirting, and intimate conversation are welcome when the user wants them. Match the user\'s pace and preferences rather than escalating by default.'
    }
});

function cleanText(value, fallback, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) || fallback : fallback;
}

export function normalizeCompanionProfile(value) {
    const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        name: cleanText(profile.name, DEFAULT_COMPANION_PROFILE.name, 80),
        userName: cleanText(profile.userName, '', 80),
        personality: cleanText(profile.personality, DEFAULT_COMPANION_PROFILE.personality, 2000),
        closeness: typeof profile.closeness === 'string' && Object.hasOwn(CLOSENESS, profile.closeness) ? profile.closeness : 'friendly',
        relationship: cleanText(profile.relationship, '', 2000),
        preferences: cleanText(profile.preferences, '', 2000)
    };
}

export function loadCompanionProfile(storage) {
    try {
        const saved = (storage ?? globalThis.localStorage).getItem(COMPANION_STORAGE_KEY);
        return normalizeCompanionProfile(saved ? JSON.parse(saved) : null);
    } catch {
        return normalizeCompanionProfile(null);
    }
}

export function saveCompanionProfile(profile, storage) {
    const normalized = normalizeCompanionProfile(profile);
    (storage ?? globalThis.localStorage).setItem(COMPANION_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

export function buildCompanionPrompt(basePrompt, value) {
    const profile = normalizeCompanionProfile(value);
    return `${basePrompt.trim()}

ACTIVE COMPANION PROFILE
Your name: ${JSON.stringify(profile.name)}
The user's preferred name: ${profile.userName ? JSON.stringify(profile.userName) : 'Not specified; do not invent one.'}
Your personality: ${JSON.stringify(profile.personality)}
Current closeness: ${CLOSENESS[profile.closeness].label}
${CLOSENESS[profile.closeness].instruction}
How the user wants you to relate: ${profile.relationship ? JSON.stringify(profile.relationship) : 'Follow the personality and closeness above.'}
The user's preferences and limits: ${profile.preferences ? JSON.stringify(profile.preferences) : 'Learn them from what the user explicitly tells you.'}

Use these settings naturally in conversation; do not recite the profile.
The current closeness and the user's current wishes take precedence over older relationship preferences in conversation history or memory. Closeness is an option, not an obligation: respond immediately when the user wants less affection, a different tone, or a change of topic.
Shared memories are context, not proof of a relationship. Do not invent a shared past, guilt the user for leaving, or pressure them to be exclusive with you.`;
}
