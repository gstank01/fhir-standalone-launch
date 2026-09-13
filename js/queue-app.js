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

    refreshQueueBtn?.addEventListener('click', loadQueue);

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
        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: Failed to clear referral queue: ${escapeHtml(error.message)}</span>`);
        } finally {
            clearQueueBtn.disabled = false;
        }
    });

    // Exposed so other modules (e.g. js/cql-app.js, after a successful
    // evaluation) can refresh the panel without polling.
    window.refreshReferralQueue = loadQueue;

    async function loadQueue() {
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

        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: Failed to load referral queue: ${escapeHtml(error.message)}</span>`);
            queueTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color: red;">Error: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});
