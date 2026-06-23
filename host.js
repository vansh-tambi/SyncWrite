document.addEventListener('DOMContentLoaded', () => {
    const iframeA = document.getElementById('frame-a');
    const iframeB = document.getElementById('frame-b');
    const logOutput = document.getElementById('log-output');
    const clearLogsBtn = document.getElementById('clear-logs');

    const statTotalSent = document.getElementById('stat-total-sent');
    const statTotalReceived = document.getElementById('stat-total-received');
    const statFromA = document.getElementById('stat-from-a');
    const statFromB = document.getElementById('stat-from-b');
    const statLastSync = document.getElementById('stat-last-sync');
    const statAvgLatency = document.getElementById('stat-avg-latency');
    const resetStatsBtn = document.getElementById('reset-stats');

    let totalSent = 0;
    let totalReceived = 0;
    let fromA = 0;
    let fromB = 0;
    let lastSyncTime = '--';
    let totalLatency = 0;
    let latencyCount = 0;

    function updateStatsUI() {
        if (statTotalSent) statTotalSent.textContent = totalSent;
        if (statTotalReceived) statTotalReceived.textContent = totalReceived;
        if (statFromA) statFromA.textContent = fromA;
        if (statFromB) statFromB.textContent = fromB;
        if (statLastSync) statLastSync.textContent = lastSyncTime;
        
        const avg = latencyCount > 0 ? (totalLatency / latencyCount).toFixed(1) : '0.0';
        if (statAvgLatency) statAvgLatency.textContent = `${avg} ms`;
    }

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

    const expectedOrigin = window.location.origin;

    clearLogsBtn.addEventListener('click', () => {
        logOutput.innerHTML = '<div class="log-entry system-msg">Logs cleared.</div>';
    });

    window.addEventListener('message', (event) => {
        // Origin validation
        const isOriginValid = (expectedOrigin === event.origin) || (expectedOrigin === 'null' || event.origin === 'null');
        if (!isOriginValid) {
            console.warn('Blocked message from untrusted origin:', event.origin);
            return;
        }

        const frameAWindow = iframeA ? iframeA.contentWindow : null;
        const frameBWindow = iframeB ? iframeB.contentWindow : null;

        if (!frameAWindow || !frameBWindow) return;

        // Detect sender
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
            return;
        }

        const payload = event.data;
        if (!payload || typeof payload !== 'object') return;

        const time = new Date().toLocaleTimeString();
        const type = payload.type || 'unknown';

        if (type === 'FORMAT_SYNC') {
            totalReceived++;
            if (isFromA) {
                fromA++;
            } else {
                fromB++;
            }
            lastSyncTime = time;

            console.log(`${senderName} -> Host: format sync`);

            if (targetWindow) {
                totalSent++;
                payload.tsRelay = Date.now();
                const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
                targetWindow.postMessage(payload, targetOrigin);
            }
            updateStatsUI();

        } else if (type === 'SYNC_METRICS') {
            const { receiverId, originalSenderId, metrics } = payload;
            if (!metrics) return;

            const { tsCreate, tsRelay, tsProcess } = metrics;

            const relayLatency = Math.max(0, tsRelay - tsCreate);
            const hostToReceiverLatency = Math.max(0, tsProcess - tsRelay);
            const totalSyncTime = Math.max(0, tsProcess - tsCreate);

            totalLatency += totalSyncTime;
            latencyCount++;

            const senderLabel = originalSenderId.replace('frame-', 'Frame ').toUpperCase();
            const receiverLabel = receiverId.replace('frame-', 'Frame ').toUpperCase();

            // Clean, non-verbose console log
            console.log(`${senderLabel} -> Host: ${relayLatency}ms | Host -> ${receiverLabel}: ${hostToReceiverLatency}ms | Total: ${totalSyncTime}ms`);

            // Clean log entry in UI Event Log
            const entry = document.createElement('div');
            entry.className = 'log-entry rx-msg';
            
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'timestamp';
            timestampSpan.textContent = `[${time}]`;
            entry.appendChild(timestampSpan);

            const textNode = document.createTextNode(
                ` ${senderLabel} -> Host: ${relayLatency}ms | Host -> ${receiverLabel}: ${hostToReceiverLatency}ms | Total: ${totalSyncTime}ms`
            );
            entry.appendChild(textNode);

            logOutput.appendChild(entry);
            logOutput.scrollTop = logOutput.scrollHeight;

            updateStatsUI();
        }
    });

    console.log('Host initialized');
});
