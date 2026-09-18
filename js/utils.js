// --- Random string generator (For the randomly generated state that will be appended to each subsequent exchange in the workflow to validate session integrity) ---
function generateRandomString(length = 32) { //determine the length of the string 
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';//allowed characters
    const values = new Uint8Array(length);//allocate byte storage
    crypto.getRandomValues(values); //uses the underlying OS entropy sources (hardware noise, system interrupts) to generate truly unpredictable values.
    return Array.from(values).map(x => possible[x % possible.length]).join(''); //Map random bytes to characters and return the result
}

// --- Logging helper ---
function log(message) {
    const div = document.getElementById('logs');
    if (!div) return;
    div.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${message}</div>`;
    div.scrollTop = div.scrollHeight;
}

// --- Shared "what just happened" pop-up, used by the CQL-app and the
// referral queue to give a demo audience a plain-language walkthrough of
// each action instead of just a log line + raw JSON. ---
function showActionDetail(title, bodyHtml) {
    const modal = document.getElementById('actionDetailModal');
    const titleEl = document.getElementById('actionDetailTitle');
    const bodyEl = document.getElementById('actionDetailBody');
    if (!modal || !titleEl || !bodyEl) return;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    modal.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('closeActionDetailBtn')?.addEventListener('click', () => {
        document.getElementById('actionDetailModal')?.classList.remove('active');
    });
});

// ---CALLBACK HANDLER (Runs inside Pop-up when redirected back from EHR) ---

(function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search); //search the returned URL to extract the code paramether and match the state parametre with the one we sent out
    const code = urlParams.get('code'); //code
    const returnedState = urlParams.get('state'); //state

    if (code && window.opener) { // check that a code was received and that the session is opened in a pop-up window
        //Uses postMessage to cross the boundary between pop-up and main window safely
        window.opener.postMessage({ 
            type: 'AUTH_CODE', 
            code: code, 
            state: returnedState 
        }, window.location.origin);
        window.close();
    }
})();
