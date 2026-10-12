// Gastos: llega en la fase 3 (gastos a mano, tu Excel, buscador y gráficos) y la fase final (tickets con foto e IA).
import { h } from './util.js';

export async function render(main) {
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Gastos')),
    h('div', { class: 'panel stack' },
      h('h2', {}, 'Muy pronto'),
      h('p', {}, 'Aquí apuntarás los gastos del bar y sustituirá a tu Excel de gastos:'),
      h('ul', { class: 'steps' },
        h('li', {}, 'Importar tu Excel Control_gastos_bar.xlsx tal cual.'),
        h('li', {}, 'Gastos a mano, con documento si quieres.'),
        h('li', {}, 'Buscador, filtros y gráficos por categoría y por tienda.'),
        h('li', {}, 'Al final: foto del ticket y la IA lo rellena por ti.'))));
}
