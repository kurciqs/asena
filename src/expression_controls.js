import {EXPRESSION_PRESETS,EXPRESSION_LIMITS,expressionPreferences} from './emotion_envelope.js';
export const EXPRESSION_STORAGE_KEY='asena.expression-trials.v1';
export function setupExpressionControls(document,storage,apply){
    let value=expressionPreferences();
    try{value=expressionPreferences(JSON.parse(storage.getItem(EXPRESSION_STORAGE_KEY)??'{}'));}catch{}
    const preset=document.getElementById('expression-preset');
    const render=()=>{
        for(const key of Object.keys(EXPRESSION_LIMITS)){
            document.getElementById(`expression-${key}`).value=value[key];
            document.getElementById(`expression-${key}-value`).textContent=['attack','hold','release'].includes(key)?`${value[key].toFixed(2)}s`:`${Math.round(value[key]*100)}%`;
        }
        apply({...value});
    };
    const save=()=>{try{storage.setItem(EXPRESSION_STORAGE_KEY,JSON.stringify(value));}catch{}};
    preset.value='custom';
    preset.addEventListener('change',()=>{if(EXPRESSION_PRESETS[preset.value]){value={...EXPRESSION_PRESETS[preset.value]};save();render();}});
    for(const key of Object.keys(EXPRESSION_LIMITS))document.getElementById(`expression-${key}`).addEventListener('input',event=>{
        value=expressionPreferences({...value,[key]:Number(event.target.value)});preset.value='custom';save();render();
    });
    render();return ()=>({...value});
}
