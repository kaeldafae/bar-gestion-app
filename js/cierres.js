// Cierres de caja: lista, ficha completa (ventana flotante), origen, historial y papelera.
import { db, check } from './supa.js';
import { h, clear, eur, eurSigned, fmtDate, fmtDayLong, fmtTime, fmtDateTime, icon } from './util.js';
import { sheet, toast, errorToast, askText, confirmDialog, setBusy, empty } from './ui.js';

const LIST_COLUMNS = 'id, device_id, caja_nombre, numero, fecha, cerrado_en, ventas_n, invitaciones_n, vendido_cents, anulado_cents, '
  + 'esperado_cents, contado_cents, diferencia_cents, origen, recibido_en, eliminado_en, eliminado_motivo';

export async function fetchCierres(from, to, { deleted = false } = {}) {
  let q = db.from('cierres').select(LIST_COLUMNS).gte('fecha', from).lte('fecha', to)
    .order('fecha', { ascending: false }).order('cerrado_en', { ascending: false }).limit(1000);
  q = deleted ? q.not('eliminado_en', 'is', null) : q.is('eliminado_en', null);
  return check(await q);
}

export function diffChip(cents) {
  if (!cents) return h('span', { class: 'chip chip-ok' }, 'Cuadra');
  return h('span', { class: 'chip chip-bad' }, cents < 0 ? `Falta ${eur(-cents)}` : `Sobra ${eur(cents)}`);
}

export function originChip(c, onOpen) {
  const label = c.origen === 'caja' ? 'Caja' : 'Archivo';
  return h('button', {
    class: `chip chip-${c.origen}`, type: 'button', title: 'Ver el origen de esta cifra',
    onclick: (e) => { e.stopPropagation(); onOpen ? onOpen() : openOrigin(c); },
  }, label);
}

export function cierreCard(c, ctx, onChange) {
  return h('button', { class: `card${c.eliminado_en ? ' deleted' : ''}`, onclick: () => openCierre(c.id, ctx, onChange) },
    h('div', { class: 'grow stack-sm' },
      h('div', { class: 'title' }, `${c.caja_nombre} · turno ${c.numero}`),
      h('div', { class: 'sub' }, `Cerrado a las ${fmtTime(c.cerrado_en)} · ${c.ventas_n} ${c.ventas_n === 1 ? 'venta' : 'ventas'}`),
      h('div', { class: 'chips' }, originChip(c), diffChip(c.diferencia_cents),
        c.eliminado_en ? h('span', { class: 'chip' }, 'En la papelera') : null)),
    h('div', { class: 'amount' }, eur(c.vendido_cents)));
}

/** Lista agrupada por día con el total de cada día (suma de todas las cajas). */
export function cierresByDay(list, ctx, onChange) {
  if (!list.length) return empty('No hay cierres en estas fechas.');
  const days = new Map();
  for (const c of list) {
    if (!days.has(c.fecha)) days.set(c.fecha, []);
    days.get(c.fecha).push(c);
  }
  return h('div', {}, [...days].map(([day, items]) => h('div', {},
    h('div', { class: 'day-head' }, h('span', {}, cap(fmtDayLong(day))),
      h('span', { class: 'muted' }, `${eur(items.reduce((s, c) => s + c.vendido_cents, 0))}${items.length > 1 ? ` · ${items.length} cierres` : ''}`)),
    h('div', { class: 'list' }, items.map((c) => cierreCard(c, ctx, onChange))))));
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// --- Origen ------------------------------------------------------------------------------

export async function openOrigin(c) {
  const full = c.payload ? c : check(await db.from('cierres').select('id, caja_nombre, device_id, numero, fecha, origen, recibido_en, subido_por, app_version, payload').eq('id', c.id).single());
  const user = (await db.auth.getUser()).data.user;
  await sheet(() => h('div', { class: 'stack' },
    h('p', {}, full.origen === 'caja'
      ? ['Enviado automáticamente por la caja ', h('strong', {}, full.caja_nombre), ` al cerrar el turno ${full.numero}.`]
      : ['Subido a mano desde el archivo del cierre ', h('strong', {}, `(${full.caja_nombre}, turno ${full.numero})`),
        full.subido_por && user && full.subido_por === user.id ? ' por ti.' : '.']),
    h('table', { class: 'table' }, h('tbody', {},
      tr('Recibido', fmtDateTime(full.recibido_en)),
      tr('Día del turno', fmtDate(full.fecha)),
      tr('Aparato', `${full.caja_nombre} (${full.device_id.slice(0, 8)}…)`),
      tr('Versión de la caja', full.app_version || '—'),
      tr('Identificador', full.id))),
    h('p', { class: 'muted small' }, 'Lo que llega de la caja no se puede modificar. El archivo original se conserva tal cual.'),
    h('button', { class: 'btn', onclick: () => downloadJson(full.payload, `CPBAR_cierre_${full.fecha}_${full.caja_nombre}_n${full.numero}.json`) },
      'Descargar el original')), { title: 'Origen' });
}

function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name.replace(/[^\w.\-]+/g, '_') });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// --- Ficha del cierre ----------------------------------------------------------------------

