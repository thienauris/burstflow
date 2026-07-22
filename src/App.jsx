import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, addTaskToInbox, triageTask, sendTaskToInbox, deleteTask,
  addProject, updateProject, getActiveBlock, startBlock, endBlock,
  suggestNextProjectId, dayKey, dayBounds, saveDayNote,
  getActiveBreak, endBreak, startAutoBreak,
  getSyncCode, setSyncCode, getMeta
} from './db.js';
import { syncOnce, startAutoSync } from './sync.js';

const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(16);

const DURATIONS = [60, 90, 120];
const fmt = (s) => {
  const neg = s < 0;
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const ss = String(a % 60).padStart(2, '0');
  return `${neg ? '-' : ''}${m}:${ss}`;
};

// ---- tick hook: 1 nhịp/giây khi có block chạy ----
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function App() {
  const [tab, setTab] = useState('focus');
  const activeBlock = useLiveQuery(() => getActiveBlock(), [], null);
  const inboxCount = useLiveQuery(
    () => db.tasks.where('status').equals('inbox').and((t) => !t.deleted).count(),
    [],
    0
  );

  useEffect(() => startAutoSync(), []); // tự đồng bộ nếu đã đặt mã

  const tabs = [
    ['focus', 'Tập trung'],
    ['inbox', `Inbox${inboxCount ? ` (${inboxCount})` : ''}`],
    ['projects', 'Dự án'],
    ['day', 'Ngày'],
    ['sync', 'Đồng bộ']
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚡ BurstFlow</div>
        {activeBlock && <div className="pill live">● đang chạy 1 block</div>}
      </header>

      <QuickCapture locked={!!activeBlock} />

      <main className="content">
        {tab === 'focus' && <FocusView activeBlock={activeBlock} />}
        {tab === 'inbox' && <InboxView />}
        {tab === 'projects' && <ProjectsView />}
        {tab === 'day' && <DayView />}
        {tab === 'sync' && <SyncView />}
      </main>

      <nav className="tabbar">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ===========================================================================
function QuickCapture({ locked }) {
  const [v, setV] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!v.trim()) return;
    await addTaskToInbox(v);
    setV('');
  };
  return (
    <form className="capture" onSubmit={submit}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={locked ? 'Ghi nhanh → Inbox (không chen vào block đang chạy)' : 'Ghi nhanh việc mới → Inbox…'}
      />
      <button type="submit">+ Inbox</button>
    </form>
  );
}

// ===========================================================================
function FocusView({ activeBlock }) {
  const brk = useLiveQuery(() => getActiveBreak(), [], undefined);
  if (activeBlock) return <RunningBlock block={activeBlock} />;
  if (brk) return <BreakView brk={brk} />;
  return <StartForm />;
}

function BreakView({ brk }) {
  const now = useNow(true);
  const remaining = Math.round(brk.mins * 60 - (now - brk.startedAt) / 1000);
  const done = remaining <= 0;
  return (
    <div className="card focus">
      <div className="proj-tag" style={{ background: 'var(--ok)' }}>
        NGHỈ {brk.mins}′{brk.isLong ? ' · nghỉ dài (sau 3 block)' : ''}
      </div>
      <div className="task-title">{done ? '✅ Nghỉ xong — quay lại được rồi' : '☕ Rời màn hình · vận động · uống nước'}</div>
      <div className="timer" style={{ color: done ? 'var(--ok)' : 'var(--accent)' }}>{fmt(Math.max(0, remaining))}</div>
      <div className="sub">Burst cần hồi phục. Đừng mở block mới khi chưa nghỉ đủ.</div>
      <button className="primary big" onClick={() => endBreak()}>
        {done ? '▶ Bắt đầu block tiếp' : 'Bỏ qua nghỉ →'}
      </button>
    </div>
  );
}

