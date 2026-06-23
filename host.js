document.addEventListener('DOMContentLoaded', () => {
    // 1. Store DOM Element References to the Iframes
    const iframeA = document.getElementById('frame-a');
    const iframeB = document.getElementById('frame-b');
    const logOutput = document.getElementById('log-output');
    const clearLogsBtn = document.getElementById('clear-logs');

    // Expected Origin for security validation
    // In local development or deployment, this limits origin trust to the current host origin
    const expectedOrigin = window.location.origin;

    // Helper to log actions both to the host console and to the UI status panel
    function logSyncEvent(direction, message, detail = {}) {
        const time = new Date().toLocaleTimeString();
        
        // Log to console (requirement)
        console.log(`[Host Sync Log] [${time}] [${direction}] ${message}`, detail);

        // Render in UI log panel
        const entry = document.createElement('div');
        entry.className = `log-entry ${direction === 'RELAY' ? 'rx-msg' : 'tx-msg'}`;
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = `[${time}] [${direction}]`;
        
        entry.appendChild(timestampSpan);
        entry.appendChild(document.createTextNode(` ${message} (${JSON.stringify(detail)})`));
        
        logOutput.appendChild(entry);
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    // Clear UI logs handler
    clearLogsBtn.addEventListener('click', () => {
        logOutput.innerHTML = '<div class="log-entry system-msg">[System] Logs cleared. Ready to route messages...</div>';
    });

    // 2. Listen for postMessage events
    window.addEventListener('message', (event) => {
        // A. Origin Validation
        // For file:/// protocols, the origin is string "null". 
        // We match expectedOrigin OR event.origin === 'null' to support local file browsing safely.
        const isOriginValid = (expectedOrigin === event.origin) || (expectedOrigin === 'null' || event.origin === 'null');
        
        if (!isOriginValid) {
            console.warn(`[Host Security] Blocked postMessage from unauthorized origin: ${event.origin}`);
            return;
        }

        // B. Store References to both active iframe contentWindows
        const frameAWindow = iframeA ? iframeA.contentWindow : null;
        const frameBWindow = iframeB ? iframeB.contentWindow : null;

        if (!frameAWindow || !frameBWindow) {
            console.warn('[Host Alert] Active iframe windows are not fully loaded or available.');
            return;
        }

        // C. Detect which iframe sent the message (Originating source validation)
        let senderName = '';
        let targetWindow = null;
        let targetName = '';

        if (event.source === frameAWindow) {
            senderName = 'Frame A';
            targetWindow = frameBWindow;
            targetName = 'Frame B';
        } else if (event.source === frameBWindow) {
            senderName = 'Frame B';
            targetWindow = frameAWindow;
            targetName = 'Frame A';
        } else {
            // Ignore messages from other sources (e.g. browser extensions)
            return;
        }

        // D. Retrieve and validate payload shape
        const payload = event.data;
        if (!payload || typeof payload !== 'object') {
            console.warn(`[Host Alert] Received empty or invalid payload structure from ${senderName}`);
            return;
        }

        const time = new Date().toLocaleTimeString();
        const action = payload.action || 'unknown';
        const type = payload.type || 'unknown';

        // Log the message receipt with specific parameters to console (Timestamp, Sender, Action, Payload Type)
        console.log(`[Host Sync Log] [${time}] Sender: ${senderName} | Action: ${action} | Type: ${type}`, payload);

        // Render in UI log panel (Timestamp, Sender, Action, Payload Type)
        const entry = document.createElement('div');
        entry.className = `log-entry rx-msg`;
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = `[${time}]`;
        
        entry.appendChild(timestampSpan);
        
        const textNode = document.createTextNode(
            ` Sender: ${senderName} | Action: ${action} | Type: ${type}`
        );
        entry.appendChild(textNode);
        
        logOutput.appendChild(entry);
        logOutput.scrollTop = logOutput.scrollHeight;

        // E. Relay the message to the opposite iframe window
        if (targetWindow) {
            // Route the payload. Origin '*' is used for local file support,
            // but can be replaced with expectedOrigin if running on HTTP/S servers.
            targetWindow.postMessage(payload, '*');
        }
    });

    console.log('[Host Initialization] Host Page listener active. Origin whitelist:', expectedOrigin);
});