const tr = (label, value, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'num' }, value));

export async function openCierre(id, ctx, onChange) {
  const c = check(await db.from('cierres').select('*').eq('id', id).single());
  const p = c.payload;
  const owner = ctx.rol === 'propietario';
  let changed = false;

  await sheet((close) => {
    const body = h('div', { class: 'stack' });
    const ventas = p.sales.filter((s) => s.kind === 'venta');
    const invit = p.sales.filter((s) => s.kind === 'invitacion');
    const media = ventas.length ? Math.round(c.vendido_cents / ventas.length) : 0;

    body.append(
      h('div', { class: 'sheet-head' },
        h('div', { class: 'stack-sm' }, h('h2', {}, `${c.caja_nombre} · turno ${c.numero}`),
          h('div', { class: 'muted small' }, `${cap(fmtDayLong(c.fecha))} · ${fmtTime(p.shift.opened_at)} a ${fmtTime(p.shift.closed_at)}`),
          h('div', { class: 'chips' }, originChip(c, () => openOrigin(c)), diffChip(c.diferencia_cents),
            c.eliminado_en ? h('span', { class: 'chip' }, `En la papelera: ${c.eliminado_motivo}`) : null)),
        h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
      h('div', { class: 'kpis' },
        kpi('Vendido', eur(c.vendido_cents), `${ventas.length} ${ventas.length === 1 ? 'venta' : 'ventas'}`),
        kpi('Ticket medio', eur(media)),
        kpi('Anulado', eur(c.anulado_cents), `${p.voids.length} ${p.voids.length === 1 ? 'anulación' : 'anulaciones'}`),
        kpi('Invitaciones', String(invit.length))),
      h('div', { class: 'panel' }, h('h3', {}, 'Arqueo de caja'), h('table', { class: 'table' }, h('tbody', {},
        tr('Fondo inicial', eur(c.fondo_cents)),
        tr('Ventas en efectivo', `+ ${eur(p.cash.cash_sales_cents)}`),
        tr('Anulaciones', `− ${eur(p.cash.voids_cents)}`),
        tr('Entradas de caja', `+ ${eur(c.entradas_cents)}`),
        tr('Salidas de caja', `− ${eur(c.salidas_cents)}`),
        tr('Efectivo esperado', eur(c.esperado_cents), 'total'),
        tr('Efectivo contado', eur(c.contado_cents), 'total'),
        h('tr', { class: 'total' }, h('td', {}, 'Diferencia'),
          h('td', { class: `num ${c.diferencia_cents < 0 ? 'neg' : c.diferencia_cents > 0 ? 'pos' : ''}` }, eurSigned(c.diferencia_cents))),
        tr('Fondo que se dejó', eur(p.cash.next_float_cents))))),
      h('div', { class: 'panel' }, h('h3', {}, 'Productos vendidos'), p.products.length
        ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Producto'), h('th', { class: 'num' }, 'Uds.'), h('th', { class: 'num' }, 'Importe'))),
          h('tbody', {}, p.products.map((x) => h('tr', {}, h('td', {}, x.name, x.invited_qty ? h('div', { class: 'muted small' }, `+ ${x.invited_qty} invitad${x.invited_qty === 1 ? 'a' : 'as'}`) : null),
            h('td', { class: 'num' }, String(x.qty)), h('td', { class: 'num' }, eur(x.revenue_cents))))))
        : h('p', { class: 'muted' }, 'Sin ventas en este turno.')),
      details(`Ventas una a una (${p.sales.length})`, p.sales.map((s) => h('div', { class: 'card', style: 'cursor:default' },
        h('div', { class: 'grow stack-sm' },
          h('div', { class: 'title' }, `${fmtTime(s.created_at)} · ${s.kind === 'venta' ? 'Efectivo' : 'Invitación'}${s.note ? ` · ${s.note}` : ''}`),
          s.lines.map((l) => h('div', { class: 'sub' }, `${l.qty} × ${l.name} a ${eur(l.unit_price_cents)}${l.voided_qty ? ` (anulado ${l.voided_qty})` : ''}`))),
        h('div', { class: 'amount' }, eur(s.net_cents))))),
      p.voids.length ? details(`Anulaciones (${p.voids.length})`, h('table', { class: 'table' }, h('tbody', {},
        p.voids.map((v) => h('tr', {}, h('td', {}, `${fmtTime(v.created_at)} · ${v.qty} × ${v.name}`, h('div', { class: 'muted small' }, v.reason)), h('td', { class: 'num' }, eur(v.amount_cents))))))) : null,
      p.cash_movements.length ? details(`Entradas y salidas de caja (${p.cash_movements.length})`, h('table', { class: 'table' }, h('tbody', {},
        p.cash_movements.map((m) => h('tr', {}, h('td', {}, `${fmtTime(m.created_at)} · ${m.concept}`),
          h('td', { class: `num ${m.direction === 'salida' ? 'neg' : 'pos'}` }, `${m.direction === 'salida' ? '−' : '+'} ${eur(m.amount_cents)}`)))))) : null,
    );

    if (owner) {
      const hist = h('div', { class: 'stack-sm' }, h('p', { class: 'muted small' }, 'Cargando…'));
      body.append(details('Historial de cambios', hist, (open) => { if (open) loadHistory(hist, c.id); }));
      const trashBtn = h('button', { class: c.eliminado_en ? 'btn' : 'btn ghost', onclick: async () => {
        try {
          if (c.eliminado_en) {
            setBusy(trashBtn, true);
            check(await db.rpc('recuperar_cierre', { p_cierre: c.id }));
            toast('Cierre recuperado.');
          } else {
            const motivo = await askText({ title: 'Mandar a la papelera', label: 'Motivo (por ejemplo: turno de prueba)', confirmText: 'Mandar a la papelera' });
            if (!motivo) return;
            setBusy(trashBtn, true);
            check(await db.rpc('papelera_cierre', { p_cierre: c.id, p_motivo: motivo }));
            toast('Cierre en la papelera. Puedes recuperarlo cuando quieras.');
          }
          changed = true;
          close();
        } catch (err) { setBusy(trashBtn, false); errorToast(err); }
      } }, icon('trash'), c.eliminado_en ? 'Recuperar de la papelera' : 'Mandar a la papelera');
      body.append(h('div', { class: 'row end' }, trashBtn));
    }
    return body;
  }, { wide: true });
  if (changed && onChange) onChange();
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

function details(summary, content, onToggle) {
  const d = h('details', { class: 'panel' }, h('summary', { class: 'strong', style: 'cursor:pointer' }, summary), h('div', { style: 'margin-top:10px' }, content));
  if (onToggle) d.addEventListener('toggle', () => onToggle(d.open));
  return d;
}

const ACCIONES = { insert: 'Recibido', update: 'Cambiado', delete: 'Borrado' };

async function loadHistory(box, id) {
  try {
    const rows = check(await db.from('historial').select('accion, antes, despues, en').eq('tabla', 'cierres').eq('registro_id', id).order('en'));
    clear(box);
    if (!rows.length) { box.append(h('p', { class: 'muted small' }, 'Sin cambios.')); return; }
    for (const r of rows) {
      let text = ACCIONES[r.accion] || r.accion;
      if (r.accion === 'update' && r.despues && r.antes) {
        if (r.despues.eliminado_en && !r.antes.eliminado_en) text = `Mandado a la papelera: ${r.despues.eliminado_motivo}`;
        else if (!r.despues.eliminado_en && r.antes.eliminado_en) text = 'Recuperado de la papelera';
      }
      box.append(h('div', { class: 'row between small' }, h('span', {}, text), h('span', { class: 'muted' }, fmtDateTime(r.en))));
    }
  } catch (err) { clear(box).append(h('p', { class: 'field-error' }, err.message)); }
}
