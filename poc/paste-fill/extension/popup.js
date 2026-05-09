const EXT_VERSION = '0.0.5';

const valueInput = document.getElementById('value');
const fillBtn = document.getElementById('fill');
const checkBtn = document.getElementById('check');
const snapshotBtn = document.getElementById('snapshot');
const logEl = document.getElementById('log');

function log(obj) {
  if (typeof obj === 'string') {
    logEl.textContent = '[ext ' + EXT_VERSION + '] ' + obj;
    return;
  }
  const out = Object.assign({ extVersion: EXT_VERSION }, obj);
  logEl.textContent = JSON.stringify(out, null, 2);
}

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) throw new Error('No active tab');
  return tab.id;
}

function pageTaskFillAndRead(value) {
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findStartPostButton() {
    const exact = ['start a post', 'create a post', 'commencer un post', 'commencer une publication'];
    const list = Array.from(document.querySelectorAll('button,[role="button"]'));
    for (let i = 0; i < list.length; i += 1) {
      const el = list[i];
      if (el.disabled || !visible(el)) continue;
      if (exact.indexOf(norm(el.textContent)) >= 0) return el;
    }
    for (let i = 0; i < list.length; i += 1) {
      const el = list[i];
      if (el.disabled || !visible(el)) continue;
      const t = norm(el.textContent);
      const a = norm(el.getAttribute('aria-label'));
      if (t.indexOf('start a post') >= 0 || t.indexOf('create a post') >= 0 || a.indexOf('start a post') >= 0 || a.indexOf('create a post') >= 0) return el;
    }
    return null;
  }

  function collectShadowHosts() {
    return Array.from(document.querySelectorAll('*')).filter((el) => !!el.shadowRoot);
  }

  function findComposerRoot() {
    const hosts = collectShadowHosts();
    for (let i = 0; i < hosts.length; i += 1) {
      const host = hosts[i];
      const root = host.shadowRoot;
      const dialogs = root.querySelectorAll('[role="dialog"]');
      for (let j = 0; j < dialogs.length; j += 1) {
        if (visible(dialogs[j])) return { host: host, root: root };
      }
    }
    return null;
  }

  function findQuillInRoot(root) {
    const direct = root.querySelector('.editor-content.ql-container, .ql-container, .editor-content');
    if (direct && direct.__quill) return { quill: direct.__quill, container: direct, route: 'root.query.__quill' };
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i];
      if (el.__quill) return { quill: el.__quill, container: el, route: 'root.star.__quill' };
    }
    return null;
  }

  return (async function () {
    let composer = findComposerRoot();
    let clickedStartPost = false;
    let startPostText = null;

    if (!composer) {
      const startBtn = findStartPostButton();
      if (startBtn) {
        clickedStartPost = true;
        startPostText = (startBtn.textContent || '').trim();
        startBtn.click();
      }
    }

    const waitRootUntil = Date.now() + 7000;
    while (!composer && Date.now() < waitRootUntil) {
      await sleep(80);
      composer = findComposerRoot();
    }

    if (!composer) {
      return {
        ok: false,
        reason: 'COMPOSER_ROOT_NOT_FOUND',
        href: location.href,
        debug: { clickedStartPost: clickedStartPost, startPostText: startPostText, shadowHosts: collectShadowHosts().length },
      };
    }

    const pauses = [50, 100, 150, 200, 250, 300, 350, 400];
    let found = findQuillInRoot(composer.root);
    let attempts = 1;
    for (let i = 0; !found && i < pauses.length; i += 1) {
      await sleep(pauses[i]);
      attempts += 1;
      found = findQuillInRoot(composer.root);
    }

    if (!found) {
      const root = composer.root;
      return {
        ok: false,
        reason: 'EDITOR_NOT_FOUND',
        href: location.href,
        debug: {
          clickedStartPost: clickedStartPost,
          startPostText: startPostText,
          attempts: attempts,
          editorCount: root.querySelectorAll('.ql-editor, [contenteditable="true"][role="textbox"]').length,
          containerCount: root.querySelectorAll('.ql-container, .editor-content').length,
        },
      };
    }

    found.quill.focus();
    found.quill.setText(value, 'api');
    const current = String(found.quill.getText ? found.quill.getText() : '').replace(/\n+$/g, '');

    return {
      ok: true,
      href: location.href,
      route: found.route,
      attempts: attempts,
      editorClass: found.container.className,
      value: current,
    };
  })();
}

