// Conexión con Supabase: sesión, datos y avisos en tiempo real.
// Solo se usa la clave PÚBLICA (anon): no da acceso a nada por sí sola; los datos
// los protegen las reglas RLS de la base. Ninguna clave secreta vive aquí.
import { CONFIG } from '../config.js';

export const db = globalThis.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gestion.sesion' },
  realtime: { params: { eventsPerSecond: 5 } },
});

export const FUNCTIONS_URL = `${CONFIG.url}/functions/v1`;

/** Lanza el error de Supabase como Error normal, con mensaje en castellano si se puede. */
export function check({ data, error }) {
  if (error) {
    const e = new Error(error.message || 'Error');
    e.code = error.code;
    throw e;
  }
  return data;
}

export async function session() {
  return check(await db.auth.getSession()).session;
}

export async function me() {
  const s = await session();
  if (!s) return null;
  const m = check(await db.from('miembros').select('rol, nombre').eq('user_id', s.user.id).maybeSingle());
  return { user: s.user, rol: m ? m.rol : null };
}

// --- Tiempo real -----------------------------------------------------------------------
// La base apunta cada novedad en la tabla `novedades`. Aquí se escucha y se avisa a la pantalla.

let channel = null;
const listeners = new Set();
export const onNovedad = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function startRealtime(setLive) {
  if (channel) return;
  channel = db.channel('novedades')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'novedades' }, (msg) => {
      for (const fn of listeners) { try { fn(msg.new); } catch (e) { console.error(e); } }
    })
    .subscribe((status) => setLive(status === 'SUBSCRIBED'));
}

export async function stopRealtime() {
  if (channel) { await db.removeChannel(channel); channel = null; }
}

// --- Subir cierres desde un archivo (envío manual) --------------------------------------

/** Lee archivos .json de la caja (un cierre o un lote) y los manda a Gestión uno a uno. */
export async function uploadCierreFiles(files, onProgress = () => {}) {
  const items = [];
  const out = { recibidos: 0, repetidos: 0, errores: [] };
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { out.errores.push(`${f.name}: demasiado grande.`); continue; }
    let data;
    try { data = JSON.parse(await f.text()); } catch { out.errores.push(`${f.name}: no es un archivo de cierre.`); continue; }
    if (data && data.format === 'cpbar.lote/1' && Array.isArray(data.cierres)) items.push(...data.cierres.map((c) => [f.name, c]));
    else items.push([f.name, data]);
  }
  const s = await session();
  if (!s) throw new Error('La sesión ha caducado. Vuelve a entrar.');
  for (const [i, [name, cierre]] of items.entries()) {
    onProgress(i + 1, items.length);
    let res, body = null;
    try {
      res = await fetch(`${FUNCTIONS_URL}/recibir-cierre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify(cierre),
      });
      body = await res.json().catch(() => null);
    } catch {
      out.errores.push(`${name}: sin conexión.`);
      continue;
    }
    if (res.ok) body && body.estado === 'repetido' ? out.repetidos++ : out.recibidos++;
    else out.errores.push(`${name}${cierre && cierre.shift ? ` (turno ${cierre.shift.number})` : ''}: ${(body && body.message) || `error ${res.status}`}`);
  }
  out.total = items.length;
  return out;
}
