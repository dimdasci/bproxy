function visible(el) {
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function cssPath(el) {
  if (!(el instanceof Element)) return '';
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && parts.length < 4) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      part += `#${cur.id}`;
      parts.unshift(part);
      break;
    }
    if (cur.classList.length) part += '.' + Array.from(cur.classList).slice(0, 2).join('.');
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'poc.dom.snapshot') return;

  const allInteractive = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="textbox"], [contenteditable="true"]'));
  const items = allInteractive
    .filter(visible)
    .slice(0, 60)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      role: el.getAttribute('role') || undefined,
      name: el.getAttribute('name') || undefined,
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || undefined,
      text: (el.textContent || '').trim().slice(0, 120) || undefined,
      selector: cssPath(el),
      contenteditable: el.getAttribute('contenteditable') || undefined,
    }));

  const text = (document.body?.innerText || '').trim().slice(0, 2000);

  sendResponse({
    ok: true,
    data: {
      url: location.href,
      title: document.title,
      elements: items,
      text,
    },
  });

  return true;
});
