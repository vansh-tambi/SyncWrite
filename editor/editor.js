document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('rich-editor');
    const editorIndicator = document.getElementById('editor-indicator');
    const toolButtons = document.querySelectorAll('.tool-btn');

    // Fallback to window.name if query parameter is empty (e.g. some sandboxes or protocol redirects)
    const frameId = new URLSearchParams(window.location.search).get('id') || window.name || 'unknown';
    if (editorIndicator) {
        editorIndicator.textContent = frameId.toUpperCase();
    }

    let isRemoteUpdate = false;
    let lastContent = editor.innerHTML;
    let lastReceivedTimestamp = 0;

    const seenIds = new Set();
    const ID_TTL = 10000;
    let debounceTimer = null;

    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;

    // Basic XSS sanitization
    function sanitize(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        
        const scripts = div.getElementsByTagName('script');
        let i = scripts.length;
        while (i--) {
            scripts[i].parentNode.removeChild(scripts[i]);
        }

        const elements = div.getElementsByTagName('*');
        for (let el of elements) {
            const attrs = el.attributes;
            let j = attrs.length;
            while (j--) {
                const attr = attrs[j].name;
                if (attr.startsWith('on')) {
                    el.removeAttribute(attr);
                }
            }
        }
        return div.innerHTML;
    }

    function updateToolbar() {
        toolButtons.forEach(btn => {
            const command = btn.getAttribute('data-command');
            try {
                if (document.queryCommandState(command)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            } catch (e) {}
        });
    }

    function flashStatus() {
        const wrapper = document.getElementById('editor-wrapper');
        if (wrapper) {
            wrapper.classList.remove('flash-sync');
            void wrapper.offsetWidth; 
            wrapper.classList.add('flash-sync');
        }
    }

    function sendUpdate(action) {
        if (isRemoteUpdate) return;

        const currentHTML = editor.innerHTML;
        if (currentHTML === lastContent) return;

        lastContent = currentHTML;

        const messageId = self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        const payload = {
            messageId,
            type: 'FORMAT_SYNC',
            action,
            html: currentHTML,
            senderId: frameId,
            tsCreate: Date.now(),
            timestamp: Date.now()
        };

        seenIds.add(messageId);
        setTimeout(() => seenIds.delete(messageId), ID_TTL);

        window.parent.postMessage(payload, targetOrigin);
    }

    function debounce(action, delay) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => sendUpdate(action), delay);
    }

    function handleToolbar(e) {
        if (isRemoteUpdate) return;
        if (debounceTimer) clearTimeout(debounceTimer);

        e.preventDefault();
        const command = e.currentTarget.getAttribute('data-command');

        document.execCommand(command, false, null);
        editor.focus();
        updateToolbar();
        sendUpdate(command);
    }

    function handleInput() {
        if (isRemoteUpdate) return;
        updateToolbar();
        debounce('input', 300);
    }

    function getOffsets(element) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        
        const range = sel.getRangeAt(0);
        if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
            return null;
        }

        const preRange = range.cloneRange();
        preRange.selectNodeContents(element);
        preRange.setEnd(range.startContainer, range.startOffset);
        const start = preRange.toString().length;

        preRange.setEnd(range.endContainer, range.endOffset);
        const end = preRange.toString().length;

        return { start, end };
    }

    function setOffsets(element, offsets) {
        if (!offsets) return;
        const sel = window.getSelection();
        if (!sel) return;

        const range = document.createRange();
        let current = 0;
        let startNode = null, startOffset = 0;
        let endNode = null, endOffset = 0;

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        let foundStart = false, foundEnd = false;

        while ((node = walker.nextNode())) {
            const next = current + node.length;
            if (!foundStart && offsets.start >= current && offsets.start <= next) {
                startNode = node;
                startOffset = offsets.start - current;
                foundStart = true;
            }
            if (!foundEnd && offsets.end >= current && offsets.end <= next) {
                endNode = node;
                endOffset = offsets.end - current;
                foundEnd = true;
            }
            if (foundStart && foundEnd) break;
            current = next;
        }

        if (!startNode) {
            startNode = element;
            startOffset = 0;
        }
        if (!endNode) {
            endNode = startNode;
            endOffset = startOffset;
        }

        try {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
            console.warn('Failed to restore cursor selection', e);
        }
    }

    toolButtons.forEach(btn => btn.addEventListener('mousedown', handleToolbar));
    editor.addEventListener('input', handleInput);

    window.document.addEventListener('selectionchange', updateToolbar);
    editor.addEventListener('keyup', updateToolbar);
    editor.addEventListener('mouseup', updateToolbar);

    window.addEventListener('unload', () => {
        toolButtons.forEach(btn => btn.removeEventListener('mousedown', handleToolbar));
        editor.removeEventListener('input', handleInput);
        window.document.removeEventListener('selectionchange', updateToolbar);
        editor.removeEventListener('keyup', updateToolbar);
        editor.removeEventListener('mouseup', updateToolbar);
    });

    window.addEventListener('message', (e) => {
        if (!e.data || typeof e.data !== 'object') return;

        const { type, html, senderId, messageId, tsCreate, tsRelay, timestamp } = e.data;
        if (type === 'FORMAT_SYNC') {
            // Drop out-of-order messages
            const msgTime = timestamp || tsCreate;
            if (msgTime && msgTime < lastReceivedTimestamp) return;
            lastReceivedTimestamp = msgTime;

            if (messageId && seenIds.has(messageId)) return;

            if (messageId) {
                seenIds.add(messageId);
                setTimeout(() => seenIds.delete(messageId), ID_TTL);
            }

            if (editor.innerHTML === html) {
                lastContent = html;
                return;
            }

            const isFocused = (document.activeElement === editor);
            const savedOffsets = isFocused ? getOffsets(editor) : null;

            try {
                isRemoteUpdate = true;

                const cleanHTML = sanitize(html);
                editor.innerHTML = cleanHTML;
                lastContent = cleanHTML;

                if (isFocused && savedOffsets) {
                    setOffsets(editor, savedOffsets);
                }

                flashStatus(senderId || 'unknown');
                updateToolbar();
            } catch (err) {
                console.error('Failed to apply sync update:', err);
            } finally {
                isRemoteUpdate = false;
            }

            window.parent.postMessage({
                type: 'SYNC_METRICS',
                receiverId: frameId,
                originalSenderId: senderId,
                action: e.data.action || 'sync',
                metrics: {
                    tsCreate: tsCreate || timestamp || Date.now(),
                    tsRelay: tsRelay || Date.now(),
                    tsProcess: Date.now()
                }
            }, targetOrigin);
        }
    });
});
