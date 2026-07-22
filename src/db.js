import Dexie from 'dexie';

// Local-first store. status task: 'inbox' | 'ready' | 'done'
export const db = new Dexie('burstflow');

db.version(1).stores({
  projects: '++id, order, archived',
  tasks: '++id, projectId, status, createdAt, doneAt',
  blocks: '++id, taskId, projectId, startedAt, endedAt',
  dayLogs: '&date',
  settings: '&key'
});

export async function seedIfEmpty() {
  const n = await db.projects.count();
  if (n === 0) {
    await db.projects.bulkAdd([
      { name: 'Dự án A', color: '#38bdf8', order: 0, archived: 0 },
      { name: 'Dự án B', color: '#a78bfa', order: 1, archived: 0 }
    ]);
  }
}

// ---- Tasks -----------------------------------------------------------------
// WIP-lock: bat cu task moi nao cung roi vao INBOX (khong nhay thang vao block).
export async function addTaskToInbox(title, projectId = null) {
  const t = title.trim();
  if (!t) return;
  return db.tasks.add({ title: t, projectId, status: 'inbox', createdAt: Date.now(), doneAt: null });
}

export async function triageTask(id, projectId) {
  if (!projectId) return;
  await db.tasks.update(id, { projectId: Number(projectId), status: 'ready' });
}

export async function sendTaskToInbox(id) {
  await db.tasks.update(id, { status: 'inbox' });
}

export async function deleteTask(id) {
  await db.tasks.delete(id);
}

// ---- Projects --------------------------------------------------------------
export async function addProject(name, color) {
  const order = await db.projects.count();
  return db.projects.add({ name: name.trim() || 'Dự án', color: color || '#38bdf8', order, archived: 0 });
}
export async function updateProject(id, patch) {
  await db.projects.update(id, patch);
}

// ---- Blocks ----------------------------------------------------------------
export async function getActiveBlock() {
  return db.blocks.filter((b) => !b.endedAt).first();
}

export async function startBlock({ taskId, projectId, deliverable, plannedMin }) {
  const active = await getActiveBlock();
  if (active) throw new Error('Đang có block chạy — WIP-lock chặn mở block thứ 2.');
  const d = (deliverable || '').trim();
  if (!d) throw new Error('Phải nhập "xong là gì" (deliverable) trước khi bắt đầu.');
  return db.blocks.add({
    taskId: taskId ? Number(taskId) : null,
    projectId: projectId ? Number(projectId) : null,
    deliverable: d,
    plannedMin,
    startedAt: Date.now(),
    endedAt: null,
    delivered: null,
    note: ''
  });
}

export async function endBlock(id, { delivered, note = '', completeTask = false }) {
  const block = await db.blocks.get(id);
  await db.blocks.update(id, { endedAt: Date.now(), delivered: delivered ? 1 : 0, note: note.trim() });
  if (completeTask && block && block.taskId) {
    await db.tasks.update(block.taskId, { status: 'done', doneAt: Date.now() });
  }
}

// Goi y XOAY du an: chon du an co task 'ready' KHAC du an cua block gan nhat.
export async function suggestNextProjectId() {
  const ready = await db.tasks.where('status').equals('ready').toArray();
  const projIds = [...new Set(ready.map((t) => t.projectId).filter(Boolean))];
  if (projIds.length === 0) return null;
  const last = await db.blocks.orderBy('startedAt').last();
  const lastPid = last && last.projectId;
  const other = projIds.find((p) => p !== lastPid);
  return other != null ? other : projIds[0];
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
  await db.dayLogs.put({ date, note });
}
