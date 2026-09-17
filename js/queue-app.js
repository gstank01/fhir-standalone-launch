document.addEventListener('DOMContentLoaded', () => {
    const refreshQueueBtn = document.getElementById('refreshQueueBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const queueTableBody = document.getElementById('queueTableBody');

    function safeLog(message) {
        if (typeof log === 'function') {
            log(message);
        } else {
            console.log(`[QUEUE LOG]: ${message.replace(/<[^>]*>/g, '')}`);
        }
    }

    if (!queueTableBody) return;

    // Lives on the main page now (next to the logs and FHIR response
    // output) instead of behind a separate modal/button, so it loads as
    // soon as the page does.
    loadQueue();

    // Manual Refresh click gets the detail pop-up; the automatic initial
    // page-load fetch (below) and any background refresh triggered by
    // another action (e.g. right after Evaluate queues a patient) stay
    // silent so the demo isn't interrupted by things nobody clicked.
    refreshQueueBtn?.addEventListener('click', () => loadQueue(true));

    clearQueueBtn?.addEventListener('click', async () => {
        if (!confirm('Clear the entire referral queue? This cannot be undone.')) {
            return;
        }

        clearQueueBtn.disabled = true;
        safeLog('Clearing referral queue...');

        try {
            const response = await fetch('/api/queue', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true })
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to clear referral queue.');
            }

            safeLog(`SUCCESS: Cleared ${data.deletedCount} entr${data.deletedCount === 1 ? 'y' : 'ies'} from the referral queue.`);
            await loadQueue();

            showActionDetail('Clear Queue', `
                <p>Here's exactly what happened when <strong>Clear Queue</strong> was clicked:</p>
                <ol style="padding-left: 20px;">
                    <li>Confirmed the destructive action with you first.</li>
                    <li>Sent <code>DELETE /api/queue</code> with <code>{ confirm: true }</code> — the endpoint refuses a full clear without that flag.</li>
                    <li>Server ran <code>DELETE FROM referral_queue RETURNING id</code>.</li>
                    <li><strong>${data.deletedCount}</strong> entr${data.deletedCount === 1 ? 'y' : 'ies'} removed.</li>
                    <li>Queue panel reloaded — now empty.</li>
                </ol>
            `);
        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: Failed to clear referral queue: ${escapeHtml(error.message)}</span>`);
            showActionDetail('Clear Queue (failed)', `<p style="color:#c4433b;">${escapeHtml(error.message)}</p>`);
        } finally {
            clearQueueBtn.disabled = false;
        }
    });

    // Exposed so other modules (e.g. js/cql-app.js, after a successful
    // evaluation) can refresh the panel without polling.
    window.refreshReferralQueue = loadQueue;

    async function loadQueue(showPopup = false) {
        queueTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px;">Loading referral queue...</td></tr>';
        safeLog('Fetching referral queue via /api/queue...');

        try {
            const response = await fetch('/api/queue');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch referral queue.');
            }

            const items = data.items;
            if (!items || items.length === 0) {
                safeLog('Referral queue is empty.');
                queueTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px;">No patients currently in the referral queue.</td></tr>';
                if (showPopup) {
                    showActionDetail('Refresh Queue', `
                        <p>Sent <code>GET /api/queue</code>, which reads the <code>referral_queue</code> table.</p>
                        <p>The table is currently empty — no patients have matched a rule yet.</p>
                    `);
                }
                return;
            }

            safeLog(`SUCCESS: Loaded ${items.length} referral queue record(s).`);

            const tableFragment = document.createDocumentFragment();

            items.forEach(item => {
                const row = document.createElement('tr');
                const queuedAt = item.created_at ? new Date(item.created_at).toLocaleString() : 'N/A';

                [item.name || 'Unknown', item.identifier || 'N/A', item.dob || 'N/A', item.rule_name || 'N/A', item.episode_name || 'N/A', item.status || 'N/A', queuedAt].forEach(value => {
                    const cell = document.createElement('td');
                    cell.style.padding = '8px 10px';
                    cell.style.borderBottom = '1px solid #ddd';
                    cell.textContent = value;
                    row.appendChild(cell);
                });

                tableFragment.appendChild(row);
            });

            queueTableBody.innerHTML = '';
            queueTableBody.appendChild(tableFragment);

            if (showPopup) {
                const rows = items.map(item => `
                    <tr>
                        <td style="padding:4px 8px;">${escapeHtml(item.name || 'Unknown')}</td>
                        <td style="padding:4px 8px;">${escapeHtml(item.identifier || 'N/A')}</td>
                        <td style="padding:4px 8px;">${escapeHtml(item.rule_name || 'N/A')}</td>
                        <td style="padding:4px 8px;">${escapeHtml(item.status || 'N/A')}</td>
                    </tr>
                `).join('');
                showActionDetail('Refresh Queue', `
                    <p>Sent <code>GET /api/queue</code>, which reads the <code>referral_queue</code> table.</p>
                    <p><strong>${items.length}</strong> patient(s) currently queued:</p>
                    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
                        <thead><tr style="background:#f4f4f4;">
                            <th style="text-align:left; padding:4px 8px;">Name</th>
                            <th style="text-align:left; padding:4px 8px;">Identifier</th>
                            <th style="text-align:left; padding:4px 8px;">Rule</th>
                            <th style="text-align:left; padding:4px 8px;">Status</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `);
            }

        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: Failed to load referral queue: ${escapeHtml(error.message)}</span>`);
            if (showPopup) {
                showActionDetail('Refresh Queue (failed)', `<p style="color:#c4433b;">${escapeHtml(error.message)}</p>`);
            }
            queueTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color: red;">Error: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});
