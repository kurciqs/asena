import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolPanel} from '../src/ui_panels.js';

function harness(t,{width=848,height=674,chatHidden=false}={}) {
    const listeners=new Map(),nodes=new Map();
    const events=target=>({
        addEventListener(type,fn){const key=`${target}:${type}`;listeners.set(key,[...(listeners.get(key)??[]),fn]);},
        fire(type,data={}){const event={target:this,preventDefault(){this.prevented=true;},...data};
            for(const fn of listeners.get(`${target}:${type}`)??[])fn(event);return event;}
    });
    const document={...events('document'),activeElement:null,getElementById:id=>nodes.get(id)};
    function element(id,hidden=false,parent=null){
        const classes=new Set(),attrs=new Map();
        const node={id,hidden,parent,style:{},inert:false,isConnected:true,...events(id),
            classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
            setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),getAttribute:name=>attrs.get(name),
            closest(selector){if(selector==='button')return id.endsWith('-tab')||id.endsWith('-toggle')||id==='tools-close'?this:null;
                if(selector==='[hidden]')return this.hidden?this:this.parent?.closest(selector)??null;return null;},
            focus(){document.activeElement=this;},setPointerCapture(){},
            querySelectorAll:()=>[],getBoundingClientRect(){const w=classes.has('expression-mode')?286:360;
                return {left:parseFloat(this.style.left)||globalThis.innerWidth-w-16,top:parseFloat(this.style.top)||16,width:w,height:440};}
        };nodes.set(id,node);return node;
    }
    const panel=element('utility-panels',true);
    element('tools-backdrop',true);element('chat-panel',chatHidden);element('chat-restore',!chatHidden);
    element('tools-drag-handle',false,panel);element('tools-title',false,panel);element('tools-close',false,panel);
    for(const id of ['settings-tab','debug-tab','expressions-tab','selections','replay-panel','expression-panel'])element(id,false,panel);
    element('settings-toggle',false,nodes.get('chat-panel'));element('debug-toggle',false,nodes.get('chat-panel'));
    element('expressions-toggle',false,nodes.get('replay-panel'));
    element('companion-dialog').open=false;
    const compact={matches:width<=999,...events('media')},window={...events('window'),dispatchEvent(){}};
    const globals={document,window,matchMedia:()=>compact,innerWidth:width,innerHeight:height};
    const previous=Object.fromEntries(Object.keys(globals).map(key=>[key,globalThis[key]]));
    Object.assign(globalThis,globals);
    t.after(()=>{for(const key of Object.keys(globals))if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];});
    const tools=createToolPanel();tools.enableDebug();
    return {tools,nodes,document,window,compact};
}

test('expression tuning releases the compact modal backdrop and keeps scene/chat access available',t=>{
    const {tools,nodes}=harness(t);
    tools.open('debug');assert.equal(nodes.get('tools-backdrop').hidden,false);
    assert.equal(nodes.get('chat-panel').inert,true);
    nodes.get('expressions-toggle').fire('click');
    assert.equal(nodes.get('tools-backdrop').hidden,true);
    assert.equal(nodes.get('utility-panels').getAttribute('aria-modal'),undefined);
    assert.equal(nodes.get('utility-panels').getAttribute('role'),'complementary');
    assert.equal(nodes.get('chat-panel').inert,false);
    assert.equal(nodes.get('chat-panel').hidden,true);
    assert.equal(nodes.get('chat-restore').hidden,false);
    assert.equal(nodes.get('chat-restore').inert,false);
    assert.equal(nodes.get('expression-panel').hidden,false);
    assert.equal(nodes.get('replay-panel').hidden,true);
});

test('leaving tuning restores the previous chat visibility and normal tool placement',t=>{
    const {tools,nodes}=harness(t);
    tools.open('expressions');assert.ok(nodes.get('utility-panels').style.left);
    tools.open('settings');assert.equal(nodes.get('chat-panel').hidden,false);
    assert.equal(nodes.get('chat-restore').hidden,true);
    assert.equal(nodes.get('tools-backdrop').hidden,false);
    assert.equal(nodes.get('utility-panels').style.left,'');
    tools.close();assert.equal(nodes.get('chat-panel').inert,false);
});

test('closing tuning preserves an already-hidden chat and returns focus to its restore button',t=>{
    const {tools,nodes,document}=harness(t,{chatHidden:true});
    tools.open('debug');tools.open('expressions');tools.close();
    assert.equal(nodes.get('chat-panel').hidden,true);
    assert.equal(nodes.get('chat-restore').hidden,false);
    assert.equal(document.activeElement,nodes.get('chat-restore'));
});

test('dragging and keyboard movement stay inside the viewport; slider keys do not move the panel',t=>{
    const {tools,nodes}=harness(t);tools.open('expressions');
    const handle=nodes.get('tools-drag-handle'),panel=nodes.get('utility-panels');
    handle.fire('pointerdown',{button:0,pointerId:1,clientX:570,clientY:20});
    handle.fire('pointermove',{pointerId:1,clientX:-1000,clientY:1200});
    assert.equal(panel.style.left,'12px');assert.equal(panel.style.top,'222px');
    handle.fire('pointerup');
    handle.fire('keydown',{key:'ArrowRight',shiftKey:true});assert.equal(panel.style.left,'42px');
    handle.fire('keydown',{key:'ArrowRight',target:{id:'expression-strength'}});assert.equal(panel.style.left,'42px');
    globalThis.innerWidth=600;globalThis.innerHeight=500;
    nodes.get('tools-drag-handle').fire('keydown',{key:'ArrowUp'});
    assert.equal(panel.style.top,'48px');
    tools.open('settings');const left=panel.style.left;
    handle.fire('pointerdown',{button:0,pointerId:1,clientX:20,clientY:20});
    handle.fire('pointermove',{pointerId:1,clientX:50,clientY:50});assert.equal(panel.style.left,left);
});

test('compact expression controls do not trap Tab; Escape restores the scene',t=>{
    const {tools,nodes,document}=harness(t);tools.open('expressions');
    const tab=document.fire('keydown',{key:'Tab'});assert.equal(tab.prevented,undefined);
    document.fire('keydown',{key:'Escape'});
    assert.equal(nodes.get('utility-panels').hidden,true);
    assert.equal(nodes.get('chat-panel').hidden,false);
    assert.equal(nodes.get('tools-backdrop').hidden,true);
});
