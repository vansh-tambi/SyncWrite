document.addEventListener('DOMContentLoaded', () => {
    // 1. DOM Element Cache
    const editor = document.getElementById('rich-editor');
    const editorIndicator = document.getElementById('editor-indicator');
    const toolButtons = document.querySelectorAll('.tool-btn');

    // Identify current frame name using URL search parameters (e.g. ?id=frame-a)
    const urlParams = new URLSearchParams(window.location.search);
    const frameId = urlParams.get('id') || 'unknown';
    editorIndicator.textContent = frameId.toUpperCase();

    // Loop prevention state tracking
    let isApplyingRemoteChange = false;
    let lastContent = editor.innerHTML;

    // Helper to query browser command state and toggle button highlighting
    function updateToolbarState() {
        toolButtons.forEach(btn => {
            const command = btn.getAttribute('data-command');
            try {
                if (document.queryCommandState(command)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            } catch (e) {
                // Fail-safe for commands that aren't toggle states
            }
        });
    }

    // Helper to trigger active sync visual notification inside iframe toolbar
    function triggerSyncFlash(sourceId) {
        const syncIcon = document.getElementById('sync-icon');
        const syncText = document.getElementById('sync-text');

        if (syncIcon && syncText) {
            // Reset and trigger css transition flash
            syncIcon.classList.remove('flash-sync');
            void syncIcon.offsetWidth; // Force layout recalculation to restart animation
            syncIcon.classList.add('flash-sync');

            // Format badge name from "frame-a" to "Frame A"
            const nameFormatted = sourceId.replace('frame-', 'Frame ').toUpperCase();
            syncText.textContent = `Synced (from ${nameFormatted})`;

            // Revert back to passive "Synced" after timeout
            setTimeout(() => {
                syncText.textContent = 'Synced';
            }, 1800);
        }
    }

    // Message deduplication cache
    const processedMessageIds = new Set();
    const MESSAGE_ID_TTL_MS = 10000; // Deduplication window duration (10 seconds)

    /**
     * Extracts the current HTML contents from the contenteditable div
     * and sends a 'FORMAT_SYNC' message payload to the parent window.
     * 
     * @param {string} actionName - The style action performed (e.g., 'bold', 'italic', 'strikeThrough', 'input')
     */
    // Debounce timer tracking for manual keyboard input synchronization
    let debounceTimeoutId = null;

    function broadcastFormatChange(actionName) {
        // Guard check: Do not broadcast if we are applying a remote update
        if (isApplyingRemoteChange) return;

        const currentHTML = editor.innerHTML;

        // Guard check: Avoid duplicate messages if the content hasn't actually modified
        if (currentHTML === lastContent) return;

        lastContent = currentHTML;

        // Generate a cryptographically secure unique message ID
        const messageId = self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

        // Construct message payload matching the required specifications
        const payload = {
            messageId: messageId,
            type: 'FORMAT_SYNC',
            action: actionName,
            html: currentHTML,
            senderId: frameId,
            timestamp: Date.now() // timestamp helps host route updates in correct order
        };

        // Cache our own messageId to prevent echo loop issues (if any)
        processedMessageIds.add(messageId);
        setTimeout(() => {
            processedMessageIds.delete(messageId);
        }, MESSAGE_ID_TTL_MS);

        // Post message to parent window (Host page)
        window.parent.postMessage(payload, '*');
    }

    /**
     * Debounces the broadcast of formatting changes to prevent flooding the message channel.
     * 
     * @param {string} actionName - The action name
     * @param {number} delayMs - Delay in milliseconds
     */
    function debounceBroadcast(actionName, delayMs) {
        if (debounceTimeoutId) {
            clearTimeout(debounceTimeoutId);
        }
        debounceTimeoutId = setTimeout(() => {
            broadcastFormatChange(actionName);
        }, delayMs);
    }

    /**
     * Handles formatting button clicks, executing browser document styling 
     * and broadcasting changes to the parent frame.
     * 
     * @param {Event} event - The button click event object
     */
    function handleToolbarAction(event) {
        // Guard check
        if (isApplyingRemoteChange) return;

        // Cancel any pending debounced input synchronization to prevent race conditions
        if (debounceTimeoutId) {
            clearTimeout(debounceTimeoutId);
        }

        // Prevent button click from steal focus from contenteditable div selection range
        event.preventDefault();

        const button = event.currentTarget;
        const command = button.getAttribute('data-command');

        // Apply visual text styling to current text selection
        document.execCommand(command, false, null);

        // Keep focus inside editor
        editor.focus();

        // Check active commands and update toolbar states
        updateToolbarState();

        // Broadcast the updated state and command name instantly
        broadcastFormatChange(command);
    }

    /**
     * Handles manual key press or direct inputs in the editor, broadcasting content changes.
     */
    function handleManualInput() {
        if (isApplyingRemoteChange) return;
        updateToolbarState();
        
        // Debounce typing inputs by 300ms to avoid flooding the message channel
        debounceBroadcast('input', 300);
    }

    // 2. Attach click listeners to toolbar buttons
    toolButtons.forEach(btn => {
        btn.addEventListener('mousedown', handleToolbarAction);
    });

    // 3. Attach input event listener to capture keyboard typing and pasting
    editor.addEventListener('input', handleManualInput);

    // 4. Track cursor updates and selection bounds to adjust formatting buttons highlight
    document.addEventListener('selectionchange', updateToolbarState);
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);

    // 5. Listen for incoming messages from Host and apply content directly
    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;

        const { type, html, senderId, messageId } = event.data;
        if (type === 'FORMAT_SYNC') {
            // Deduplication Guard: Ignore recently processed messages
            if (messageId && processedMessageIds.has(messageId)) {
                return;
            }

            // Register messageId to deduplicate retries
            if (messageId) {
                processedMessageIds.add(messageId);
                setTimeout(() => {
                    processedMessageIds.delete(messageId);
                }, MESSAGE_ID_TTL_MS);
            }

            // Guard Check: Skip updates if target HTML is already matching local HTML state
            if (editor.innerHTML === html) {
                lastContent = html;
                return;
            }

            // Set Lock to true prior to DOM mutation
            isApplyingRemoteChange = true;

            editor.innerHTML = html;
            lastContent = html;

            // Trigger sync UI notification
            triggerSyncFlash(senderId || 'unknown');

            // Force button highlights update
            updateToolbarState();

            // Release Lock after UI update has finished rendering
            isApplyingRemoteChange = false;
        }
    });
});
