// Native disclosure controls keep large JSON branches folded and keyboard accessible.
export function createJsonViewer(container) {
    const document = container.ownerDocument;
    const expanded = new Set();
    let currentValue = null;

    function text(className, value) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        return span;
    }

    function primitive(value) {
        const type = value === null ? 'null' : typeof value;
        return text(`json-value json-${type}`, JSON.stringify(value) ?? String(value));
    }

    function entry(key, value, path, arrayItem = false) {
        const composite = value !== null && typeof value === 'object';
        const longString = typeof value === 'string' && value.length > 120;
        const keyLabel = arrayItem ? `[${key}]` : JSON.stringify(key);
        if (!composite && !longString) {
            const row = document.createElement('div');
            row.className = 'json-row';
            row.append(text('json-key', keyLabel), document.createTextNode(': '), primitive(value));
            return row;
        }

        const entries = composite ? Object.entries(value) : [];
        if (composite && entries.length === 0) {
            const row = document.createElement('div');
            row.className = 'json-row';
            row.append(text('json-key', keyLabel), document.createTextNode(': '),
                text('json-value', Array.isArray(value) ? '[]' : '{}'));
            return row;
        }

        const id = JSON.stringify(path);
        const branch = document.createElement('details');
        branch.className = 'json-branch';
        const summary = document.createElement('summary');
        const preview = longString ? `String (${value.length} characters)` :
            `${Array.isArray(value) ? 'Array' : 'Object'} (${entries.length} ${Array.isArray(value) ? 'items' : 'keys'})`;
        summary.append(text('json-key', keyLabel), document.createTextNode(': '), text('json-preview', preview));
        branch.append(summary);

        // Children are only mounted when requested, rather than constructing the full tree.
        let populated = false;
        function populate() {
            if (populated) return;
            populated = true;
            const children = document.createElement('div');
            children.className = 'json-children';
            if (longString) children.append(primitive(value));
            else for (const [childKey, childValue] of entries) {
                children.append(entry(childKey, childValue, [...path, childKey], Array.isArray(value)));
            }
            branch.append(children);
        }

        branch.open = expanded.has(id);
        if (branch.open) populate();
        branch.addEventListener('toggle', () => {
            if (!branch.isConnected) return;
            if (branch.open) {
                expanded.add(id);
                populate();
            } else expanded.delete(id);
        });
        return branch;
    }

    function render() {
        const fragment = document.createDocumentFragment();
        if (currentValue !== null && typeof currentValue === 'object') {
            for (const [key, value] of Object.entries(currentValue)) {
                fragment.append(entry(key, value, [key], Array.isArray(currentValue)));
            }
        } else fragment.append(primitive(currentValue));
        container.replaceChildren(fragment);
    }

    return {
        update(value) { currentValue = value; render(); },
        collapseAll() { expanded.clear(); render(); }
    };
}
