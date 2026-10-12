// Inicio: cómo va el negocio de un vistazo y avisos.
// (Fase 2: ventas y avisos de caja. Los gastos y el resultado se suman en las fases 3 y 5.)
import { db, check, onNovedad } from './supa.js';
import { h, clear, eur, eurSigned, period, isoDay, fmtDate, fmtDateTime, icon } from './util.js';
import { skeleton } from './ui.js';
import { cierreCard } from './cierres.js';

const PERIODS = [['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['anio', 'Este año']];
const SIN_CIERRE_DIAS = 2;

export async function render(main, ctx) {
  const hello = new Date().getHours() < 14 ? 'Buenos días' : new Date().getHours() < 21 ? 'Buenas tardes' : 'Buenas noches';
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'muted' }, hello), h('h1', {}, 'Cómo va el bar'))));
  const box = h('div', { class: 'stack' }, skeleton(4));
  main.append(box);

  async function load() {
    const year = period('anio');
    const [cierres, cajas] = await Promise.all([
      check(await db.from('cierres').select('id, device_id, caja_nombre, numero, fecha, cerrado_en, ventas_n, vendido_cents, diferencia_cents, origen, eliminado_en')
        .gte('fecha', addDays(isoDay(), -40) < year.from ? addDays(isoDay(), -40) : year.from).is('eliminado_en', null)
        .order('fecha', { ascending: false }).order('cerrado_en', { ascending: false }).limit(5000)),
      check(await db.from('cajas').select('id, nombre, device_id, revocada_en, ultimo_cierre_en')),
    ]);
    clear(box);

    // Avisos
    const avisos = [];
    const hoy = isoDay();
    for (const c of cajas.filter((x) => !x.revocada_en)) {
      if (!c.device_id) avisos.push(h('div', { class: 'notice' }, h('strong', {}, `${c.nombre}: `), 'todavía no ha enviado ningún cierre. Conéctala con su código en la caja (Productos → Ajustes → Gestión del bar).'));
      else if (c.ultimo_cierre_en && daysBetween(c.ultimo_cierre_en, new Date()) > SIN_CIERRE_DIAS) {
        avisos.push(h('div', { class: 'alert' }, h('strong', {}, `${c.nombre}: `), `no llega ningún cierre desde el ${fmtDateTime(c.ultimo_cierre_en)}. Si ha habido turnos, revisa que la caja tenga internet o sube el archivo del cierre.`));
      }
    }
    const recientes = cierres.filter((c) => c.fecha >= addDays(hoy, -7) && c.diferencia_cents !== 0);
    for (const c of recientes.slice(0, 5)) {
      avisos.push(h('div', { class: 'alert' }, h('strong', {}, c.diferencia_cents < 0 ? `Faltan ${eur(-c.diferencia_cents)} ` : `Sobran ${eur(c.diferencia_cents)} `),
        `en ${c.caja_nombre}, turno ${c.numero} (${fmtDate(c.fecha)}).`));
    }
    if (avisos.length) box.append(h('div', { class: 'section-title' }, h('h2', {}, 'Avisos')), h('div', { class: 'stack' }, avisos));

    // Ventas por periodo
    box.append(h('div', { class: 'section-title' }, h('h2', {}, 'Ventas'), h('span', { class: 'muted small' }, 'Gastos y resultado: próximamente')));
    box.append(h('div', { class: 'kpis' }, PERIODS.map(([k, label]) => {
      const r = period(k);
      const sel = cierres.filter((c) => c.fecha >= r.from && c.fecha <= r.to);
      const total = sel.reduce((s, c) => s + c.vendido_cents, 0);
      const diff = sel.reduce((s, c) => s + c.diferencia_cents, 0);
      return h('button', { class: 'kpi', style: 'text-align:left;cursor:pointer;font:inherit;color:inherit', onclick: () => ctx.go('ventas') },
        h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, eur(total)),
        h('div', { class: `kpi-sub ${diff < 0 ? 'neg' : ''}` }, `${sel.length} ${sel.length === 1 ? 'cierre' : 'cierres'}${diff ? ` · descuadre ${eurSigned(diff)}` : ''}`));
    })));

    // Últimos cierres
    box.append(h('div', { class: 'section-title' }, h('h2', {}, 'Últimos cierres'),
      h('button', { class: 'btn small ghost', onclick: () => ctx.go('ventas') }, 'Ver todos')));
    box.append(cierres.length
      ? h('div', { class: 'list' }, cierres.slice(0, 5).map((c) => cierreCard(c, ctx, load)))
      : h('div', { class: 'panel stack' }, h('h3', {}, 'Aún no ha llegado ningún cierre'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Ve a Ajustes → Cajas → Añadir caja y copia el código.'),
          h('li', {}, 'En la caja: Productos → Ajustes → Gestión del bar → Conectar con Gestión, y pega el código.'),
          h('li', {}, 'Al cerrar el turno, el cierre aparecerá aquí al momento.')),
        h('button', { class: 'btn primary', onclick: () => ctx.go('ajustes') }, icon('plus'), 'Añadir una caja')));
  }

  let timer = null;
  const off = onNovedad((n) => { if (n.tipo === 'cierre') { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 400); } });
  await load();
  return () => { off(); clearTimeout(timer); };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86_400_000;
