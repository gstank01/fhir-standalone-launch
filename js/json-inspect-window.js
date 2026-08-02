// --- Helper for opening raw JSON object in a popup window linking external CSS ---
//This is the configuration for the window where we can inspect the patient resourse.

function openJsonInspectionWindow(title, rootId, jsonData) {
    const jsonWindow = window.open("", title, "width=700,height=800,scrollbars=yes");
    if (!jsonWindow) {
        log("WARNING: Pop-up blocked! Allow pop-ups to inspect raw FHIR JSON.");
        return;
    }

    const doc = jsonWindow.document;
    doc.open();

    const html = doc.createElement('html');
    const head = doc.createElement('head');
    
    const titleEl = doc.createElement('title');
    titleEl.textContent = title;
    head.appendChild(titleEl);

    // Link directly to external CSS file (no CSS in JS)
    const linkEl = doc.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = 'css/styles.css';
    head.appendChild(linkEl);

    const body = doc.createElement('body');
    body.className = 'inspection-window-body';

    const h2 = doc.createElement('h2');
    h2.textContent = title;
    body.appendChild(h2);

    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode("Root id field value: "));
    const span = doc.createElement('span');
    span.className = 'highlight';
    span.textContent = rootId || 'UNDEFINED';
    p.appendChild(span);
    body.appendChild(p);

    body.appendChild(doc.createElement('hr'));

    const pre = doc.createElement('pre');
    pre.className = 'json-inspection-preview';
    pre.textContent = JSON.stringify(jsonData, null, 2);
    body.appendChild(pre);

    html.appendChild(head);
    html.appendChild(body);
    doc.appendChild(html);

    doc.close();
}
