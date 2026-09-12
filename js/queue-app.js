document.addEventListener('DOMContentLoaded', () => {
    const btnViewQueue = document.getElementById('btn-view-queue');
    const queueModal = document.getElementById('queueModal');
    const cancelQueueBtn = document.getElementById('cancelQueueBtn');
    const refreshQueueBtn = document.getElementById('refreshQueueBtn');
    const queueTableBody = document.getElementById('queueTableBody');

    function safeLog(message) {
        if (typeof log === 'function') {
            log(message);
        } else {
            console.log(`[QUEUE LOG]: ${message.replace(/<[^>]*>/g, '')}`);
        }
    }

    if (!btnViewQueue) return;

    btnViewQueue.addEventListener('click', async () => {
        queueModal.classList.add('active');
        safeLog('Opening referral queue...');
        await loadQueue();
    });

    cancelQueueBtn.addEventListener('click', () => {
        queueModal.classList.remove('active');
        safeLog('Referral queue closed.');
    });

    refreshQueueBtn.addEventListener('click', loadQueue);

    async function loadQueue() {
        queueTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:15px;">Loading referral queue...</td></tr>';
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
                queueTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:15px;">No patients currently in the referral queue.</td></tr>';
                return;
            }

            safeLog(`SUCCESS: Loaded ${items.length} referral queue record(s).`);

            const tableFragment = document.createDocumentFragment();

            items.forEach(item => {
                const row = document.createElement('tr');
                const queuedAt = item.created_at ? new Date(item.created_at).toLocaleString() : 'N/A';

                [item.name || 'Unknown', item.identifier || 'N/A', item.dob || 'N/A', item.rule_name || 'N/A', item.status || 'N/A', queuedAt].forEach(value => {
                    const cell = document.createElement('td');
                    cell.style.padding = '10px';
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
            queueTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color: red;">Error: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});
