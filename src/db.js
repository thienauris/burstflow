import Dexie from 'dexie';

// Local-first + sync. status task: 'inbox' | 'ready' | 'done'
// Mỗi record đồng bộ có: id (UUID chuỗi), updated_at (ms), deleted (0/1 - soft delete để xoá cũng sync được).
// DB tên 'burstflow2' (khoá chuỗi ngay từ đầu). Dexie KHÔNG hỗ trợ đổi primary key nên không nâng cấp
// DB 'burstflow' cũ (++id số) tại chỗ — thay vào đó migrate best-effort sang DB mới (xem migrateFromLegacy).
export const db = new Dexie('burstflow2');

const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : 'id' + Date.now().toString(16) + Math.random().toString(16).slice(2);
const now = () => Date.now();

db.version(1).stores({
  projects: 'id, order, archived, deleted, updated_at',
  tasks: 'id, projectId, status, createdAt, doneAt, deleted, updated_at',
  blocks: 'id, taskId, projectId, startedAt, endedAt, deleted, updated_at',
  dayLogs: 'date, deleted, updated_at',
  settings: 'key',
  _sync: 'key'
});

// Chuyển dữ liệu từ DB cũ 'burstflow' (nếu có) → 'burstflow2'. Best-effort: lỗi thì bỏ qua, app vẫn chạy.
export async function migrateFromLegacy() {
  try {
    if (!(await Dexie.exists('burstflow'))) return;
    if ((await db.projects.count()) > 0) return; // đã có dữ liệu, không migrate đè
    const old = new Dexie('burstflow');
    old.version(1).stores({
      projects: '++id, order, archived',
      tasks: '++id, projectId, status, createdAt, doneAt',
      blocks: '++id, taskId, projectId, startedAt, endedAt',
      dayLogs: '&date', settings: '&key'
    });
    await old.open();
    const [ps, ts, bs, ds] = await Promise.all([
      old.table('projects').toArray(), old.table('tasks').toArray(),
      old.table('blocks').toArray(), old.table('dayLogs').toArray()
    ]);
    const t = now(), pMap = new Map(), tMap = new Map();
    for (const p of ps) { const nid = uid(); pMap.set(p.id, nid); await db.projects.add({ ...p, id: nid, updated_at: t, deleted: 0 }); }
    for (const x of ts) { const nid = uid(); tMap.set(x.id, nid); await db.tasks.add({ ...x, id: nid, projectId: pMap.get(x.projectId) ?? null, updated_at: t, deleted: 0 }); }
    for (const b of bs) { await db.blocks.add({ ...b, id: uid(), taskId: tMap.get(b.taskId) ?? null, projectId: pMap.get(b.projectId) ?? null, updated_at: t, deleted: 0 }); }
    for (const d of ds) { await db.dayLogs.put({ ...d, updated_at: t, deleted: 0 }); }
    old.close();
  } catch {
    /* best-effort — bỏ qua nếu migrate lỗi */
  }
}

export async function seedIfEmpty() {
  const n = await db.projects.filter((p) => !p.deleted).count();
  if (n === 0 && (await db.projects.count()) === 0) {
    const ts = now();
    await db.projects.bulkAdd([
      { id: uid(), name: 'Dự án A', color: '#38bdf8', order: 0, archived: 0, deleted: 0, updated_at: ts },
      { id: uid(), name: 'Dự án B', color: '#a78bfa', order: 1, archived: 0, deleted: 0, updated_at: ts }
    ]);
  }
}

// ---- Tasks -----------------------------------------------------------------
export async function addTaskToInbox(title, projectId = null) {
  const t = title.trim();
  if (!t) return;
  return db.tasks.add({ id: uid(), title: t, projectId, status: 'inbox', createdAt: now(), doneAt: null, deleted: 0, updated_at: now() });
}
export async function triageTask(id, projectId) {
  if (!projectId) return;
  await db.tasks.update(id, { projectId, status: 'ready', updated_at: now() });
}
export async function sendTaskToInbox(id) {
  await db.tasks.update(id, { status: 'inbox', updated_at: now() });
}
export async function deleteTask(id) {
  await db.tasks.update(id, { deleted: 1, updated_at: now() }); // soft delete để sync
}

