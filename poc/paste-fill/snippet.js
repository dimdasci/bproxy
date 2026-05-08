window.pasteFill = function (selector, value) {
  const el = document.querySelector(selector);
  if (!el) { console.error('not found:', selector); return false; }
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    console.error('not an input/textarea:', el);
    return false;
  }
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: value, bubbles: true, cancelable: true }));
  el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: value, bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`[poc] filled ${selector} with "${value}". Verify framework state by typing an extra character.`);
  return true;
};
