// Ajustes: cajas conectadas (códigos de conexión), conflictos, tema y cuenta.
import { db, check, FUNCTIONS_URL } from './supa.js';
import { h, clear, eur, fmtDate, fmtDateTime, icon } from './util.js';
import { sheet, toast, errorToast, confirmDialog, askText, setBusy, empty } from './ui.js';
import { CONFIG } from '../config.js';

const ENDPOINT = `${FUNCTIONS_URL}/recibir-cierre`;

/** Código que se pega en la caja: CPBAR1: + base64url de {"u": dirección, "t": llave}. */
function connectionCode(token) {
  const json = JSON.stringify({ u: ENDPOINT, t: token });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `CPBAR1:${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export async function render(main, ctx) {
  const owner = ctx.rol === 'propietario';
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Ajustes')));

  // --- Cajas ---
  const cajasBox = h('div', { class: 'list' });
  main.append(h('div', { class: 'section-title' }, h('h2', {}, 'Cajas'),
    owner ? h('button', { class: 'btn small primary', onclick: () => addCaja(loadCajas) }, icon('plus'), 'Añadir caja') : null),
  h('p', { class: 'muted small', style: 'margin:0 4px 10px' }, 'Cada caja (la tablet, el PC…) envía sus cierres con su propio código. El código solo sirve para entregar cierres.'),
  cajasBox);

  async function loadCajas() {
    try {
      const cajas = check(await db.from('cajas').select('id, nombre, device_id, creada_en, revocada_en, ultimo_cierre_en').order('creada_en'));
      clear(cajasBox);
      if (!cajas.length) { cajasBox.append(empty('Todavía no hay cajas. Pulsa «Añadir caja».')); return; }
      for (const c of cajas) cajasBox.append(cajaCard(c, owner, loadCajas));
    } catch (err) { clear(cajasBox).append(h('div', { class: 'alert' }, err.message)); }
  }
  await loadCajas();

  // --- Conflictos ---
  if (owner) {
    const conf = check(await db.from('cierres_conflictos').select('id, cierre_id, payload, origen, recibido_en').order('recibido_en', { ascending: false }).limit(50));
    if (conf.length) {
      main.append(h('div', { class: 'section-title' }, h('h2', {}, 'Conflictos')),
        h('p', { class: 'muted small', style: 'margin:0 4px 10px' }, 'Cierres que llegaron otra vez con datos distintos (por ejemplo, tras restaurar una copia de la caja). Se cuenta el primero que llegó; estos se guardan para que puedas compararlos.'),
        h('div', { class: 'list' }, conf.map((x) => h('div', { class: 'card', style: 'cursor:default' },
          h('div', { class: 'grow stack-sm' }, h('div', { class: 'title' }, `${x.payload.device.name} · turno ${x.payload.shift.number} (${fmtDate(x.payload.shift.business_date)})`),
            h('div', { class: 'sub' }, `Llegó ${fmtDateTime(x.recibido_en)} con ${eur(x.payload.totals.net_cents)} vendidos y descuadre ${eur(x.payload.cash.difference_cents)}.`)),
        ))));
    }
  }

  // --- Apariencia y cuenta ---
  const theme = () => document.documentElement.dataset.theme;
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => clear(seg).append(...[['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) =>
    h('button', { class: theme() === k ? 'on' : '', onclick: () => { ctx.applyTheme(k); drawSeg(); } }, l)));
  drawSeg();
  main.append(
    h('div', { class: 'section-title' }, h('h2', {}, 'Apariencia')), h('div', { class: 'panel' }, seg),
    h('div', { class: 'section-title' }, h('h2', {}, 'Tu cuenta')),
    h('div', { class: 'panel stack' },
      h('div', {}, h('div', { class: 'strong' }, ctx.user.email), h('div', { class: 'muted small' }, owner ? 'Propietario' : 'Empleado')),
      h('button', { class: 'btn', onclick: () => ctx.logout() }, 'Cerrar sesión')),
    h('p', { class: 'muted small', style: 'margin:20px 4px' }, `Gestión del bar · CP BAR · ${CONFIG.version}`));
}

function cajaCard(c, owner, reload) {
  const state = c.revocada_en
    ? h('span', { class: 'chip chip-bad' }, 'Código anulado')
    : c.device_id ? h('span', { class: 'chip chip-ok' }, 'Conectada') : h('span', { class: 'chip' }, 'Esperando el primer cierre');
  return h('div', { class: 'card', style: 'cursor:default;flex-wrap:wrap' },
    h('div', { class: 'grow stack-sm' }, h('div', { class: 'title' }, c.nombre),
      h('div', { class: 'sub' }, c.ultimo_cierre_en ? `Último cierre: ${fmtDateTime(c.ultimo_cierre_en)}` : `Creada el ${fmtDate(c.creada_en)}`),
      h('div', { class: 'chips' }, state)),
    owner ? h('div', { class: 'row wrap' },
      h('button', { class: 'btn small', onclick: () => newKey(c, reload) }, c.revocada_en ? 'Volver a activar' : 'Código nuevo'),
      h('button', { class: 'btn small ghost', onclick: async () => {
        const name = await askText({ title: 'Cambiar nombre', label: 'Nombre de la caja', value: c.nombre, max: 40 });
        if (!name || name === c.nombre) return;
        try { check(await db.rpc('renombrar_caja', { p_caja: c.id, p_nombre: name })); toast('Nombre cambiado.'); reload(); } catch (err) { errorToast(err); }
      } }, 'Renombrar'),
      !c.revocada_en ? h('button', { class: 'btn small ghost', onclick: async () => {
        const ok = await confirmDialog({ title: `¿Anular el código de ${c.nombre}?`, message: 'La caja dejará de poder enviar cierres hasta que le pongas un código nuevo. Los cierres ya recibidos se conservan.', confirmText: 'Anular código', danger: true });
        if (!ok) return;
        try { check(await db.rpc('revocar_caja', { p_caja: c.id })); toast('Código anulado.'); reload(); } catch (err) { errorToast(err); }
      } }, 'Anular código') : null) : null);
}

async function addCaja(reload) {
  const name = await askText({ title: 'Añadir caja', label: 'Nombre (por ejemplo: Tablet, PC)', max: 40, confirmText: 'Crear código' });
  if (!name) return;
  try {
    const r = check(await db.rpc('crear_caja', { p_nombre: name }));
    reload();
    await showCode(name, r.token);
  } catch (err) { errorToast(err); }
}

async function newKey(c, reload) {
  const ok = await confirmDialog({ title: `Código nuevo para ${c.nombre}`, message: 'El código anterior dejará de funcionar. Tendrás que pegar el nuevo en esa caja.', confirmText: 'Crear código nuevo' });
  if (!ok) return;
  try {
    const r = check(await db.rpc('nueva_llave_caja', { p_caja: c.id }));
    reload();
    await showCode(c.nombre, r.token);
  } catch (err) { errorToast(err); }
}

/** Muestra el código una sola vez (no se guarda en ningún sitio legible). */
function showCode(name, token) {
  const code = connectionCode(token);
  return sheet((close) => {
    const copyBtn = h('button', { class: 'btn primary block', onclick: async () => {
      try { await navigator.clipboard.writeText(code); toast('Código copiado.'); copyBtn.textContent = '✓ Copiado'; } catch { toast('Mantén pulsado el código para copiarlo.', 'error'); }
    } }, icon('copy'), 'Copiar código');
    return h('div', { class: 'stack' },
      h('p', {}, 'Pega este código en la caja ', h('strong', {}, name), ':'),
      h('ol', { class: 'steps' },
        h('li', {}, 'En la caja: Productos → Ajustes → Gestión del bar.'),
        h('li', {}, 'Pulsa «Conectar con Gestión», pon el nombre y pega el código.'),
        h('li', {}, 'Truco: abre esta app de Gestión en la propia tablet o PC de la caja para copiar y pegar sin escribir.')),
      h('div', { class: 'code-box' }, code),
      copyBtn,
      h('p', { class: 'muted small' }, 'Por seguridad, este código solo se muestra ahora. Si lo pierdes, crea uno nuevo.'),
      h('button', { class: 'btn ghost block', onclick: () => close() }, 'Hecho'));
  }, { title: `Código de ${name}` });
}