function pageTaskRead() {
  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const hosts = Array.from(document.querySelectorAll('*')).filter((el) => !!el.shadowRoot);
  for (let i = 0; i < hosts.length; i += 1) {
    const root = hosts[i].shadowRoot;
    const dialogs = root.querySelectorAll('[role="dialog"]');
    let hasVisibleDialog = false;
    for (let j = 0; j < dialogs.length; j += 1) {
      if (visible(dialogs[j])) { hasVisibleDialog = true; break; }
    }
    if (!hasVisibleDialog) continue;

    const direct = root.querySelector('.editor-content.ql-container, .ql-container, .editor-content');
    if (direct && direct.__quill) {
      const value = String(direct.__quill.getText ? direct.__quill.getText() : '').replace(/\n+$/g, '');
      return { ok: true, href: location.href, route: 'root.query.__quill', editorClass: direct.className, value: value };
    }

    const all = root.querySelectorAll('*');
    for (let k = 0; k < all.length; k += 1) {
      const el = all[k];
      if (el.__quill) {
        const value = String(el.__quill.getText ? el.__quill.getText() : '').replace(/\n+$/g, '');
        return { ok: true, href: location.href, route: 'root.star.__quill', editorClass: el.className, value: value };
      }
    }
  }

  return { ok: false, reason: 'EDITOR_NOT_FOUND', href: location.href };
}

function pageTaskSnapshot() {
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
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += '#' + cur.id;
        parts.unshift(part);
        break;
      }
      if (cur.classList.length) part += '.' + Array.from(cur.classList).slice(0, 2).join('.');
      parts.unshift(part);
      const root = cur.getRootNode();
      cur = root instanceof ShadowRoot ? root.host : cur.parentElement;
    }
    return parts.join(' > ');
  }

  function walk(root, hostLabel, out) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = tw.nextNode())) {
      out.push({ el: node, hostLabel: hostLabel });
      if (node.shadowRoot) {
        const label = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className ? '.' + String(node.className).split(/\s+/)[0] : '');
        walk(node.shadowRoot, label, out);
      }
    }
  }

  const allNodes = [];
  walk(document, 'document', allNodes);

  const selector = 'input, textarea, select, button, a, [role="button"], [role="textbox"], [contenteditable="true"], .ql-editor, .ql-container';
  const elements = [];
  for (let i = 0; i < allNodes.length; i += 1) {
    const item = allNodes[i];
    const el = item.el;
    if (!(el instanceof Element)) continue;
    if (!el.matches(selector)) continue;
    if (!visible(el)) continue;
    elements.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      contenteditable: el.getAttribute('contenteditable') || undefined,
      className: el.className || undefined,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
      selector: cssPath(el),
      shadowHost: item.hostLabel,
      hasQuill: !!el.__quill,
    });
    if (elements.length >= 240) break;
  }

  return {
    ok: true,
    frameHref: location.href,
    documentTitle: document.title,
    elementsCount: elements.length,
    elements: elements,
  };
}

fillBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const value = valueInput.value;
    const res = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: pageTaskFillAndRead,
      args: [value],
    });
    log({ step: 'fill', result: res[0] ? res[0].result : null });
  } catch (err) {
    log({ step: 'fill', error: err.message });
  }
});

checkBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const res = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: pageTaskRead,
    });
    log({ step: 'check', result: res[0] ? res[0].result : null });
  } catch (err) {
    log({ step: 'check', error: err.message });
  }
});

snapshotBtn.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId();
    const res = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: pageTaskSnapshot,
    });
    log({ step: 'snapshot', result: res[0] ? res[0].result : null });
  } catch (err) {
    log({ step: 'snapshot', error: err.message });
  }
});
