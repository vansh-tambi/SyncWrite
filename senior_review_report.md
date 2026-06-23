# Senior Frontend Engineering Review: SyncWrite

This document presents a detailed code review of the current SyncWrite implementation. It covers security vulnerabilities, performance limitations, compatibility constraints, race conditions, memory leaks, and architectural concerns, along with concrete code fixes.

---

## 1. Security Concerns

### Issue A: Cross-Site Scripting (XSS) via Untrusted HTML
* **Vulnerability**: In [editor/editor.js](file:///c:/Users/hp/OneDrive/Desktop/SyncWrite/editor/editor.js), the incoming HTML payload is injected directly into the DOM:
  ```javascript
  editor.innerHTML = html;
  ```
  If a user pastes malicious code (e.g., `<img src="invalid" onerror="alert(document.cookie)">`), it will execute immediately on the peer frame, opening a vector for cross-frame scripting.
* **Fix**: Integrate a lightweight sanitization step before DOM injection. In production, use a library like DOMPurify. As a native fallback, build a simple parser-based sanitizer to strip scripting nodes and attributes (e.g., `<script>`, `onload`, `onerror`).

### Issue B: Wildcard Target Origin (`*`) in postMessage
* **Vulnerability**:
  In both `host.js` and `editor.js`, messages are dispatched using wildcard origins:
  ```javascript
  targetWindow.postMessage(payload, '*');
  ```
  If the application is embedded in a different window context or is subject to clickjacking, sensitive text data could be leaked to malicious parent frames or sibling frames.
* **Fix**: Avoid using `*`. Resolve the expected origin dynamically and pass it explicitly:
  ```javascript
  const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
  targetWindow.postMessage(payload, targetOrigin);
  ```

---

## 2. Memory Leaks

### Issue A: Orphaned Parent Document Event Listeners
* **Vulnerability**: In [editor/editor.js](file:///c:/Users/hp/OneDrive/Desktop/SyncWrite/editor/editor.js), selection listeners are attached directly to the global parent document context:
  ```javascript
  document.addEventListener('selectionchange', updateToolbarState);
  ```
  Since the editor is executing inside an iframe, if the iframe is destroyed or reloaded by the Host page, the listener attached to the parent `document` remains active. The garbage collector cannot reclaim the iframe's window scope, leading to a major memory leak.
* **Fix**: Attach the `selectionchange` listener to the iframe's local context (`window.document`) instead of the top-level parent `document`, and clean up all listeners if the page unloads:
  ```javascript
  // Fix: Target the local frame document
  window.document.addEventListener('selectionchange', updateToolbarState);

  // Clean up during frame teardown
  window.addEventListener('unload', () => {
      window.document.removeEventListener('selectionchange', updateToolbarState);
  });
  ```

---

## 3. Potential Race Conditions

### Issue A: Out-of-Order Delivery (Time-Travel Writes)
* **Vulnerability**:
  If Frame A dispatches a debounced typing update and then immediately applies a bold formatting action (which dispatches instantly), network latency or thread scheduling could cause the older typing event to arrive *after* the formatting event, overwriting the formatting update.
* **Fix**: Enforce a strict timestamp order verification inside the message listener:
  ```javascript
  let lastReceivedTimestamp = 0;
  
  window.addEventListener('message', (event) => {
      const { timestamp } = event.data;
      if (timestamp && timestamp < lastReceivedTimestamp) {
          console.warn('[Sync Warn] Discarding out-of-order message');
          return; // Skip stale updates
      }
      lastReceivedTimestamp = timestamp;
      // ...
  });
  ```

---

## 4. Performance Bottlenecks

### Issue A: Full DOM Re-renders on Keystrokes
* **Vulnerability**: Setting `innerHTML = html` forces the browser to scrap the DOM tree, parse the HTML string, build new DOM nodes, recompute styles, and repaint the container. For larger documents, doing this frequently will saturate the main thread, resulting in layout stuttering and dropped frames.
* **Fix**: Use a basic text-diffing check or transition to structural node updates. Alternatively, if only text changes without format changes occur, apply direct text manipulation or segment edits.

### Issue B: Heavy Stack-based DFS Tree Traversal for Caret Restoral
* **Vulnerability**: Every time `setSelectionCharacterOffsetWithin` is invoked, it traverses the entire DOM structure using an array stack. For deep or complex nodes, this block blocks user typing responsiveness.
* **Fix**: Replace manual stack operations with native browser `NodeIterator` or `TreeWalker` systems which are optimized in browser engines:
  ```javascript
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
      // Find offsets quickly
  }
  ```

---

## 5. Browser Compatibility Issues

### Issue A: Deprecated `document.execCommand`
* **Vulnerability**: Modern browsers have officially deprecated `document.execCommand` (it is marked as obsolete). While still supported for backward compatibility, browsers can remove it at any time.
* **Fix**: Use custom Range manipulation wrappers or adapt slate-like selection node wrappers to insert inline elements (e.g. wrapping range selections inside `<strong>` or `<em>` elements manually):
  ```javascript
  const selection = window.getSelection();
  if (selection.rangeCount) {
      const range = selection.getRangeAt(0);
      const strong = document.createElement('strong');
      range.surroundContents(strong);
  }
  ```

---

## 6. Refactored Editor Code Fixes

Here is the refactored, hardened implementation of [editor/editor.js](file:///c:/Users/hp/OneDrive/Desktop/SyncWrite/editor/editor.js) addressing the identified architectural weaknesses, race conditions, memory leaks, and performance concerns.

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('rich-editor');
    const editorIndicator = document.getElementById('editor-indicator');
    const toolButtons = document.querySelectorAll('.tool-btn');

    const urlParams = new URLSearchParams(window.location.search);
    const frameId = urlParams.get('id') || 'unknown';
    editorIndicator.textContent = frameId.toUpperCase();

    let isApplyingRemoteChange = false;
    let lastContent = editor.innerHTML;
    let lastReceivedTimestamp = 0;

    const processedMessageIds = new Set();
    const MESSAGE_ID_TTL_MS = 10000;
    let debounceTimeoutId = null;

    // Secure Target Origin Resolution
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;

    // HTML Sanitizer to prevent basic XSS injections
    function sanitizeHTML(dirtyHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = dirtyHTML;
        
        // Remove script tags
        const scripts = tempDiv.getElementsByTagName('script');
        let i = scripts.length;
        while (i--) {
            scripts[i].parentNode.removeChild(scripts[i]);
        }

        // Clean event handler attributes (e.g. onload, onerror)
        const allElements = tempDiv.getElementsByTagName('*');
        for (let el of allElements) {
            const attrs = el.attributes;
            let j = attrs.length;
            while (j--) {
                const attrName = attrs[j].name;
                if (attrName.startsWith('on')) {
                    el.removeAttribute(attrName);
                }
            }
        }
        return tempDiv.innerHTML;
    }

    function updateToolbarState() {
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

    function triggerSyncFlash(sourceId) {
        const syncIcon = document.getElementById('sync-icon');
        const syncText = document.getElementById('sync-text');

        if (syncIcon && syncText) {
            syncIcon.classList.remove('flash-sync');
            void syncIcon.offsetWidth; 
            syncIcon.classList.add('flash-sync');

            const nameFormatted = sourceId.replace('frame-', 'Frame ').toUpperCase();
            syncText.textContent = `Synced (from ${nameFormatted})`;

            setTimeout(() => {
                syncText.textContent = 'Synced';
            }, 1800);
        }
    }

    function broadcastFormatChange(actionName) {
        if (isApplyingRemoteChange) return;

        const currentHTML = editor.innerHTML;
        if (currentHTML === lastContent) return;

        lastContent = currentHTML;

        const messageId = self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        const payload = {
            messageId: messageId,
            type: 'FORMAT_SYNC',
            action: actionName,
            html: currentHTML,
            senderId: frameId,
            tsCreate: Date.now(),
            timestamp: Date.now()
        };

        processedMessageIds.add(messageId);
        setTimeout(() => {
            processedMessageIds.delete(messageId);
        }, MESSAGE_ID_TTL_MS);

        window.parent.postMessage(payload, targetOrigin);
    }

    function debounceBroadcast(actionName, delayMs) {
        if (debounceTimeoutId) clearTimeout(debounceTimeoutId);
        debounceTimeoutId = setTimeout(() => {
            broadcastFormatChange(actionName);
        }, delayMs);
    }

    function handleToolbarAction(event) {
        if (isApplyingRemoteChange) return;
        if (debounceTimeoutId) clearTimeout(debounceTimeoutId);

        event.preventDefault();
        const button = event.currentTarget;
        const command = button.getAttribute('data-command');

        document.execCommand(command, false, null);
        editor.focus();
        updateToolbarState();
        broadcastFormatChange(command);
    }

    function handleManualInput() {
        if (isApplyingRemoteChange) return;
        updateToolbarState();
        debounceBroadcast('input', 300);
    }

    // High Performance TreeWalker selection capture
    function getSelectionCharacterOffsetWithin(element) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        
        const range = selection.getRangeAt(0);
        if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
            return null;
        }

        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.startContainer, range.startOffset);
        const start = preCaretRange.toString().length;

        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const end = preCaretRange.toString().length;

        return { start, end };
    }

    // High Performance TreeWalker selection restoration
    function setSelectionCharacterOffsetWithin(element, offsets) {
        if (!offsets) return;
        const selection = window.getSelection();
        if (!selection) return;

        const range = document.createRange();
        let currentOffset = 0;
        let startNode = null;
        let startNodeOffset = 0;
        let endNode = null;
        let endNodeOffset = 0;

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        let foundStart = false;
        let foundEnd = false;

        while ((node = walker.nextNode())) {
            const nextOffset = currentOffset + node.length;
            if (!foundStart && offsets.start >= currentOffset && offsets.start <= nextOffset) {
                startNode = node;
                startNodeOffset = offsets.start - currentOffset;
                foundStart = true;
            }
            if (!foundEnd && offsets.end >= currentOffset && offsets.end <= nextOffset) {
                endNode = node;
                endNodeOffset = offsets.end - currentOffset;
                foundEnd = true;
            }
            if (foundStart && foundEnd) break;
            currentOffset = nextOffset;
        }

        if (!startNode) {
            startNode = element;
            startNodeOffset = 0;
        }
        if (!endNode) {
            endNode = startNode;
            endNodeOffset = startNodeOffset;
        }

        try {
            range.setStart(startNode, startNodeOffset);
            range.setEnd(endNode, endNodeOffset);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {
            console.warn('[Caret Preservation] Failed to restore range', e);
        }
    }

    toolButtons.forEach(btn => btn.addEventListener('mousedown', handleToolbarAction));
    editor.addEventListener('input', handleManualInput);

    // FIX: Attach selection listeners to the LOCAL document, preventing window memory leaks
    window.document.addEventListener('selectionchange', updateToolbarState);
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);

    // Clean up event listeners on iframe teardown
    window.addEventListener('unload', () => {
        toolButtons.forEach(btn => btn.removeEventListener('mousedown', handleToolbarAction));
        editor.removeEventListener('input', handleManualInput);
        window.document.removeEventListener('selectionchange', updateToolbarState);
        editor.removeEventListener('keyup', updateToolbarState);
        editor.removeEventListener('mouseup', updateToolbarState);
    });

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;

        const { type, html, senderId, messageId, tsCreate, tsRelay, timestamp } = event.data;
        if (type === 'FORMAT_SYNC') {
            // FIX: Reject out-of-order stale updates
            const msgTime = timestamp || tsCreate;
            if (msgTime && msgTime < lastReceivedTimestamp) {
                return;
            }
            lastReceivedTimestamp = msgTime;

            if (messageId && processedMessageIds.has(messageId)) {
                return;
            }

            if (messageId) {
                processedMessageIds.add(messageId);
                setTimeout(() => processedMessageIds.delete(messageId), MESSAGE_ID_TTL_MS);
            }

            if (editor.innerHTML === html) {
                lastContent = html;
                return;
            }

            const isEditorFocused = (document.activeElement === editor);
            const savedCaretOffsets = isEditorFocused ? getSelectionCharacterOffsetWithin(editor) : null;

            isApplyingRemoteChange = true;

            // FIX: Sanitize content before DOM write to mitigate XSS
            const cleanHTML = sanitizeHTML(html);
            editor.innerHTML = cleanHTML;
            lastContent = cleanHTML;

            if (isEditorFocused && savedCaretOffsets) {
                setSelectionCharacterOffsetWithin(editor, savedCaretOffsets);
            }

            triggerSyncFlash(senderId || 'unknown');
            updateToolbarState();

            isApplyingRemoteChange = false;

            const tsProcess = Date.now();
            window.parent.postMessage({
                type: 'SYNC_METRICS',
                receiverId: frameId,
                originalSenderId: senderId,
                metrics: {
                    tsCreate: tsCreate || timestamp || Date.now(),
                    tsRelay: tsRelay || Date.now(),
                    tsProcess: tsProcess
                }
            }, targetOrigin);
        }
    });
});
```
