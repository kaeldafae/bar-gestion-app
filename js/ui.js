// Ventanas flotantes (hoja inferior en el móvil, ventana centrada en el ordenador), avisos y confirmaciones.
import { h, icon } from './util.js';

const root = () => document.getElementById('overlays');

// Pila de ventanas abiertas: el botón atrás del móvil cierra solo la de arriba.
const stack = [];
let ownBacks = 0; // «atrás» que hace la propia app al cerrar una ventana: no deben cerrar otra
window.addEventListener('popstate', () => {
  if (ownBacks > 0) { ownBacks -= 1; return; }
  const top = stack[stack.length - 1];
  if (top) top(undefined, true);
});

/**
 * Abre una ventana. build(close) devuelve el contenido. Devuelve una promesa con el valor de close().
 * Se cierra con Escape, tocando fuera o con el botón atrás del móvil.
 */
export function sheet(build, { wide = false, title = null } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    let done = false;
    const close = (value, fromBack = false) => {
      if (done) return;
      done = true;
      stack.splice(stack.indexOf(close), 1);
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (!fromBack) { ownBacks += 1; history.back(); } // quita la entrada que se añadió al abrir
      if (previous && previous.focus) previous.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape' && stack[stack.length - 1] === close) close(undefined); };
    const box = h('section', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) close(undefined); } }, box);
    if (title !== null) {
      box.append(h('div', { class: 'sheet-head' }, h('h2', {}, title),
        h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close(undefined) }, icon('close'))));
    }
    box.append(build(close));
    root().append(backdrop);
    document.addEventListener('keydown', onKey);
    history.pushState({ sheet: stack.length + 1 }, '');
    stack.push(close);
    const focusable = box.querySelector('[autofocus]');
    setTimeout(() => (focusable || box).focus({ preventScroll: true }), 30);
  });
}

export function toast(message, kind = 'ok', ms = 3500) {
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  const box = document.getElementById('toasts');
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.classList.add('toast-hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function errorToast(err) {
  toast(friendly(err), 'error', 6000);
}

/** Mensajes de error comprensibles. */
export function friendly(err) {
  const msg = err && (err.message || err.error_description || err.msg) ? (err.message || err.error_description || err.msg) : String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sin conexión. Revisa internet y vuelve a intentarlo.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'La sesión ha caducado. Vuelve a entrar.';
  return msg;
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
  return sheet((close) => h('div', { class: 'stack' },
    h('h2', {}, title),
    message ? h('p', { class: 'muted' }, message) : null,
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancelar'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmText)),
  )).then((v) => v === true);
}

/** Pide un texto. Devuelve el texto o null. */
export function askText({ title, label, value = '', placeholder = '', confirmText = 'Aceptar', required = true, max = 200 }) {
  return sheet((close) => {
    const input = h('input', { type: 'text', value, placeholder, maxlength: max, autofocus: true, id: 'ask' });
    const error = h('p', { class: 'field-error' });
    const submit = (e) => {
      e?.preventDefault();
      const v = input.value.trim();
      if (required && !v) { error.textContent = 'Este campo es obligatorio.'; input.focus(); return; }
      close(v);
    };
    return h('form', { class: 'stack', onsubmit: submit },
      h('h2', {}, title),
      h('div', { class: 'field' }, h('label', { for: 'ask' }, label), input),
      error,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn primary' }, confirmText)));
  }).then((v) => (typeof v === 'string' ? v : null));
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('busy', busy);
}

export const empty = (text) => h('p', { class: 'empty' }, text);
export const skeleton = (n = 3) => h('div', { class: 'list' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
