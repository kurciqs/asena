// Reuse native disclosure nodes so live updates preserve expansion and focus.
export function createJsonViewer(container) {
    const document = container.ownerDocument;
    container.classList.add('json-viewer');
    const outer = container.closest('details');
    const root = { element: container, children: new Map() };
    let currentValue = null;

    function span(className, value) {
        const node = document.createElement('span');
        node.className = className;
        node.textContent = value;
        return node;
    }

    function reconcile(parent, entries, array = false) {
        const keep = new Set();
        let index = 0;
        for (const [key, value] of entries) {
            keep.add(key);
            const composite = value !== null && typeof value === 'object';
            const long = typeof value === 'string' && value.length > 120;
            const items = composite ? Object.entries(value) : [];
            const branch = long || (composite && items.length > 0);
            let record = parent.children.get(key);
            if (!record || record.branch !== branch) {
                const element = document.createElement(branch ? 'details' : 'div');
                element.className = branch ? 'json-branch' : 'json-row';
                const label = span('json-key', '');
                const display = span('', '');
                const header = branch ? document.createElement('summary') : element;
                header.append(label, document.createTextNode(': '), display);
                if (branch) element.append(header);
                const previous = record;
                record = { element, label, display, branch, children: new Map(), value };
                parent.children.set(key, record);
                if (previous) previous.element.replaceWith(element);
                if (branch) element.addEventListener('toggle', () => {
                    if (element.open && element.isConnected) populate(record);
                });
            }
            record.value = value;
            record.label.textContent = array ? `[${key}]` : JSON.stringify(key);
            record.display.className = branch ? 'json-preview' :
                `json-value json-${value === null ? 'null' : typeof value}`;
            record.display.textContent = branch ? (long ? `String (${value.length} characters)` :
                `${Array.isArray(value) ? 'Array' : 'Object'} (${items.length} ${Array.isArray(value) ? 'items' : 'keys'})`) :
                JSON.stringify(value) ?? String(value);
            // Avoid moving a focused summary when the key order is unchanged.
            if (parent.element.children[index] !== record.element) {
                parent.element.insertBefore(record.element, parent.element.children[index] ?? null);
            }
            index++;
            if (branch && record.element.open) populate(record);
        }
        for (const [key, record] of parent.children) {
            if (!keep.has(key)) { record.element.remove(); parent.children.delete(key); }
        }
    }

    function populate(record) {
        if (!record.content) {
            const element = document.createElement('div');
            element.className = 'json-children';
            record.element.append(element);
            record.content = { element, children: new Map() };
        }
        const content = record.content;
        if (typeof record.value === 'string') {
            if (!content.longSpan) {
                content.longSpan = span('json-value json-string', '');
                content.element.replaceChildren(content.longSpan);
                content.children.clear();
            }
            content.longSpan.textContent = JSON.stringify(record.value);
        } else {
            if (content.longSpan) { content.longSpan.remove(); content.longSpan = null; }
            reconcile(content, Object.entries(record.value), Array.isArray(record.value));
        }
    }

    function render() {
        reconcile(root, currentValue !== null && typeof currentValue === 'object' ?
            Object.entries(currentValue) : [['value', currentValue]], Array.isArray(currentValue));
    }

    if (outer) outer.addEventListener('toggle', () => { if (outer.open) render(); });
    container.replaceChildren();
    return {
        update(value) { currentValue = value; if (!outer || outer.open) render(); },
        collapseAll() {
            for (const branch of container.querySelectorAll('details')) branch.open = false;
        }
    };
}