// ---- Projects --------------------------------------------------------------
export async function addProject(name, color) {
  const order = await db.projects.count();
  return db.projects.add({ id: uid(), name: name.trim() || 'Dự án', color: color || '#38bdf8', order, archived: 0, deleted: 0, updated_at: now() });
}
export async function updateProject(id, patch) {
  await db.projects.update(id, { ...patch, updated_at: now() });
}

// ---- Blocks ----------------------------------------------------------------
export async function getActiveBlock() {
  return db.blocks.filter((b) => !b.endedAt && !b.deleted).first();
}
export async function startBlock({ taskId, projectId, deliverable, plannedMin }) {
  const active = await getActiveBlock();
  if (active) throw new Error('Đang có block chạy — WIP-lock chặn mở block thứ 2.');
  const d = (deliverable || '').trim();
  if (!d) throw new Error('Phải nhập "xong là gì" (deliverable) trước khi bắt đầu.');
  return db.blocks.add({
    id: uid(), taskId: taskId || null, projectId: projectId || null,
    deliverable: d, plannedMin, startedAt: now(), endedAt: null, delivered: null, note: '',
    deleted: 0, updated_at: now()
  });
}
export async function endBlock(id, { delivered, note = '', completeTask = false }) {
  const block = await db.blocks.get(id);
  await db.blocks.update(id, { endedAt: now(), delivered: delivered ? 1 : 0, note: note.trim(), updated_at: now() });
  if (completeTask && block && block.taskId) {
    await db.tasks.update(block.taskId, { status: 'done', doneAt: now(), updated_at: now() });
  }
}
export async function suggestNextProjectId() {
  const ready = await db.tasks.where('status').equals('ready').and((t) => !t.deleted).toArray();
  const projIds = [...new Set(ready.map((t) => t.projectId).filter(Boolean))];
  if (projIds.length === 0) return null;
  const last = await db.blocks.orderBy('startedAt').filter((b) => !b.deleted).last();
  const lastPid = last && last.projectId;
  const other = projIds.find((p) => p !== lastPid);
  return other != null ? other : projIds[0];
}

// ---- Break -----------------------------------------------------------------
export const BREAK = { short: 15, long: 30, longEvery: 3 };
export async function getSetting(key) { const r = await db.settings.get(key); return r ? r.value : undefined; }
export async function setSetting(key, value) { await db.settings.put({ key, value }); }
export async function getActiveBreak() { return getSetting('break'); }
export async function endBreak() { await db.settings.delete('break'); }
export async function completedBlocksToday() {
  const [s, e] = dayBounds();
  const arr = await db.blocks.where('startedAt').between(s, e).and((b) => !b.deleted).toArray();
  return arr.filter((b) => b.endedAt).length;
}
export async function startAutoBreak() {
  const n = await completedBlocksToday();
  const isLong = n > 0 && n % BREAK.longEvery === 0;
  const mins = isLong ? BREAK.long : BREAK.short;
  await setSetting('break', { startedAt: now(), mins, isLong });
  return { mins, isLong };
}

// ---- Day log ---------------------------------------------------------------
export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function dayBounds(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const start = x.getTime();
  return [start, start + 86400000];
}
export async function saveDayNote(date, note) {
  await db.dayLogs.put({ date, note, deleted: 0, updated_at: now() });
}

// ---- Sync meta (device-local) ----------------------------------------------
export async function getMeta(key) { const r = await db._sync.get(key); return r ? r.value : undefined; }
export async function setMeta(key, value) { await db._sync.put({ key, value }); }
export async function getSyncCode() { return getMeta('syncCode'); }
export async function setSyncCode(code) { await setMeta('syncCode', (code || '').trim()); }

export const SYNC_ENTITIES = ['projects', 'tasks', 'blocks', 'dayLogs'];
export const keyField = (entity) => (entity === 'dayLogs' ? 'date' : 'id');
