export function createToolPanel() {
    const panel = document.getElementById('utility-panels');
    const backdrop = document.getElementById('tools-backdrop');
    const chat = document.getElementById('chat-panel');
    const restore = document.getElementById('chat-restore');
    const handle = document.getElementById('tools-drag-handle');
    const compact = matchMedia('(max-width: 999px)');
    const tabs = {settings:document.getElementById('settings-tab'), debug:document.getElementById('debug-tab'), expressions:document.getElementById('expressions-tab')};
    const views = {settings:document.getElementById('selections'), debug:document.getElementById('replay-panel'), expressions:document.getElementById('expression-panel')};
    const triggers = {settings:document.getElementById('settings-toggle'), debug:document.getElementById('debug-toggle'), expressions:document.getElementById('expressions-toggle')};
    let selected = 'settings', returnFocus = null, tuningChatWasHidden = null, position = null, dragging = null;
    function place() {
        if (panel.hidden || selected!=='expressions') return;
        const rect=panel.getBoundingClientRect(),gap=12;
        const next=position??{left:innerWidth-rect.width-gap,top:innerWidth<=420?innerHeight-rect.height-gap:20};
        position={left:Math.max(gap,Math.min(next.left,innerWidth-rect.width-gap)),
            top:Math.max(gap,Math.min(next.top,innerHeight-rect.height-gap))};
        panel.style.left=`${position.left}px`;panel.style.top=`${position.top}px`;panel.style.right='auto';
    }
    function sync() {
        const tuning = selected==='expressions';
        const modal = !panel.hidden && compact.matches && !tuning;
        panel.classList.toggle('expression-mode',tuning);
        document.getElementById('tools-title').textContent=tuning?'Expressions':'Companion tools';
        handle.tabIndex=tuning?0:-1;
        handle.title=tuning?'Drag to move. Focus this title and use arrow keys to reposition.':'';
        if (!panel.hidden && tuning && tuningChatWasHidden===null) {
            tuningChatWasHidden=chat.hidden;chat.hidden=true;restore.hidden=false;
        } else if ((panel.hidden || !tuning) && tuningChatWasHidden!==null) {
            chat.hidden=tuningChatWasHidden;restore.hidden=!chat.hidden;tuningChatWasHidden=null;
        }
        if (!tuning) {panel.style.left='';panel.style.top='';panel.style.right='';dragging=null;}
        backdrop.hidden = !modal;
        chat.inert = modal;
        restore.inert = modal;
        panel.setAttribute('role',modal ? 'dialog' : 'complementary');
        if (modal) panel.setAttribute('aria-modal','true'); else panel.removeAttribute('aria-modal');
        for (const name of Object.keys(tabs)) {
            tabs[name].setAttribute('aria-selected',String(name===selected));
            tabs[name].tabIndex = name===selected ? 0 : -1;
            views[name].hidden = name!==selected;
            triggers[name].setAttribute('aria-expanded',String(!panel.hidden && name===selected));
        }
        place();
        window.dispatchEvent(new Event('asena-tools-change'));
    }
    function close() {
        dragging=null;panel.hidden = true; sync();
        if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus();
        else (chat.hidden?restore:triggers.debug).focus();
    }
    function open(name, trigger = triggers[name], focus = true) {
        if (tabs[name].hidden) return;
        if (panel.hidden) returnFocus = trigger;
        selected = name; panel.hidden = false; sync();
        if (focus) tabs[name].focus();
    }
    function toggle(name) { if (!panel.hidden && selected===name) close(); else open(name); }
    for (const [name,tab] of Object.entries(tabs)) {
        tab.addEventListener('click',()=>open(name));
        tab.addEventListener('keydown',event=>{
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
            event.preventDefault();
            const names = Object.keys(tabs).filter(key=>!tabs[key].hidden);
            const index = names.indexOf(name);
            const next = event.key==='Home' ? names[0] : event.key==='End' ? names.at(-1) : names[(index+(event.key==='ArrowRight'?1:names.length-1))%names.length];
            open(next);
        });
    }
    document.getElementById('tools-close').addEventListener('click',close);
    triggers.expressions.addEventListener('click',()=>open('expressions'));
    backdrop.addEventListener('click',close);
    document.addEventListener('keydown',event=>{
        if (panel.hidden || document.getElementById('companion-dialog').open) return;
        if (event.key==='Escape') {event.preventDefault();close();}
        if (event.key==='Tab' && compact.matches && selected!=='expressions') {
            const focusable = [...panel.querySelectorAll('button, select, input, summary, [tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length);
            const first=focusable[0],last=focusable.at(-1);
            if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
            else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
        }
    });
    handle.addEventListener('pointerdown',event=>{
        if (selected!=='expressions' || event.button!==0 || event.target.closest('button')) return;
        event.preventDefault();
        const rect=panel.getBoundingClientRect();
        dragging={pointer:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
        if (!dragging || event.pointerId!==dragging.pointer) return;
        position={left:dragging.left+event.clientX-dragging.x,top:dragging.top+event.clientY-dragging.y};place();
    });
    const stopDrag=()=>{dragging=null;};
    handle.addEventListener('pointerup',stopDrag);handle.addEventListener('pointercancel',stopDrag);handle.addEventListener('lostpointercapture',stopDrag);
    handle.addEventListener('keydown',event=>{
        if (selected!=='expressions' || event.target!==handle || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();const step=event.shiftKey?30:10;
        const rect=panel.getBoundingClientRect();
        position={left:rect.left+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),
            top:rect.top+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};place();
    });
    window.addEventListener('resize',place);
    compact.addEventListener('change',()=>{sync();if(!panel.hidden && compact.matches) tabs[selected].focus();});
    return {open,close,toggle,enableDebug(){tabs.debug.hidden=false;tabs.expressions.hidden=false;triggers.debug.hidden=false;sync();}};
}

export function wireChatLayout() {
    const chat=document.getElementById('chat-panel'), handle=document.getElementById('chat-drag-handle');
    const restore=document.getElementById('chat-restore');
    function bounds() {
        const tools=document.getElementById('utility-panels');
        const gap=innerWidth<=600?12:20;
        const right=innerWidth>=1000 && !tools.hidden && !tools.classList.contains('expression-mode') ? tools.getBoundingClientRect().left-gap : innerWidth-gap;
        return {gap,right,bottom:innerHeight-gap};
    }
    function clamp() {
        if(chat.hidden) return;
        const {gap,right,bottom}=bounds();
        const maxWidth=Math.max(Math.min(280,innerWidth-2*gap),right-gap),maxHeight=bottom-gap;
        chat.style.maxWidth=`${maxWidth}px`;
        const rect=chat.getBoundingClientRect();
        if(rect.width>maxWidth)chat.style.width=`${maxWidth}px`;
        if(rect.height>maxHeight)chat.style.height=`${maxHeight}px`;
        const after=chat.getBoundingClientRect();
        chat.style.left=`${Math.max(gap,Math.min(after.left,right-after.width))}px`;
        chat.style.top=`${Math.max(gap,Math.min(after.top,bottom-after.height))}px`;
        chat.style.bottom='auto';
    }
    function toggle() {
        chat.hidden=!chat.hidden;restore.hidden=!chat.hidden;
        if (!chat.hidden) {clamp();document.getElementById('user-input-message').focus();}
        else restore.focus();
    }
    document.getElementById('chat-minimize').addEventListener('click',toggle);
    restore.addEventListener('click',toggle);
    handle.addEventListener('pointerdown',event=>{
        if(event.button!==0 || event.target.closest('button')) return;
        event.preventDefault();
        const rect=chat.getBoundingClientRect(),start={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
        handle.setPointerCapture(event.pointerId);
        const move=event=>{chat.style.left=`${start.left+event.clientX-start.x}px`;chat.style.top=`${start.top+event.clientY-start.y}px`;clamp();};
        const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);};
        handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
    });
    window.addEventListener('resize',clamp);
    window.addEventListener('asena-tools-change',clamp);
    new ResizeObserver(clamp).observe(chat);
    clamp();
    return {toggle};
}
