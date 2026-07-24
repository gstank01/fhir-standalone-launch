// --- RANDOM STRING GENERATOR (For the randomly generated state that will be append it to each subsequent exchange in the workflow for you to validate session integrity) ---
export function generateRandomString(length = 32) { //determine the length of the string 
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';//allowed characters
    const values = new Uint8Array(length);//allocate byte storage
    crypto.getRandomValues(values); //uses the underlying OS entropy sources (hardware noise, system interrupts) to generate truly unpredictable values.
    return Array.from(values).map(x => possible[x % possible.length]).join(''); //Map random bytes to characters and return the result
}

export // --- LOGGING HELPER ---
function log(message) {
    const div = document.getElementById('logs');
    if (!div) return;
    div.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${message}</div>`;
    div.scrollTop = div.scrollHeight;
}
