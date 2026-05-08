chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'pair.complete') {
    console.log('[poc] pair.complete received from popup');
    chrome.storage.local.get(['extensionToken', 'wsUrl']).then((stored) => {
      console.log('[poc] stored bootstrap:', stored);
    });
  }
});
