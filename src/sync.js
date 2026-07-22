import { createClient } from '@supabase/supabase-js';
import { db, getSyncCode, getMeta, setMeta, SYNC_ENTITIES, keyField } from './db.js';

// Project Supabase của user (thien.auris). Publishable key = an toàn để nhúng client;
// dữ liệu vẫn được bảo vệ: bảng RLS deny-all, chỉ vào qua RPC bf_pull/bf_push cần MÃ SYNC.
const SUPABASE_URL = 'https://kpcjnorchavvvafjnzwb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xKtObZX148rZ7cX0TBynKA_UoI8nLdT';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

let syncing = false;

// Một vòng đồng bộ: đẩy thay đổi cục bộ → kéo thay đổi từ mây (LWW theo updated_at).
export async function syncOnce() {
  const code = await getSyncCode();
  if (!code) throw new Error('Chưa đặt mã sync.');
  if (syncing) return;
  syncing = true;
  try {
    // ---- PUSH: các record đổi sau lần push trước ----
    const t0 = Date.now();
    const lastPush = (await getMeta('lastPushedAt')) || 0;
    const rows = [];
    for (const entity of SYNC_ENTITIES) {
      const recs = await db[entity].toArray();
      for (const r of recs) {
        if ((r.updated_at || 0) > lastPush) {
          rows.push({
            entity,
            id: String(r[keyField(entity)]),
            data: r,
            updated_at: new Date(r.updated_at || Date.now()).toISOString(),
            deleted: !!r.deleted
          });
        }
      }
    }
    if (rows.length) {
      const { error } = await sb.rpc('bf_push', { p_code: code, p_rows: rows });
      if (error) throw new Error(error.message || 'push lỗi');
    }
    await setMeta('lastPushedAt', t0);

    // ---- PULL: các record đổi sau lần pull trước ----
    const lastPull = (await getMeta('lastPulledAt')) || 0;
    const since = lastPull ? new Date(lastPull).toISOString() : null;
    const { data, error } = await sb.rpc('bf_pull', { p_code: code, p_since: since });
    if (error) throw new Error(error.message || 'pull lỗi');
    let maxTs = lastPull;
    for (const row of data || []) {
      const ts = new Date(row.updated_at).getTime();
      if (ts > maxTs) maxTs = ts;
      const table = db[row.entity];
      if (!table) continue;
      const key = row.id;
      const local = await table.get(key).catch(() => null);
      if (!local || (local.updated_at || 0) < ts) {
        await table.put({ ...row.data, updated_at: ts, deleted: row.deleted ? 1 : 0 });
      }
    }
    await setMeta('lastPulledAt', maxTs || Date.now());
    await setMeta('lastSyncedAt', Date.now());
    return { pushed: rows.length, pulled: (data || []).length };
  } finally {
    syncing = false;
  }
}

// Tự đồng bộ: ngay khi mở, định kỳ, khi tab active lại, khi có mạng.
export function startAutoSync(intervalMs = 12000) {
  const safe = () => syncOnce().catch(() => {});
  safe();
  const iv = setInterval(safe, intervalMs);
  const onVis = () => { if (document.visibilityState === 'visible') safe(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', safe);
  return () => {
    clearInterval(iv);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', safe);
  };
}