function StartForm() {
  const projects = useLiveQuery(() => db.projects.where('archived').equals(0).and((p) => !p.deleted).toArray(), [], []);
  const readyTasks = useLiveQuery(() => db.tasks.where('status').equals('ready').and((t) => !t.deleted).toArray(), [], []);
  const [suggested, setSuggested] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [deliverable, setDeliverable] = useState('');
  const [mins, setMins] = useState(90);
  const [err, setErr] = useState('');

  useEffect(() => {
    suggestNextProjectId().then((p) => {
      setSuggested(p);
      if (p && !projectId) setProjectId(String(p));
    });
  }, [readyTasks?.length]);

  const projName = (id) => projects.find((p) => p.id === Number(id))?.name || '—';
  const tasksOfProject = useMemo(
    () => readyTasks.filter((t) => String(t.projectId) === String(projectId)),
    [readyTasks, projectId]
  );

  useEffect(() => {
    // auto-chọn task đầu tiên của dự án đang chọn
    if (tasksOfProject.length && !tasksOfProject.some((t) => String(t.id) === String(taskId))) {
      setTaskId(String(tasksOfProject[0].id));
    }
    if (!tasksOfProject.length) setTaskId('');
  }, [tasksOfProject, taskId]);

  if (!readyTasks.length) {
    return (
      <div className="card empty">
        <h2>Chưa có việc "Sẵn sàng"</h2>
        <p>Ghi việc vào <b>Inbox</b> rồi <b>triage</b> (gán dự án) để đưa vào phiên tập trung. Một block = một việc + một deliverable.</p>
      </div>
    );
  }

  const start = async () => {
    setErr('');
    try {
      await startBlock({ taskId, projectId, deliverable, plannedMin: mins });
      setDeliverable('');
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card">
      <h2>Bắt đầu một block</h2>

      <label className="lbl">Dự án (xoay vòng)</label>
      <div className="row">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {suggested != null && (
          <span className="hint">Gợi ý xoay: <b>{projName(suggested)}</b> (khác block trước)</span>
        )}
      </div>

      <label className="lbl">Việc duy nhất của block</label>
      <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
        {tasksOfProject.length === 0 && <option value="">— dự án này chưa có việc sẵn sàng —</option>}
        {tasksOfProject.map((t) => (
          <option key={t.id} value={t.id}>{t.title}</option>
        ))}
      </select>

      <label className="lbl">Xong là gì? (deliverable — bắt buộc)</label>
      <input
        className="deliverable"
        value={deliverable}
        onChange={(e) => setDeliverable(e.target.value)}
        placeholder='vd: "xong bản nháp phần A", "commit chạy được test X"'
      />

      <label className="lbl">Độ dài</label>
      <div className="row durations">
        {DURATIONS.map((d) => (
          <button key={d} className={mins === d ? 'chip active' : 'chip'} onClick={() => setMins(d)}>
            {d}′
          </button>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      <button className="primary big" disabled={!taskId || !deliverable.trim()} onClick={start}>
        ▶ Bắt đầu {mins}′ tập trung sâu
      </button>
    </div>
  );
}

function RunningBlock({ block }) {
  const now = useNow(true);
  const task = useLiveQuery(() => (block.taskId ? db.tasks.get(block.taskId) : null), [block.taskId], null);
  const project = useLiveQuery(() => (block.projectId ? db.projects.get(block.projectId) : null), [block.projectId], null);
  const remaining = Math.round(block.plannedMin * 60 - (now - block.startedAt) / 1000);
  const overtime = remaining < 0;
  const [ending, setEnding] = useState(false);

  return (
    <div className="card focus">
      <div className="proj-tag" style={{ background: project?.color || '#334155' }}>{project?.name || 'Không dự án'}</div>
      <div className="task-title">{task?.title || '(việc đã xoá)'}</div>
      <div className="deliverable-show">🎯 {block.deliverable}</div>
      <div className={overtime ? 'timer over' : 'timer'}>{fmt(remaining)}</div>
      <div className="sub">{overtime ? 'Hết giờ — chốt deliverable rồi kết block' : 'Một việc. Không mở tab khác. Việc mới → Inbox.'}</div>
      <button className="primary big" onClick={() => setEnding(true)}>■ Kết thúc block</button>
      {ending && <EndDialog block={block} onClose={() => setEnding(false)} />}
    </div>
  );
}

function EndDialog({ block, onClose }) {
  const [note, setNote] = useState('');
  const [complete, setComplete] = useState(false);
  const finish = async (delivered) => {
    await endBlock(block.id, { delivered, note, completeTask: complete });
    await startAutoBreak(); // tự mở nghỉ giữa block
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Đã ra artifact chưa?</h3>
        <p className="deliverable-show">🎯 {block.deliverable}</p>
        <textarea placeholder="Ghi chú (đã ra cái gì / vướng ở đâu)…" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
          Task này đã HOÀN TẤT (đánh dấu done)
        </label>
        <div className="row end-actions">
          <button className="ok" onClick={() => finish(true)}>✔ Có, đã ra deliverable</button>
          <button className="warn" onClick={() => finish(false)}>✕ Chưa ra</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
function InboxView() {
  const inbox = useLiveQuery(() => db.tasks.where('status').equals('inbox').and((t) => !t.deleted).reverse().sortBy('createdAt'), [], []);
  const ready = useLiveQuery(() => db.tasks.where('status').equals('ready').and((t) => !t.deleted).toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.where('archived').equals(0).and((p) => !p.deleted).toArray(), [], []);
  const pName = (id) => projects.find((p) => p.id === id)?.name || '—';

  return (
    <div className="stack">
      <div className="card">
        <h2>Inbox — triage theo lịch (không xử lý giữa block)</h2>
        {!inbox.length && <p className="muted">Trống. Việc mới ghi nhanh sẽ về đây.</p>}
        {inbox.map((t) => (
          <div key={t.id} className="task-row">
            <span className="t">{t.title}</span>
            <select defaultValue="" onChange={(e) => triageTask(t.id, e.target.value)}>
              <option value="" disabled>→ gán dự án…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="x" onClick={() => deleteTask(t.id)}>✕</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Sẵn sàng ({ready.length})</h2>
        {!ready.length && <p className="muted">Chưa có việc sẵn sàng cho block.</p>}
        {ready.map((t) => (
          <div key={t.id} className="task-row">
            <span className="dot" />
            <span className="t">{t.title}</span>
            <span className="proj-min">{pName(t.projectId)}</span>
            <button className="link" onClick={() => sendTaskToInbox(t.id)}>↩ Inbox</button>
            <button className="x" onClick={() => deleteTask(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
function ProjectsView() {
  const projects = useLiveQuery(() => db.projects.orderBy('order').and((p) => !p.deleted).toArray(), [], []);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');

  return (
    <div className="stack">
      <div className="card">
        <h2>Dự án (giữ 2–3 cái để xoay vòng)</h2>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên dự án mới…" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <button className="primary" onClick={async () => { if (name.trim()) { await addProject(name, color); setName(''); } }}>
            + Thêm
          </button>
        </div>
      </div>
      <div className="card">
        {projects.map((p) => (
          <div key={p.id} className="task-row">
            <span className="dot" style={{ background: p.color }} />
            <input
              className="t inline"
              defaultValue={p.name}
              onBlur={(e) => updateProject(p.id, { name: e.target.value })}
            />
            <input type="color" value={p.color} onChange={(e) => updateProject(p.id, { color: e.target.value })} />
            <button className="link" onClick={() => updateProject(p.id, { archived: p.archived ? 0 : 1 })}>
              {p.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
function DayView() {
  const [start, end] = dayBounds();
  const key = dayKey();
  const blocks = useLiveQuery(
    () => db.blocks.where('startedAt').between(start, end).and((b) => !b.deleted).reverse().sortBy('startedAt'),
    [key],
    []
  );
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const savedNote = useLiveQuery(() => db.dayLogs.get(key), [key], null);
  const [note, setNote] = useState('');
  useEffect(() => { if (savedNote) setNote(savedNote.note || ''); }, [savedNote?.note]);

  const pName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const done = blocks.filter((b) => b.endedAt);
  const focusMin = done.reduce((s, b) => s + Math.round((b.endedAt - b.startedAt) / 60000), 0);
  const delivered = done.filter((b) => b.delivered).length;
  const byProject = {};
  done.forEach((b) => { byProject[b.projectId] = (byProject[b.projectId] || 0) + 1; });

  return (
    <div className="stack">
      <div className="card">
        <h2>Hôm nay — {key}</h2>
        <div className="stats">
          <Stat n={done.length} label="block xong" />
          <Stat n={focusMin} label="phút tập trung" />
          <Stat n={`${delivered}/${done.length || 0}`} label="ra deliverable" />
        </div>
        <div className="byproj">
          {Object.keys(byProject).length === 0 && <span className="muted">Chưa có block nào hôm nay.</span>}
          {Object.entries(byProject).map(([pid, c]) => (
            <span key={pid} className="proj-min">{pName(Number(pid))}: {c}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Các block</h3>
        {!done.length && <p className="muted">—</p>}
        {done.map((b) => (
          <div key={b.id} className="task-row">
            <span className={b.delivered ? 'flag ok' : 'flag no'}>{b.delivered ? '✔' : '✕'}</span>
            <span className="t">{b.deliverable}</span>
            <span className="proj-min">{pName(b.projectId)} · {Math.round((b.endedAt - b.startedAt) / 60000)}′</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Nhật ký cuối ngày</h3>
        <textarea
          placeholder="Xong gì? Việc dang dở → next action cụ thể là gì?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="primary" onClick={() => saveDayNote(key, note)}>Lưu nhật ký</button>
      </div>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div className="stat">
      <div className="num">{n}</div>
      <div className="lab">{label}</div>
    </div>
  );
}

function SyncView() {
  const code = useLiveQuery(() => getSyncCode(), [], '');
  const lastSynced = useLiveQuery(() => getMeta('lastSyncedAt'), [], 0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (code) setDraft(code); }, [code]);

  const run = async () => {
    setBusy(true); setMsg('');
    try { const r = await syncOnce(); setMsg(`Đồng bộ xong · đẩy ${r?.pushed ?? 0} · nhận ${r?.pulled ?? 0}`); }
    catch (e) { setMsg('Lỗi: ' + e.message); }
    setBusy(false);
  };
  const save = async () => {
    const c = draft.trim();
    if (!c) { setMsg('Mã trống.'); return; }
    await setSyncCode(c);
    setMsg('Đã lưu mã. Đang đồng bộ…');
    await run();
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Đồng bộ nhiều thiết bị (mã sync)</h2>
        <p className="muted">
          Dán <b>cùng một mã</b> trên PC và điện thoại → dữ liệu gom chung. Mã chính là mật khẩu —
          giữ kín, đừng chia sẻ.
        </p>
        <label className="lbl">Mã sync</label>
        <div className="row">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="dán mã hoặc tạo mới…" />
          <button className="chip" onClick={() => setDraft(uid())}>Tạo mã mới</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={save}>Lưu &amp; bật đồng bộ</button>
          <button className="primary" disabled={!code || busy} onClick={run}>
            {busy ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
          </button>
        </div>
        {msg && <div className="hint" style={{ marginTop: 12 }}>{msg}</div>}
      </div>

      <div className="card">
        <h3>Trạng thái</h3>
        <div className="task-row"><span className="t">Mã hiện tại</span><span className="proj-min">{code ? code.slice(0, 8) + '…' : 'chưa đặt'}</span></div>
        <div className="task-row"><span className="t">Đồng bộ gần nhất</span><span className="proj-min">{lastSynced ? new Date(lastSynced).toLocaleString() : '—'}</span></div>
        <div className="task-row"><span className="t">Tự đồng bộ</span><span className="proj-min">mỗi ~12s + khi mở/online</span></div>
      </div>

      <div className="card">
        <h3>Cách dùng</h3>
        <p className="muted">
          1) Máy này: bấm <b>Tạo mã mới</b> → <b>Lưu &amp; bật</b>.<br />
          2) Máy kia: mở app, vào tab Đồng bộ, <b>dán đúng mã đó</b> → Lưu.<br />
          3) Xong — hai máy tự khớp (last-write-wins). Vẫn chạy offline, có mạng lại thì tự đồng bộ.
        </p>
      </div>
    </div>
  );
}
