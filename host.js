document.addEventListener('DOMContentLoaded', () => {
    // 1. Store DOM Element References to the Iframes and Stats Panels
    const iframeA = document.getElementById('frame-a');
    const iframeB = document.getElementById('frame-b');
    const logOutput = document.getElementById('log-output');
    const clearLogsBtn = document.getElementById('clear-logs');

    // Caching Sync Statistics UI Elements
    const statTotalSent = document.getElementById('stat-total-sent');
    const statTotalReceived = document.getElementById('stat-total-received');
    const statFromA = document.getElementById('stat-from-a');
    const statFromB = document.getElementById('stat-from-b');
    const statLastSync = document.getElementById('stat-last-sync');
    const statAvgLatency = document.getElementById('stat-avg-latency');
    const resetStatsBtn = document.getElementById('reset-stats');

    // Statistics Tracker State
    let totalSent = 0;
    let totalReceived = 0;
    let fromA = 0;
    let fromB = 0;
    let lastSyncTime = '--';
    let totalLatency = 0;
    let latencyCount = 0;

    // Helper to sync stats state changes with DOM view
    function updateStatsUI() {
        if (statTotalSent) statTotalSent.textContent = totalSent;
        if (statTotalReceived) statTotalReceived.textContent = totalReceived;
        if (statFromA) statFromA.textContent = fromA;
        if (statFromB) statFromB.textContent = fromB;
        if (statLastSync) statLastSync.textContent = lastSyncTime;
        
        const avg = latencyCount > 0 ? (totalLatency / latencyCount).toFixed(1) : '0.0';
        if (statAvgLatency) statAvgLatency.textContent = `${avg} ms`;
    }

    // Reset statistics handler
    if (resetStatsBtn) {
        resetStatsBtn.addEventListener('click', () => {
            totalSent = 0;
            totalReceived = 0;
            fromA = 0;
            fromB = 0;
            lastSyncTime = '--';
            totalLatency = 0;
            latencyCount = 0;
            updateStatsUI();
        });
    }

    // Expected Origin for security validation
    // In local development or deployment, this limits origin trust to the current host origin
    const expectedOrigin = window.location.origin;

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
        let isFromA = false;

        if (event.source === frameAWindow) {
            senderName = 'Frame A';
            targetWindow = frameBWindow;
            targetName = 'Frame B';
            isFromA = true;
        } else if (event.source === frameBWindow) {
            senderName = 'Frame B';
            targetWindow = frameAWindow;
            targetName = 'Frame A';
            isFromA = false;
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
        const type = payload.type || 'unknown';

        if (type === 'FORMAT_SYNC') {
            // Update Statistics counters upon message receipt
            totalReceived++;
            if (isFromA) {
                fromA++;
            } else {
                fromB++;
            }
            lastSyncTime = time;

            // Log event receipt to console
            console.log(`[Host Sync Log] [${time}] Received formatting command from ${senderName}:`, payload);

            // E. Relay the message to the opposite iframe window
            if (targetWindow) {
                totalSent++;
                
                // Attach the host relay execution timestamp
                payload.tsRelay = Date.now();

                // Route the payload. Origin '*' is used for local file support,
                // but can be replaced with expectedOrigin if running on HTTP/S servers.
                targetWindow.postMessage(payload, '*');
            }

            // Refresh stats elements
            updateStatsUI();

        } else if (type === 'SYNC_METRICS') {
            const { receiverId, originalSenderId, metrics } = payload;
            if (!metrics) return;

            const { tsCreate, tsRelay, tsProcess } = metrics;

            // Compute performance metrics
            // Relay Latency: Message creation to Host receipt/relay
            const relayLatency = Math.max(0, tsRelay - tsCreate);
            // Host to Receiver: Host relay to Receiver processing completion
            const hostToReceiverLatency = Math.max(0, tsProcess - tsRelay);
            // End-to-end Sync Latency
            const totalSyncTime = Math.max(0, tsProcess - tsCreate);

            // Accumulate latency metrics for global running average stats
            totalLatency += totalSyncTime;
            latencyCount++;

            // Format UI display text strings
            const senderLabel = originalSenderId.replace('frame-', 'Frame ').toUpperCase();
            const receiverLabel = receiverId.replace('frame-', 'Frame ').toUpperCase();

            // Log to standard developer console
            console.log(`[Performance Metrics] [${time}] ${senderLabel} -> Host: ${relayLatency}ms | Host -> ${receiverLabel}: ${hostToReceiverLatency}ms | Total Sync Time: ${totalSyncTime}ms`);

            // Append performance metrics log to the diagnostics panel on the Host Page
            // Example format requirement:
            // [11:13:02] Frame A -> Host : 2ms | Host -> Frame B : 1ms | Total Sync Time : 3ms
            const entry = document.createElement('div');
            entry.className = `log-entry rx-msg`;
            
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'timestamp';
            timestampSpan.textContent = `[${time}]`;
            entry.appendChild(timestampSpan);

            const textNode = document.createTextNode(
                ` ${senderLabel} -> Host : ${relayLatency}ms | Host -> ${receiverLabel} : ${hostToReceiverLatency}ms | Total Sync Time : ${totalSyncTime}ms`
            );
            entry.appendChild(textNode);

            logOutput.appendChild(entry);
            logOutput.scrollTop = logOutput.scrollHeight;

            // Refresh stats elements with updated running average latency
            updateStatsUI();
        }
    });

    console.log('[Host Initialization] Host Page listener active. Origin whitelist:', expectedOrigin);
});
