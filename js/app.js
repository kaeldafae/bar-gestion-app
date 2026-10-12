// Arranque: sesión, navegación, tema y avisos en tiempo real.
import { db, me, check, startRealtime, stopRealtime, onNovedad } from './supa.js';
import { h, clear, icon, eur } from './util.js';
import { toast, friendly, setBusy } from './ui.js';
import * as inicio from './inicio.js';
import * as ventas from './ventas.js';
import * as gastos from './gastos.js';
import * as ajustes from './ajustes.js';

const VIEWS = {
  inicio: { label: 'Inicio', mod: inicio },
  ventas: { label: 'Ventas', mod: ventas },
  gastos: { label: 'Gastos', mod: gastos },
  ajustes: { label: 'Ajustes', mod: ajustes },
};

export const ctx = { user: null, rol: null, view: 'inicio', go, applyTheme, logout };
let leave = null;
let renderToken = 0;

// --- Tema -------------------------------------------------------------------------------
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('gestion.tema', theme); } catch { /* sin almacenamiento */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121418' : '#F4F2EE');
}

// --- Acceso ------------------------------------------------------------------------------
function loginScreen(message = '') {
  stopRealtime();
  const app = clear(document.getElementById('app'));
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', inputmode: 'email', autofocus: true });
  const pass = h('input', { type: 'password', id: 'pass', autocomplete: 'current-password' });
  const error = h('p', { class: 'field-error' }, message);
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
  app.append(h('div', { class: 'login' }, h('form', {
    class: 'login-box panel',
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (!email.value || !pass.value) { error.textContent = 'Escribe tu correo y tu contraseña.'; return; }
      setBusy(btn, true);
      const { error: err } = await db.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      setBusy(btn, false);
      if (err) {
        error.textContent = /invalid/i.test(err.message) ? 'Correo o contraseña incorrectos.' : friendly(err);
        return;
      }
      boot();
    },
  },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'CP'), h('div', {}, h('div', {}, 'CP BAR'), h('div', { class: 'muted small' }, 'Gestión del bar'))),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Correo'), email),
    h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Contraseña'), pass),
    error, btn,
    h('p', { class: 'muted small' }, 'Solo pueden entrar las personas que des de alta.'))));
}

async function logout() {
  await stopRealtime();
  await db.auth.signOut();
  loginScreen();
}

// --- Estructura ---------------------------------------------------------------------------
function shell() {
  const app = clear(document.getElementById('app'));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Menú' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'CP'), 'Gestión'),
    Object.entries(VIEWS).map(([key, v]) => h('button', { class: 'tab', 'data-view': key, onclick: () => go(key) }, icon(key), v.label)));
  const live = h('span', { class: 'live', id: 'live', title: 'Conexión en tiempo real' }, 'En directo');
  const themeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Cambiar tema', onclick: () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    clear(themeBtn).append(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  } }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  const top = h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'CP'), 'Gestión'),
    h('div', { class: 'grow' }), live, themeBtn);
  app.append(h('div', { class: 'app' }, tabs, h('div', {}, top, h('main', { class: 'main', id: 'main' }))));
}

export async function go(view) {
  if (!VIEWS[view]) view = 'inicio';
  ctx.view = view;
  if (location.hash !== `#${view}`) history.replaceState(history.state, '', `#${view}`);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === view));
  if (leave) { try { leave(); } catch { /* nada */ } leave = null; }
  const main = clear(document.getElementById('main'));
  const token = ++renderToken;
  try {
    const cleanup = await VIEWS[view].mod.render(main, ctx);
    if (token !== renderToken) { if (typeof cleanup === 'function') cleanup(); return; }
    leave = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    main.append(h('div', { class: 'alert' }, friendly(err)), h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn', onclick: () => go(view) }, 'Reintentar')));
  }
}

async function boot() {
  let who;
  try { who = await me(); } catch (err) { return loginScreen(friendly(err)); }
  if (!who) return loginScreen();
  if (!who.rol) {
    await db.auth.signOut();
    return loginScreen('Tu usuario todavía no tiene acceso. Pídeselo al propietario.');
  }
  ctx.user = who.user;
  ctx.rol = who.rol;
  shell();
  startRealtime((on) => document.getElementById('live')?.classList.toggle('on', on));
  go((location.hash || '#inicio').slice(1));
}

// Cierre nuevo: aviso aunque se esté en otra pantalla.
onNovedad(async (n) => {
  if (n.tipo === 'conflicto') { toast('Ha llegado un cierre repetido con otros datos. Revísalo en Ajustes → Conflictos.', 'error', 8000); return; }
  if (n.tipo !== 'cierre' || !n.ref) return;
  try {
    const c = check(await db.from('cierres').select('caja_nombre, vendido_cents, diferencia_cents, recibido_en, eliminado_en').eq('id', n.ref).maybeSingle());
    if (c && !c.eliminado_en && Date.now() - Date.parse(c.recibido_en) < 60_000) {
      toast(`Cierre nuevo de ${c.caja_nombre}: ${eur(c.vendido_cents)} vendidos${c.diferencia_cents ? ` · descuadre ${eur(c.diferencia_cents)}` : ''}`, 'ok', 6000);
    }
  } catch { /* sin importancia */ }
});

db.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') loginScreen(); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (ctx.user && v && v !== ctx.view && VIEWS[v]) go(v); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(friendly(e.reason), 'error', 6000); });

applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
