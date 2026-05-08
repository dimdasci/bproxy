const valueInput = document.getElementById('value');
const fillBtn = document.getElementById('fill');
const checkBtn = document.getElementById('check');
const snapshotBtn = document.getElementById('snapshot');
const logEl = document.getElementById('log');

function log(obj) {
  logEl.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

fillBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const value = valueInput.value;
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async (v) => {
        const selectors = [
          'div.ql-editor[contenteditable="true"][role="textbox"]',
        ];

        const findEditor = () => {
          for (const s of selectors) {
            const found = document.querySelector(s);
            if (found) return { el: found, selectorUsed: s };
          }
          return null;
        };

        let found = findEditor();

        if (!found) {
          const startPostCandidates = Array.from(document.querySelectorAll('[role="button"], button, div'));
          const startPost = startPostCandidates.find((el) => /start a post/i.test((el.textContent || '').trim()));
          if (startPost) startPost.click();

          const deadline = Date.now() + 4000;
          while (!found && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
            found = findEditor();
          }
        }

        if (!found) return { ok: false, reason: 'COMPOSER_NOT_FOUND', tried: selectors, href: location.href };

        const { el, selectorUsed } = found;
        el.focus();
        el.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = v;
        el.appendChild(p);
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: v, bubbles: true, cancelable: true }));
        el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: v, bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const current = el.textContent?.replace(/\u200B/g, '').trim() ?? '';
        return { ok: true, value: current, selectorUsed, href: location.href };
      },
      args: [value],
    });

    const hit = results.find((r) => r.result?.ok === true);
    if (hit) {
      log({ step: 'fill', frameId: hit.frameId, result: hit.result });
    } else {
      log({ step: 'fill', result: results.map((r) => ({ frameId: r.frameId, result: r.result })) });
    }
  } catch (err) {
    log({ step: 'fill', error: err.message });
  }
});

checkBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const selectors = [
          'div.ql-editor[contenteditable="true"][role="textbox"]',
        ];
        let el = null;
        let selectorUsed = null;
        for (const s of selectors) {
          const found = document.querySelector(s);
          if (found) { el = found; selectorUsed = s; break; }
        }
        if (!el) return { ok: false, reason: 'COMPOSER_NOT_FOUND', tried: selectors, href: location.href };
        const value = (el.textContent ?? '').replace(/\u200B/g, '').trim();
        return { ok: true, value, selectorUsed, href: location.href };
      },
    });

    const hit = results.find((r) => r.result?.ok === true);
    if (hit) {
      log({ step: 'check', frameId: hit.frameId, result: hit.result });
    } else {
      log({ step: 'check', result: results.map((r) => ({ frameId: r.frameId, result: r.result })) });
    }
  } catch (err) {
    log({ step: 'check', error: err.message });
  }
});

snapshotBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const visible = (el) => {
          const cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        const cssPath = (el) => {
          if (!(el instanceof Element)) return '';
          const parts = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && parts.length < 5) {
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
        };

        const selector = 'input, textarea, select, button, a, [role="button"], [role="textbox"], [contenteditable="true"]';
        const all = Array.from(document.querySelectorAll(selector));
        const elements = all
          .filter(visible)
          .slice(0, 200)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || undefined,
            role: el.getAttribute('role') || undefined,
            name: el.getAttribute('name') || undefined,
            placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || undefined,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
            contenteditable: el.getAttribute('contenteditable') || undefined,
            selector: cssPath(el),
          }));

        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500);

        return {
          ok: true,
          frameHref: location.href,
          documentTitle: document.title,
          elementsCount: elements.length,
          elements,
          text: bodyText,
        };
      },
    });

    log({
      step: 'snapshot',
      frames: frames.map((f) => ({ frameId: f.frameId, result: f.result })),
    });
  } catch (err) {
    log({ step: 'snapshot', error: err.message });
  }
});
