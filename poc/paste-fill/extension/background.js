chrome.runtime.onInstalled.addListener(() => {
  console.log('[poc-paste-fill] installed');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'poc.dom.snapshot.run') return;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' });

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });

      const res = await chrome.tabs.sendMessage(tab.id, { type: 'poc.dom.snapshot' });
      sendResponse(res);
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
