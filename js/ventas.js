// Ventas: cierres recibidos (por día, de todas las cajas) y ranking de productos.
import { db, check, onNovedad, uploadCierreFiles } from './supa.js';
import { h, clear, eur, eurSigned, period, fmtDate, icon } from './util.js';
import { sheet, toast, errorToast, empty, skeleton } from './ui.js';
import { fetchCierres, cierresByDay } from './cierres.js';

const PERIODS = [['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año'], ['fechas', 'Fechas…']];
const state = { tab: 'cierres', period: 'semana', from: null, to: null, deleted: false, sortBy: 'importe' };

export async function render(main, ctx) {
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Ventas'),
    h('button', { class: 'btn', onclick: () => upload(reload) }, icon('upload'), 'Subir archivo de cierre'));
  const periodBar = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Periodo' });
  const tabBar = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Vista' });
  const kpis = h('div', { class: 'kpis' });
  const body = h('div', {});
  main.append(head, periodBar, h('div', { style: 'height:12px' }), kpis, h('div', { style: 'height:16px' }), tabBar, body);

  function range() {
    if (state.period === 'fechas' && state.from) return { from: state.from, to: state.to, label: `${fmtDate(state.from)} – ${fmtDate(state.to)}` };
    return period(state.period === 'fechas' ? 'semana' : state.period);
  }

  function drawBars() {
    clear(periodBar).append(...PERIODS.map(([k, label]) => h('button', {
      class: state.period === k ? 'on' : '', role: 'tab', 'aria-selected': String(state.period === k),
      onclick: async () => {
        if (k === 'fechas') { if (!(await pickDates())) return; }
        state.period = k;
        reload();
      },
    }, k === 'fechas' && state.period === 'fechas' && state.from ? range().label : label)));
    clear(tabBar).append(
      ...[['cierres', 'Cierres'], ['productos', 'Productos más vendidos'], ['papelera', 'Papelera']]
        .filter(([k]) => k !== 'papelera' || ctx.rol === 'propietario')
        .map(([k, label]) => h('button', { class: state.tab === k ? 'on' : '', role: 'tab', onclick: () => { state.tab = k; reload(); } }, label)));
  }

  let loading = 0;
  async function reload() {
    const token = ++loading;
    drawBars();
    const r = range();
    clear(body).append(h('div', { style: 'height:12px' }), skeleton(3));
    try {
      const list = await fetchCierres(r.from, r.to);
      if (token !== loading) return;
      drawKpis(kpis, list);
      clear(body).append(h('div', { style: 'height:4px' }));
      if (state.tab === 'cierres') body.append(cierresByDay(list, ctx, reload));
      else if (state.tab === 'papelera') body.append(h('p', { class: 'muted small', style: 'margin:12px 4px' }, 'Cierres que se han mandado a la papelera. No cuentan en las cifras. Ábrelos para recuperarlos.'),
        cierresByDay(await fetchCierres(r.from, r.to, { deleted: true }), ctx, reload));
      else body.append(await ranking(r));
    } catch (err) {
      if (token !== loading) return;
      clear(body).append(h('div', { class: 'alert' }, err.message));
    }
  }

  async function pickDates() {
    const r = range();
    const v = await sheet((close) => {
      const from = h('input', { type: 'date', value: r.from, id: 'd-from' });
      const to = h('input', { type: 'date', value: r.to, id: 'd-to' });
      const error = h('p', { class: 'field-error' });
      return h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'd-from' }, 'Desde'), from),
        h('div', { class: 'field' }, h('label', { for: 'd-to' }, 'Hasta'), to), error,
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'),
          h('button', { class: 'btn primary', onclick: () => {
            if (!from.value || !to.value) { error.textContent = 'Elige las dos fechas.'; return; }
            if (from.value > to.value) { error.textContent = 'La fecha inicial es posterior a la final.'; return; }
            close({ from: from.value, to: to.value });
          } }, 'Ver')));
    }, { title: 'Elegir fechas' });
    if (!v) return false;
    Object.assign(state, v);
    return true;
  }

  async function ranking(r) {
    const rows = check(await db.rpc('ranking_productos', { p_desde: r.from, p_hasta: r.to }));
    if (!rows.length) return empty('No hay ventas en estas fechas.');
    const key = state.sortBy === 'importe' ? 'importe_cents' : 'unidades';
    rows.sort((a, b) => b[key] - a[key] || a.nombre.localeCompare(b.nombre));
    const max = Math.max(...rows.map((x) => x[key])) || 1;
    const total = rows.reduce((s, x) => s + x.importe_cents, 0);
    return h('div', { class: 'stack', style: 'margin-top:12px' },
      h('div', { class: 'row between wrap' }, h('span', { class: 'muted small' }, `${rows.length} productos · ${eur(total)}`),
        h('div', { class: 'seg' }, [['importe', 'Por importe'], ['unidades', 'Por unidades']].map(([k, l]) =>
          h('button', { class: state.sortBy === k ? 'on' : '', onclick: () => { state.sortBy = k; reload(); } }, l)))),
      h('div', { class: 'panel bars' }, rows.slice(0, 50).map((x, i) => h('div', { class: 'bar-row' },
        h('span', { class: 'bar-name' }, h('span', { class: 'rank' }, String(i + 1)), x.nombre),
        h('span', { class: 'strong num' }, state.sortBy === 'importe' ? eur(x.importe_cents) : `${x.unidades} uds.`),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.max(2, (x[key] / max) * 100).toFixed(1)}%` })),
        h('span', { class: 'muted small', style: 'grid-column:1/-1' },
          `${x.unidades} uds. · ${eur(x.importe_cents)}${total ? ` · ${((x.importe_cents / total) * 100).toFixed(1)} %` : ''}${x.invitadas ? ` · ${x.invitadas} invitadas` : ''}`)))));
  }

  // Tiempo real: si llega un cierre (o se manda a la papelera), se actualiza solo.
  let timer = null;
  const off = onNovedad((n) => { if (n.tipo === 'cierre') { clearTimeout(timer); timer = setTimeout(reload, 400); } });
  await reload();
  return () => { off(); clearTimeout(timer); };
}

function drawKpis(box, list) {
  const vendido = list.reduce((s, c) => s + c.vendido_cents, 0);
  const ventas = list.reduce((s, c) => s + c.ventas_n, 0);
  const diff = list.reduce((s, c) => s + c.diferencia_cents, 0);
  const descuadres = list.filter((c) => c.diferencia_cents !== 0).length;
  clear(box).append(
    kpi('Vendido', eur(vendido), `${list.length} ${list.length === 1 ? 'cierre' : 'cierres'}`),
    kpi('Ventas', String(ventas), ventas ? `ticket medio ${eur(Math.round(vendido / ventas))}` : ''),
    kpi('Descuadre total', eurSigned(diff), descuadres ? `${descuadres} ${descuadres === 1 ? 'turno no cuadra' : 'turnos no cuadran'}` : 'todos cuadran', diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''),
    kpi('Cajas', String(new Set(list.map((c) => c.device_id)).size), [...new Set(list.map((c) => c.caja_nombre))].join(', ')));
}

function kpi(label, value, sub, cls = '') {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: `kpi-value ${cls}` }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

// --- Subir archivos (envío manual) -----------------------------------------------------------

export function upload(after) {
  const input = h('input', { type: 'file', accept: '.json,application/json', multiple: true, class: 'hidden' });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.remove();
    if (!files.length) return;
    toast('Subiendo…', 'ok', 2000);
    try {
      const r = await uploadCierreFiles(files);
      await sheet(() => h('div', { class: 'stack' },
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Nuevos'), h('div', { class: 'kpi-value pos' }, String(r.recibidos))),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Ya estaban'), h('div', { class: 'kpi-value' }, String(r.repetidos))),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Con problemas'), h('div', { class: `kpi-value ${r.errores.length ? 'neg' : ''}` }, String(r.errores.length)))),
        r.repetidos ? h('p', { class: 'muted' }, 'Los que ya estaban no se han vuelto a sumar.') : null,
        r.errores.length ? h('div', { class: 'alert' }, h('ul', { class: 'steps' }, r.errores.map((e) => h('li', {}, e)))) : null),
      { title: 'Archivo subido' });
      if (after) after();
    } catch (err) { errorToast(err); }
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
}
