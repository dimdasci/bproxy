const codeInput = document.getElementById('code');
const button = document.getElementById('pair');
const logEl = document.getElementById('log');

function log(msg) {
  logEl.textContent += msg + '\n';
}

button.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) { log('enter a code first'); return; }
  log(`POST /pair/claim with code=${code}...`);
  try {
    const res = await fetch('http://127.0.0.1:9091/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    log(`response (${res.status}):\n${JSON.stringify(json, null, 2)}`);
    if (json.ok) {
      await chrome.storage.local.set({
        extensionToken: json.data.extensionToken,
        wsUrl: json.data.wsUrl,
      });
      log('stored token in chrome.storage.local');
      chrome.runtime.sendMessage({ type: 'pair.complete' });
    }
  } catch (err) {
    log(`error: ${err.message}`);
  }
});
