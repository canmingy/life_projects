'use strict';

/* ============================================================
   Canming's Life Projects — 应用逻辑
   ============================================================ */

const STORAGE_KEY = 'amy_life_v1';

/* ---------- 云同步配置（Supabase）----------
   1. 去 https://supabase.com 免费建一个项目
   2. 项目设置 → API 里复制 Project URL 和 anon public key，填到下面
   3. 在 SQL Editor 跑本文件末尾注释里的建表语句（或见聊天说明）
   4. Database → Replication 把 workbench_state 表加入 realtime 发布
   未配置时，应用照常只在本地浏览器使用，不受影响。
*/
const SUPABASE_URL = 'https://ovoxuecbclvgrvlfgjpk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92b3h1ZWNiY2x2Z3J2bGZnanBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NzE4ODQsImV4cCI6MjEwMjI0Nzg4NH0.SlHL9t3C9nkogVkQNYqS0YdbmsH3K0BaXsOQPM8-fyo';
const SYNC_CONFIGURED = /^https?:\/\//.test(SUPABASE_URL);

let sb = null;            // supabase client
let syncUser = null;      // 当前登录用户
let suppressRemote = false;
let pushTimer = null;

/* ---------- 常量 ---------- */
const NAV_GROUPS = [
  { group: '工作', items: [
    { key: 'dashboard', label: '概览',     ico: '▤' },
    { key: 'projects',  label: '项目',     ico: '📁' },
    { key: 'todos',     label: '今日待做', ico: '✓' },
    { key: 'calendar',  label: '日历',     ico: '📅' },
    { key: 'progress',  label: '项目进度', ico: '📈' },
    { key: 'literature',label: '文献管理', ico: '📚' },
    { key: 'goals',     label: '年度目标', ico: '🎯' },
    { key: 'backup',    label: '数据备份', ico: '💾' },
    { key: 'share',     label: '分享',     ico: '🔗' },
  ]},
  { group: '生活', items: [
    { key: 'notes',   label: '笔记手账', ico: '📝' },
    { key: 'culture', label: '文化生活', ico: '🎭' },
    { key: 'finance', label: '记账',     ico: '💰' },
    { key: 'fitness', label: '健身',     ico: '💪' },
    { key: 'habits',  label: '习惯打卡', ico: '✅' },
  ]},
];

const QUADRANTS = [
  { key: 'q1', label: '紧急且重要',   cls: 'q1', tip: '优先处理' },
  { key: 'q2', label: '不紧急但重要', cls: 'q2', tip: '计划投入' },
  { key: 'q3', label: '紧急不重要',   cls: 'q3', tip: '尽量委托' },
  { key: 'q4', label: '不紧急不重要', cls: 'q4', tip: '减少投入' },
];

const NOTE_TYPES = ['灵感', '随笔', '吐槽', '备忘'];
const QLABEL = { q1: '紧急且重要', q2: '不紧急但重要', q3: '紧急不重要', q4: '不紧急不重要' };

/* 文化生活：书籍 / 电影 / 播客 单一作品库 */
const CUL_TYPES = {
  book:    { label: '书籍', ico: '📖', cls: 'b-teal' },
  movie:   { label: '电影', ico: '🎬', cls: 'b-blue' },
  podcast: { label: '播客', ico: '🎙️', cls: 'b-amber' },
};
const CUL_STATUS = {
  '想读想看': { label: '想读想看', cls: 'b-amber' },
  '进行中':   { label: '进行中',   cls: 'b-orange' },
  '已完成':   { label: '已完成',   cls: 'b-green' },
  '暂停':     { label: '暂停',     cls: 'b-gray' },
  '放弃':     { label: '放弃',     cls: 'b-red' },
};
const CUL_VIEWS = [
  { key: 'all',      label: '全部作品' },
  { key: 'doing',    label: '正在进行' },
  { key: 'books',    label: '已读书籍' },
  { key: 'movies',   label: '已看电影' },
  { key: 'podcasts', label: '播客记录' },
  { key: 'wish',     label: '想读想看' },
];

/* ---------- 状态 ---------- */
let state = null;

function defaultState() {
  return {
    activeModule: 'dashboard',
    version: 2,
    projects: [],
    tasks: [],            // 统一任务库（项目任务 + 个人任务），三级：项目→任务组→执行任务
    calEvents: [],        // 日历独立事件（会议/面谈/出发/实验等），与任务区分类型
    progressLogs: [],     // 项目进度日志（独立，不依赖任务勾选）
    weeklyPlans: [],      // 周计划（历史保留）
    quarterlyPlans: [],   // 季度计划（历史保留）
    notes: [],
    finance: [],
    fitness: { measures: [], exercises: [] },
    habits: { items: [], log: {} },
    goals: [],
    literature: [],
    cultural: [],         // 文化生活作品库（书籍/电影/播客，按 type 区分）
    selectedProjectId: null,
    calMonth: null,
    calSelDay: null,
    financeMonth: null,
    finF: { from: '', to: '', cat: 'all', src: 'all' },
    fitTab: 'measure',
    habitMonth: null,
    noteFilter: 'all',
    litFilter: 'all',
    taskFilter: { project: 'all', quad: 'all', status: 'all', dueFrom: '', dueTo: '' },
    litF: { search: '', cat: 'all', read: 'all', proj: 'all', tags: [] },
    culView: 'all',
    culF: { search: '', type: 'all', cat: 'all', year: 'all', rating: 'all', tag: 'all' },
    lastBackup: null,
  };
}

/* ---------- 持久化 ---------- */
function ensureArrays() {
  ['tasks', 'calEvents', 'progressLogs', 'weeklyPlans', 'quarterlyPlans',
   'notes', 'finance', 'goals', 'literature', 'cultural'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  if (!state.fitness) state.fitness = { measures: [], exercises: [] };
  if (!state.habits) state.habits = { items: [], log: {} };
  if (state.version == null) state.version = 1;
}

/* 旧结构自动迁移：projects.subtasks -> tasks；todos -> tasks；events -> calEvents
   目标：升级后旧数据不丢失，且全部收敛到统一任务库 */
function migrateState() {
  if (state.version >= 2 && !state.__needsMigrate) {
    // 已是最新结构；仅当遗留字段存在时才迁移
    if (!state.todos && !(state.projects || []).some(p => p.subtasks)) return;
  }
  const today = todayStr();

  // 1) 项目子任务 -> 执行任务（直接挂在项目下，无任务组）
  (state.projects || []).forEach(p => {
    if (Array.isArray(p.subtasks)) {
      p.subtasks.forEach(s => {
        state.tasks.push({
          id: s.id || uid(), name: s.text || '', type: 'project',
          projectId: p.id, parentId: p.id, level: 3,
          planDate: null, dueDate: s.due || null, quad: null,
          status: s.done ? '已完成' : '未开始',
          note: '', doneDate: s.done ? today : null,
        });
      });
      delete p.subtasks;
    }
    // 补充项目新字段
    if (p.phase === undefined) p.phase = '';
    if (p.nextStep === undefined) p.nextStep = '';
    if (p.deadline === undefined) p.deadline = null;
    if (p.blocked === undefined) p.blocked = false;
  });

  // 2) 旧 todos -> 统一任务（有项目则关联，否则个人任务）
  (state.todos || []).forEach(t => {
    const hasProj = t.projectId && state.projects.some(p => p.id === t.projectId);
    state.tasks.push({
      id: t.id || uid(), name: t.text || '', type: hasProj ? 'project' : 'personal',
      projectId: hasProj ? t.projectId : null, parentId: hasProj ? t.projectId : null,
      level: 3, planDate: t.date || null, dueDate: null, quad: t.quad || null,
      status: t.done ? '已完成' : '未开始', note: '', doneDate: t.done ? today : null,
    });
  });
  delete state.todos;

  // 3) 旧 events -> calEvents
  if (Array.isArray(state.events)) {
    state.calEvents = state.events.map(e => ({ ...e, kind: 'event' }));
    delete state.events;
  }

  state.version = 2;
  delete state.__needsMigrate;
}

function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      state = Object.assign(defaultState(), s);
      ensureArrays();
      migrateState();
      if (!state.calMonth) state.calMonth = curMonth();
      if (!state.financeMonth) state.financeMonth = curMonthStr();
      return;
    } catch (e) { /* ignore */ }
  }
  state = defaultState();
  state.calMonth = curMonth();
  state.financeMonth = curMonthStr();
  seeding = true;   // 示例数据不算"用户未同步改动"，不标记 pending
  seed();
  seeding = false;
}

/* ============================================================
   云同步（Supabase）
   ============================================================ */
function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// seeding：seed() 初始化示例数据期间为 true，此时不标记"待同步"
let seeding = false;

async function initSync() {
  if (!SYNC_CONFIGURED || typeof supabase === 'undefined') {
    setSyncStatus('仅本地存储', '');
    renderAuthArea();
    return;
  }
  try {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      syncUser = session.user;
      setSyncStatus('同步中…', 'syncing');
      if (offlinePending) {
        // 本地有未同步的改动 → 优先把本地改动推上去，不拉取（避免覆盖本地）
        queuePush();
        subscribeRemote(); // 仍建立实时订阅；push 成功后 pending 清除，之后正常拉取
      } else {
        // 本地干净 → 拉取云端最新；若云端为空（首次）则把本地推上去
        const pulled = await pullRemote();
        subscribeRemote();
        if (pulled) setSyncStatus('已同步', 'ok');
        else queuePush();
      }
    } else {
      setSyncStatus('未登录', '');
    }
  } catch (e) {
    console.warn('sync init failed', e);
    setSyncStatus('同步不可用', 'err');
  }
  renderAuthArea();
}

// 本机浏览位置/筛选状态：只在本地保留，不随云同步（避免打开页面被"踢"回概览等）
const UI_KEYS = ['activeModule', 'selectedProjectId', 'calMonth', 'calSelDay',
  'financeMonth', 'finF', 'fitTab', 'habitMonth', 'noteFilter', 'litFilter',
  'taskFilter', 'litF', 'culView', 'culF'];

async function pullRemote() {
  if (!sb || !syncUser) return false;
  const { data, error } = await sb
    .from('workbench_state')
    .select('data')
    .eq('user_id', syncUser.id)
    .maybeSingle();
  if (error) { console.warn('pull failed', error); return false; }
  if (data && data.data) {
    // 本地有未同步改动时，绝不用云端覆盖本地（防止丢离线新增）
    if (offlinePending) return false;
    // 先记住本机浏览位置/筛选状态，覆盖后恢复
    const ui = {};
    UI_KEYS.forEach(k => { ui[k] = state[k]; });
    state = Object.assign(defaultState(), data.data);
    ensureArrays();
    migrateState();
    UI_KEYS.forEach(k => { if (ui[k] !== undefined && ui[k] !== null) state[k] = ui[k]; });
    // 选中的项目若已被删除则清空
    if (state.selectedProjectId && !state.projects.some(p => p.id === state.selectedProjectId)) {
      state.selectedProjectId = null;
    }
    // 补默认值：防止云端旧数据缺少字段导致渲染崩溃
    if (!state.calMonth) state.calMonth = curMonth();
    if (!state.financeMonth) state.financeMonth = curMonthStr();
    if (!state.habitMonth) state.habitMonth = curMonthStr();
    saveLocal();
    return true; // 拉到云端数据并已覆盖本地
  }
  return false; // 云端无数据
}

function queuePush() {
  if (!sb || !syncUser) return;
  clearTimeout(pushTimer);
  setSyncStatus('同步中…', 'syncing');
  // 预标记：只要有改动待推送，就记为"未确认同步"。
  // 这样即使页面在 debounce 窗口内被关闭，标记也已持久化，
  // 下次打开会优先 push 本地改动而不是用云端覆盖。
  setOfflinePending(true);
  pushTimer = setTimeout(pushRemote, 700);
}

/* ---------- 离线暂存 / 恢复同步 ----------
   offlinePending：本地有未同步改动时为 true（持久化到 localStorage，刷新后仍有效）。
   规则：离线时改动只存 localStorage（不覆盖云端）；恢复网络后弹出提示条，
   用户确认后再 push；有未同步改动期间不拉取远程（避免本地改动被覆盖）。 */
let offlinePending = false;
function setOfflinePending(v) {
  offlinePending = v;
  try { localStorage.setItem('wb_offline_pending', v ? '1' : ''); } catch (e) {}
}
function loadOfflinePending() {
  try { offlinePending = localStorage.getItem('wb_offline_pending') === '1'; } catch (e) {}
}
function showSyncBanner() {
  const b = document.getElementById('syncBanner');
  if (b) b.style.display = 'flex';
}
function hideSyncBanner() {
  const b = document.getElementById('syncBanner');
  if (b) b.style.display = 'none';
}
function doPendingSync() { queuePush(); }

async function pushRemote() {
  if (!sb || !syncUser) return;
  suppressRemote = true;
  let error = null;
  try {
    const res = await sb
      .from('workbench_state')
      .upsert({ user_id: syncUser.id, data: state, updated_at: new Date().toISOString() });
    error = res.error || null;
  } catch (e) { error = e; }
  suppressRemote = false;
  if (error) {
    setOfflinePending(true);
    setSyncStatus('离线，改动已存本地', 'err');
    if (console && console.warn) console.warn('push failed', error);
  } else {
    setOfflinePending(false);
    hideSyncBanner();
    setSyncStatus('已同步', 'ok');
  }
}

function subscribeRemote() {
  if (!sb || !syncUser) return;
  sb.channel('wb_state_' + syncUser.id)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'workbench_state',
      filter: `user_id=eq.${syncUser.id}`,
    }, async () => {
      if (suppressRemote) return;
      if (offlinePending) return; // 本地有未同步改动时不拉取远程，避免覆盖
      await pullRemote();
      render();
      setSyncStatus('已同步（远程更新）', 'ok');
    })
    .subscribe();
}

/* ---------- 登录 / 注册 UI ---------- */
function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (!el) return;
  if (!SYNC_CONFIGURED) {
    el.innerHTML = `<button class="auth-btn" disabled style="opacity:.6;cursor:default;">云同步未配置</button>`;
    return;
  }
  if (syncUser) {
    const h = `
      <div class="auth-user">
        <div class="au-email">${escapeHtml(syncUser.email || '已登录')}</div>
        <div class="auth-row">
          <span class="sync-dot" id="syncDot"></span>
          <span id="syncText" style="flex:1;">已同步</span>
          <button class="auth-link" onclick="doLogout()">退出</button>
        </div>
      </div>`;
    el.innerHTML = h;
    const da = document.getElementById('drawerAuth');
    if (da) da.innerHTML = `
      <div class="auth-user">
        <div class="au-email">${escapeHtml(syncUser.email || '已登录')}</div>
        <div class="auth-row"><button class="auth-link" onclick="doLogout()">退出登录</button></div>
      </div>`;
  } else {
    const h = `<button class="auth-btn" onclick="openAuthModal()">☁️ 登录同步</button>`;
    el.innerHTML = h;
    const da = document.getElementById('drawerAuth');
    if (da) da.innerHTML = h;
  }
  applySyncStatus();
}

function setSyncStatus(text, cls) {
  window.__syncText = text || '仅本地存储';
  window.__syncCls = cls || '';
  const foot = document.getElementById('syncFoot');
  if (foot) foot.textContent = window.__syncText;
  applySyncStatus();
}

function applySyncStatus() {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  const cls = window.__syncCls || '';
  if (dot) dot.className = 'sync-dot' + (cls ? ' ' + cls : '');
  if (txt) txt.textContent = window.__syncText || '';
  const foot = document.getElementById('syncFoot');
  if (foot) foot.className = 'sidebar-foot' + (cls ? ' sync-' + cls : '');
}

let authTab = 'login';
function openAuthModal() {
  const m = document.getElementById('authModal');
  if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeAuthModal()">
      <div class="modal">
        <h3>☁️ 云同步登录</h3>
        <div class="modal-tabs">
          <div class="modal-tab ${authTab === 'login' ? 'active' : ''}" onclick="setAuthTab('login')">登录</div>
          <div class="modal-tab ${authTab === 'signup' ? 'active' : ''}" onclick="setAuthTab('signup')">注册</div>
        </div>
        <div class="modal-form">
          <input type="email" class="input" id="authEmail" placeholder="邮箱" autocomplete="email">
          <input type="password" class="input" id="authPass" placeholder="密码（至少6位）" autocomplete="current-password">
          <div class="modal-note" id="authMsg">用邮箱注册一个账号即可，数据只属于你。注册后默认需邮箱验证；也可在 Supabase 后台关闭「邮件确认」直接登录。</div>
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeAuthModal()">取消</button>
            <button class="btn btn-primary btn-sm" onclick="doAuth()">${authTab === 'login' ? '登录' : '注册并登录'}</button>
          </div>
        </div>
      </div>
    </div>`;
}
function closeAuthModal() {
  const m = document.getElementById('authModal');
  if (m) m.innerHTML = '';
}
function setAuthTab(t) { authTab = t; openAuthModal(); }

async function doAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const msg = document.getElementById('authMsg');
  if (!email || pass.length < 6) { msg.textContent = '请输入邮箱和至少6位密码'; return; }
  if (!sb) { msg.textContent = '同步未初始化'; return; }
  msg.textContent = '处理中…';
  try {
    let res;
    if (authTab === 'login') {
      res = await sb.auth.signInWithPassword({ email, password: pass });
    } else {
      res = await sb.auth.signUp({ email, password: pass });
    }
    if (res.error) { msg.textContent = res.error.message; return; }
    if (authTab === 'signup' && !res.data.session) {
      msg.textContent = '注册成功！请先到邮箱完成验证，再切回「登录」登录。';
      return;
    }
    const sess = res.data.session || (await sb.auth.getSession()).data.session;
    if (!sess) { msg.textContent = '未获取到登录态，请确认邮箱验证或重试。'; return; }
    syncUser = sess.user;
    closeAuthModal();
    setSyncStatus('同步中…', 'syncing');
    if (offlinePending) {
      // 本地有未同步改动 → 优先推送本地，不拉取覆盖
      queuePush();
      subscribeRemote();
    } else {
      const pulled = await pullRemote();
      subscribeRemote();
      if (pulled) setSyncStatus('已同步', 'ok');
      else queuePush(); // 云端为空（首次）→ 把本地推上去
    }
    renderAuthArea();
    render();
  } catch (e) {
    msg.textContent = '出错：' + (e.message || e);
  }
}

async function doLogout() {
  if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
  syncUser = null;
  setSyncStatus('未登录', '');
  renderAuthArea();
}

function saveState() {
  saveLocal();
  // 任何数据改动都标记"待同步"（seed 初始化除外），push 成功后再清除。
  // 这样无论页面何时关闭、是否登录、是否离线，本地改动都不会被云端覆盖丢失。
  if (!seeding) setOfflinePending(true);
  queuePush();
}

/* ---------- 工具 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

/* ---------- 自定义确认/提示弹窗（替代浏览器原生 confirm/alert，橙主题） ---------- */
function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const m = document.getElementById('modalRoot');
    if (!m) { resolve(true); return; }
    const requireText = opts.requireText || '';
    m.innerHTML = `
      <div class="modal-mask" onclick="if(event.target===this)window.__mbClose(false)">
        <div class="modal modal-confirm">
          <div class="mc-icon">${opts.icon || '🗑️'}</div>
          <div class="mc-msg">${escapeHtml(message)}</div>
          ${requireText ? `<input type="text" class="input" id="mcInput" placeholder="输入「${escapeHtml(requireText)}」以确认" oninput="window.__mbInputCheck()">` : ''}
          <div class="modal-actions" style="justify-content:center;">
            <button class="btn btn-ghost" onclick="window.__mbClose(false)">取消</button>
            <button class="btn btn-primary" id="mcConfirm" ${requireText ? 'disabled' : ''} onclick="window.__mbClose(true)">${escapeHtml(opts.confirmText || '确定')}</button>
          </div>
        </div>
      </div>`;
    window.__mbClose = v => {
      if (m) m.innerHTML = '';
      delete window.__mbClose;
      delete window.__mbInputCheck;
      resolve(v);
    };
    window.__mbInputCheck = () => {
      const inp = document.getElementById('mcInput');
      const btn = document.getElementById('mcConfirm');
      if (btn) btn.disabled = !inp || inp.value.trim() !== requireText;
    };
  });
}
function alertDialog(message, opts = {}) {
  return new Promise(resolve => {
    const m = document.getElementById('modalRoot');
    if (!m) { resolve(); return; }
    m.innerHTML = `
      <div class="modal-mask" onclick="if(event.target===this)window.__mbOk()">
        <div class="modal modal-confirm">
          <div class="mc-icon">${opts.icon || '✅'}</div>
          <div class="mc-msg">${escapeHtml(message)}</div>
          <div class="modal-actions" style="justify-content:center;">
            <button class="btn btn-primary" onclick="window.__mbOk()">知道了</button>
          </div>
        </div>
      </div>`;
    window.__mbOk = () => { m.innerHTML = ''; delete window.__mbOk; resolve(); };
  });
}
function promptDialog(message, defaultValue = '') {
  return new Promise(resolve => {
    const m = document.getElementById('modalRoot');
    if (!m) { resolve(null); return; }
    m.innerHTML = `
      <div class="modal-mask" onclick="if(event.target===this)window.__mbPrompt(null)">
        <div class="modal modal-confirm">
          <div class="mc-icon">✏️</div>
          <div class="mc-msg">${escapeHtml(message)}</div>
          <input type="text" class="input" id="mcPromptInput" value="${escapeHtml(defaultValue)}" onkeydown="if(event.key==='Enter')window.__mbPrompt(this.value)">
          <div class="modal-actions" style="justify-content:center;">
            <button class="btn btn-ghost" onclick="window.__mbPrompt(null)">取消</button>
            <button class="btn btn-primary" onclick="window.__mbPrompt(document.getElementById('mcPromptInput').value)">确定</button>
          </div>
        </div>
      </div>`;
    window.__mbPrompt = v => { m.innerHTML = ''; delete window.__mbPrompt; resolve(v); };
  });
}

function now() { return new Date(); }
function curMonth() { const d = now(); return { year: d.getFullYear(), month: d.getMonth() }; }
function curMonthStr() { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function todayStr() {
  const d = now();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${parseInt(m)}月${parseInt(d)}日`;
}
function fmtDateFull(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sameYM(s, ym) { return s && s.slice(0, 7) === ym; }
function greeting() {
  const h = now().getHours();
  if (h < 6) return ['🌙', '夜深了，注意休息'];
  if (h < 9) return ['🌅', '早上好'];
  if (h < 12) return ['☀️', '上午好'];
  if (h < 14) return ['🌞', '中午好'];
  if (h < 18) return ['⛅', '下午好'];
  if (h < 22) return ['🌆', '晚上好'];
  return ['🌙', '夜深了，注意休息'];
}

/* ---------- 导航 ---------- */
// 手机端底部导航固定入口（其余模块收进「更多」抽屉）
const MOBILE_NAV = [
  { key: 'dashboard', label: '概览',   ico: '▤' },
  { key: 'todos',     label: '今日',   ico: '✓' },
  { key: 'projects',  label: '项目',   ico: '📁' },
  { key: 'calendar',  label: '日历',   ico: '📅' },
  { key: 'culture',   label: '文化',   ico: '🎭' },
];
function setupMobileNav() {
  const nav = document.getElementById('mobileNav');
  if (nav) {
    nav.innerHTML = MOBILE_NAV.map(m =>
      `<button class="mn-item" data-key="${m.key}" onclick="switchModule('${m.key}')">
        <span class="mn-ico">${m.ico}</span><span class="mn-label">${m.label}</span>
      </button>`).join('') +
      `<button class="mn-item" onclick="openDrawer()">
        <span class="mn-ico">☰</span><span class="mn-label">更多</span>
      </button>`;
  }
  const panel = document.getElementById('drawerPanel');
  if (panel) {
    panel.innerHTML = `<div id="drawerAuth" class="drawer-auth"></div>
      <div class="theme-toggle" style="margin:0 0 10px;" onclick="toggleTheme()">
        <span id="themeIconDrawer">🌙</span> <span id="themeLabelDrawer">深色模式</span>
      </div>
      <div class="search-wrap search-wrap-drawer">
        <input class="search-input" id="drawerSearch" placeholder="🔍 搜索…" autocomplete="off" oninput="renderDrawerSearch()" onfocus="renderDrawerSearch()">
        <div class="search-results" id="drawerSearchResults"></div>
      </div>
      <div class="drawer-head">全部模块</div>` +
      NAV_GROUPS.map(g =>
        `<div class="drawer-group">${g.group}</div>` +
        g.items.map(m => `<button class="drawer-item" onclick="closeDrawer();switchModule('${m.key}')">${m.ico} ${m.label}</button>`).join('')
      ).join('');
  }
  updateMobileNav();
  renderAuthArea(); // 填充抽屉顶部的登录/同步入口
}
function updateMobileNav() {
  document.querySelectorAll('.mn-item[data-key]').forEach(el => {
    el.classList.toggle('active', el.dataset.key === state.activeModule);
  });
}
function openDrawer() { const m = document.getElementById('drawerMask'); if (m) m.classList.add('open'); }
function closeDrawer() { const m = document.getElementById('drawerMask'); if (m) m.classList.remove('open'); }
function dailyOpenCount() {
  return dailyTasks().filter(t => t.status !== '已完成').length;
}
function renderNav() {
  const nav = document.getElementById('nav');
  const badge = (k, n) => (n > 0 ? `<span class="nav-badge">${n}</span>` : '');
  const todoCount = todayTasks().length;
  let html = '';
  NAV_GROUPS.forEach(g => {
    html += `<div class="nav-group"><div class="nav-group-label">${g.group}</div>`;
    html += g.items.map(m => {
      let b = '';
      if (m.key === 'todos') b = badge('todos', todoCount);
      const active = state.activeModule === m.key ? 'active' : '';
      return `<button class="nav-item ${active}" onclick="switchModule('${m.key}')">
        <span class="ico">${m.ico}</span><span class="label">${m.label}</span>${b}
      </button>`;
    }).join('');
    html += `</div>`;
  });
  nav.innerHTML = html;
}

// 模块切换防护：600ms 内切到"不同"模块视为误触/幽灵点击，忽略。
// （正常操作不会 0.6 秒内连点两个不同导航；同模块重复点不受影响）
let lastSwitchKey = null;
let lastSwitchTime = 0;
function switchModule(key) {
  const t = Date.now();
  if (key !== lastSwitchKey && t - lastSwitchTime < 600) return;
  lastSwitchKey = key;
  lastSwitchTime = t;
  state.activeModule = key;
  // 多选状态属于单个视图，切换模块时清空，避免残留勾选框
  if (taskUI.multi.active) taskUI.multi = { view: null, active: false, sel: {} };
  saveState();
  render();
  window.scrollTo(0, 0); // 切换模块时回到顶部（新页面视角）
}

/* ---------- 主渲染分发 ---------- */
function scrollYNow() {
  if (typeof window.scrollY === 'number') return window.scrollY;
  const de = document.documentElement, b = document.body;
  return (de && de.scrollTop) || (b && b.scrollTop) || 0;
}
function restoreScroll(sy) {
  if (!sy) return;
  setTimeout(() => { try { window.scrollTo(0, sy); } catch (e) {} }, 0);
}
function render() {
  const sy = scrollYNow();
  renderNav();
  const main = document.getElementById('main');
  const map = {
    dashboard: renderDashboard,
    projects: renderProjects,
    todos: renderTodos,
    calendar: renderCalendar,
    progress: renderProgress,
    notes: renderNotes,
    culture: renderCulture,
    finance: renderFinance,
    fitness: renderFitness,
    habits: renderHabits,
    goals: renderGoals,
    literature: renderLiterature,
    backup: renderBackup,
    share: renderShare,
  };
  (map[state.activeModule] || renderDashboard)();
  updateMobileNav();
  restoreScroll(sy);
}

/* ============================================================
   概览 Dashboard
   ============================================================ */
/* ---------- 周 / 季度计划辅助 ---------- */
function ymd(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function weekStartOf(d) { const dt = new Date(d); dt.setDate(dt.getDate() - dt.getDay()); return ymd(dt); }
function weekEndOf(ws) { const dt = new Date(ws); dt.setDate(dt.getDate() + 6); return ymd(dt); }
function currentQuarter() { const d = new Date(); return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 }; }
function getWeeklyPlan() {
  const ws = weekStartOf(new Date());
  let w = state.weeklyPlans.find(x => x.weekStart === ws);
  if (!w) { w = { id: uid(), weekStart: ws, taskIds: [], items: [], mainId: null }; state.weeklyPlans.push(w); }
  return w;
}
function getQuarterlyPlan() {
  const { year, quarter } = currentQuarter();
  let qp = state.quarterlyPlans.find(x => x.year === year && x.quarter === quarter);
  if (!qp) { qp = { id: uid(), year, quarter, refs: [] }; state.quarterlyPlans.push(qp); }
  return qp;
}
function planUI() { return (state.__planUI = state.__planUI || { weekHistory: false, quarterHistory: false }); }
function refLabel(r) {
  // 新版：自由条目（手动名称 + 所属项目或个人）
  if (r.name !== undefined) {
    const p = r.projectId ? state.projects.find(x => x.id === r.projectId) : null;
    return `${escapeHtml(r.name)}${p ? ` <span class="badge b-orange" style="font-size:10px;">${escapeHtml(p.code)}</span>` : ' <span class="badge b-gray" style="font-size:10px;">个人</span>'}`;
  }
  // 旧版：引用既有 项目/任务组/任务
  if (r.type === 'project') { const p = state.projects.find(x => x.id === r.id); return p ? ('项目 · ' + p.code) : '已删除项目'; }
  if (r.type === 'group') { const g = state.tasks.find(x => x.id === r.id); const p = g ? state.projects.find(x => x.id === g.projectId) : null; return (g ? ('任务组 · ' + g.name) : '已删除') + (p ? ' (' + p.code + ')' : ''); }
  const t = state.tasks.find(x => x.id === r.id); const pr = t ? state.projects.find(x => x.id === t.projectId) : null;
  return (t ? ('任务 · ' + t.name) : '已删除') + (pr ? ' (' + pr.code + ')' : '');
}

function renderWeekPlanDash() {
  const w = getWeeklyPlan();
  const projOptions = state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.code)}</option>`).join('');
  // 周计划条目 = 独立自由条目(items) + 旧版引用的任务(taskIds，兼容历史数据)
  const weekList = [];
  (w.items || []).forEach(it => {
    const p = it.projectId ? state.projects.find(x => x.id === it.projectId) : null;
    const badge = it.type === 'project' ? (p ? { cls: 'b-orange', txt: p.code } : { cls: 'b-gray', txt: '已删项目' }) : { cls: 'b-gray', txt: '个人' };
    weekList.push({ id: it.id, name: it.name, done: !!it.done, badge, isTask: false });
  });
  w.taskIds.forEach(id => {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const p = t.projectId ? state.projects.find(x => x.id === t.projectId) : null;
    weekList.push({ id: t.id, name: t.name, done: t.status === '已完成', badge: p ? { cls: 'b-orange', txt: p.code } : { cls: 'b-gray', txt: '个人' }, isTask: true });
  });
  const items = weekList.map(it => {
    const isMain = w.mainId === it.id;
    const chk = `<span class="q-check" style="margin:0;${it.done ? 'background:var(--orange);border-color:var(--orange);' : ''}" onclick="${it.isTask ? `setTaskStatus('${it.id}','${it.done ? '未开始' : '已完成'}')` : `toggleWeekItem('${it.id}')`}"></span>`;
    return `<div class="plan-item">
      ${chk}
      <span class="plan-star ${isMain ? 'on' : ''}" title="设为本周唯一主交付" onclick="setWeekMain('${it.id}')">${isMain ? '★' : '☆'}</span>
      <span class="plan-name ${it.done ? 'done' : ''}">${escapeHtml(it.name)}</span>
      <span class="badge ${it.badge.cls}" style="font-size:10px;">${escapeHtml(it.badge.txt)}</span>
      <button class="plan-del" title="移除" onclick="removeWeekTask('${it.id}')">🗑️</button>
    </div>`;
  }).join('') || '<div class="empty" style="padding:10px;">本周还没安排任务</div>';

  const hist = state.weeklyPlans.filter(x => x.weekStart < w.weekStart)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const ui = planUI();
  const weekNames = (h) => {
    const names = [];
    (h.items || []).forEach(it => names.push(it.name + (it.done ? ' ✓' : '')));
    h.taskIds.forEach(id => { const t = state.tasks.find(x => x.id === id); if (t) names.push(t.name); });
    return names.length ? names.join('、') : '（空）';
  };
  const findName = (h, id) => {
    const it = (h.items || []).find(x => x.id === id); if (it) return it.name;
    const t = state.tasks.find(x => x.id === id); return t ? t.name : '';
  };
  const histHtml = hist.length ? `<div style="margin-top:8px;">
    <button class="f-btn ${ui.weekHistory ? 'active' : ''}" onclick="togglePlanHist('week')">历史周（${hist.length}）</button>
    ${ui.weekHistory ? hist.map(h => `<div class="hist-row"><b>${h.weekStart} ~ ${weekEndOf(h.weekStart)}</b>：${weekNames(h)}${h.mainId ? ' ｜ 主交付：' + findName(h, h.mainId) : ''}</div>`).join('') : ''}
  </div>` : '';

  return `
    <div class="card-head" style="padding:0 0 12px;border:none;display:flex;justify-content:space-between;align-items:center;">
      <h3>🗓️ 周计划</h3>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-3);">${w.weekStart} ~ ${weekEndOf(w.weekStart)}</span>
        <button class="btn btn-ghost btn-sm" onclick="focusPlanAdd('week')">+ 添加</button>
      </div>
    </div>
    ${items}
    <div id="weekAddBox" style="margin-top:10px;">
      <div class="ti-row">
        <input type="text" class="input" id="wkName" placeholder="本周整体计划？如：跑完 10 人数据…" maxlength="200" onkeydown="if(event.key==='Enter')addWeekTaskNew()">
        <select class="select" id="wkType" onchange="refreshWeekProject()">
          <option value="project">项目计划</option>
          <option value="personal">个人计划</option>
        </select>
      </div>
      <div class="ti-row" style="margin-bottom:0;">
        <select class="select" id="wkProject" onchange="refreshWeekProject()">${projOptions}</select>
        <button class="btn btn-primary btn-sm" onclick="addWeekTaskNew()">+ 添加</button>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:8px;">最多 5 项，★ 为本周唯一主交付；周计划条目独立保存，不会进入今日待做。</div>
    </div>
    ${histHtml}
  `;
}

function renderQuarterPlanDash() {
  const qp = getQuarterlyPlan();
  const projOptions = state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.code)}</option>`).join('');
  const items = qp.refs.map((r, i) => `<div class="plan-item">
    <span class="plan-name" style="flex:1;">${refLabel(r)}</span>
    <button class="plan-del" title="移除" onclick="removeQuarterRef(${i})">🗑️</button>
  </div>`).join('') || '<div class="empty" style="padding:10px;">本季度还没安排</div>';

  const hist = state.quarterlyPlans.filter(x => x.year < qp.year || (x.year === qp.year && x.quarter < qp.quarter))
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  const ui = planUI();
  const histHtml = hist.length ? `<div style="margin-top:8px;">
    <button class="f-btn ${ui.quarterHistory ? 'active' : ''}" onclick="togglePlanHist('quarter')">历史季度（${hist.length}）</button>
    ${ui.quarterHistory ? hist.map(h => `<div class="hist-row"><b>${h.year} Q${h.quarter}</b>${h.refs.length ? '：' + h.refs.map(r => refLabel(r)).join('、') : '（空）'}</div>`).join('') : ''}
  </div>` : '';

  return `
    <div class="card-head" style="padding:0 0 12px;border:none;display:flex;justify-content:space-between;align-items:center;">
      <h3>📊 季度计划</h3>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-3);">${qp.year} Q${qp.quarter}</span>
        <button class="btn btn-ghost btn-sm" onclick="focusPlanAdd('quarter')">+ 添加</button>
      </div>
    </div>
    ${items}
    <div id="quarterAddBox" style="margin-top:10px;">
      <div class="ti-row">
        <input type="text" class="input" id="qName" placeholder="本季度重点？输入名称回车添加…" maxlength="200" onkeydown="if(event.key==='Enter')addQuarterRefNew()">
        <select class="select" id="qType" onchange="refreshQuarterProject()">
          <option value="project">项目计划</option>
          <option value="personal">个人计划</option>
        </select>
      </div>
      <div class="ti-row" style="margin-bottom:0;">
        <select class="select" id="qProject" onchange="refreshQuarterProject()">${projOptions}</select>
        <button class="btn btn-primary btn-sm" onclick="addQuarterRefNew()">+ 添加</button>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:8px;">最多 5 项；自由条目：手动输入名称，选择所属项目或个人计划。</div>
    </div>
    ${histHtml}
  `;
}

function renderDashProjectTree() {
  if (!state.projects.length) return '<div class="empty">暂无项目</div>';
  return state.projects.map(p => {
    const open = !taskUI.collapsed['dash_' + p.id];
    const done = projDoneCount(p.id), total = projTotalCount(p.id);
    const recent = execTasks(p.id).filter(t => t.doneDate).sort((a, b) => b.doneDate.localeCompare(a.doneDate))[0];
    let body = '';
    if (open) {
      const groups = taskGroups(p.id);
      const rootExec = execTasks(p.id).filter(t => t.parentId === p.id);
      body += rootExec.map(t => dashTaskRow(t)).join('');
      groups.forEach(g => {
        const gOpen = !taskUI.collapsed['dash_' + g.id];
        const kids = childTasks(g.id);
        body += `<div class="tg">
          <div class="tg-head" onclick="toggleDashGroup('${g.id}')">
            <span class="tg-arrow">${gOpen ? '▾' : '▸'}</span>
            <span class="tg-name">${escapeHtml(g.name)}</span>
            <span class="tg-count">${kids.filter(k => k.status === '已完成').length}/${kids.length}</span>
          </div>
          ${gOpen ? `<div class="tg-body">${kids.map(t => dashTaskRow(t)).join('')}</div>` : ''}
        </div>`;
      });
    }
    return `<div class="dash-proj">
      <div class="dp-head">
        <span class="tg-arrow" onclick="toggleDashGroup('${p.id}')">${open ? '▾' : '▸'}</span>
        <span class="pc-code dp-code-link" onclick="goProject('${p.id}')" title="打开「${escapeHtml(p.title || p.code)}」项目详情">${escapeHtml(p.code)}</span>
        ${p.blocked ? '<span class="badge b-red">阻塞</span>' : ''}
        <span class="dp-sum" onclick="toggleDashGroup('${p.id}')" style="flex:1;cursor:pointer;">阶段：${escapeHtml(p.phase || '—')} · 下一步：${escapeHtml(p.nextStep || '—')} · 截止：${p.deadline ? fmtDate(p.deadline) : '—'} · 最近完成：${recent ? escapeHtml(recent.name) : '—'} · 已完成 ${done}/${total}</span>
      </div>
      ${body}
    </div>`;
  }).join('');
}
function dashTaskRow(t) {
  const done = t.status === '已完成';
  const p = state.projects.find(x => x.id === t.projectId);
  return `<div class="dash-task ${done ? 'done' : ''}">
    <span class="q-check" style="margin:0;${done ? 'background:var(--orange);border-color:var(--orange);' : ''}" onclick="setTaskStatus('${t.id}','${done ? '未开始' : '已完成'}')"></span>
    <span style="${done ? 'text-decoration:line-through;color:var(--text-3);' : ''}">${escapeHtml(t.name)}</span>
    ${quadBadge(t.quad)}
    ${p ? `<span class="badge b-orange" style="margin-left:auto;font-size:10px;">${escapeHtml(p.code)}</span>` : ''}
  </div>`;
}
function toggleDashGroup(id) { taskUI.collapsed['dash_' + id] = !taskUI.collapsed['dash_' + id]; render(); }
function togglePlanHist(which) { const ui = planUI(); ui[which + 'History'] = !ui[which + 'History']; render(); }
function refreshWeekProject() {
  const te = document.getElementById('wkType');
  const pje = document.getElementById('wkProject');
  if (te && pje) pje.disabled = te.value === 'personal';
}
async function addWeekTaskNew() {
  const name = document.getElementById('wkName').value.trim();
  if (!name) return;
  const type = document.getElementById('wkType').value;
  const projectId = type === 'project' ? document.getElementById('wkProject').value : null;
  if (type === 'project' && !projectId) { await alertDialog('请先选择所属项目', { icon: '⚠️' }); return; }
  const w = getWeeklyPlan();
  if ((w.items || []).length + w.taskIds.length >= 5) { await alertDialog('本周最多安排 5 项', { icon: '⚠️' }); return; }
  w.items.push({ id: uid(), name, type, projectId, done: false });
  saveState(); render();
}
function removeWeekTask(id) {
  const w = getWeeklyPlan();
  w.items = (w.items || []).filter(x => x.id !== id);
  w.taskIds = w.taskIds.filter(x => x !== id);
  if (w.mainId === id) w.mainId = null;
  saveState(); render();
}
function setWeekMain(id) { const w = getWeeklyPlan(); w.mainId = (w.mainId === id ? null : id); saveState(); render(); }
function toggleWeekItem(id) {
  const w = getWeeklyPlan();
  const it = (w.items || []).find(x => x.id === id);
  if (it) { it.done = !it.done; saveState(); render(); }
}
function refreshQuarterProject() {
  const te = document.getElementById('qType');
  const pje = document.getElementById('qProject');
  if (te && pje) pje.disabled = te.value === 'personal';
}
async function addQuarterRefNew() {
  const name = document.getElementById('qName').value.trim();
  if (!name) return;
  const type = document.getElementById('qType').value;
  const projectId = type === 'project' ? document.getElementById('qProject').value : null;
  if (type === 'project' && !projectId) { await alertDialog('请先选择所属项目', { icon: '⚠️' }); return; }
  const qp = getQuarterlyPlan();
  if (qp.refs.length >= 5) { await alertDialog('本季度最多安排 5 项', { icon: '⚠️' }); return; }
  qp.refs.push({ id: uid(), name, type, projectId });
  saveState(); render();
}
function removeQuarterRef(i) { const qp = getQuarterlyPlan(); qp.refs.splice(i, 1); saveState(); render(); }
function focusPlanAdd(which) {
  const box = document.getElementById(which === 'week' ? 'weekAddBox' : 'quarterAddBox');
  const sel = document.getElementById(which === 'week' ? 'wkName' : 'qName');
  if (box) {
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    box.style.background = 'var(--orange-lighter)';
    setTimeout(() => { box.style.background = ''; }, 600);
  }
  if (sel) setTimeout(() => sel.focus(), 120);
}

function renderDashboard() {
  const main = document.getElementById('main');
  const [geo, greet] = greeting();
  const activeProjects = state.projects.filter(p => p.status === '进行中').length;
  const openTodos = dailyOpenCount();
  const waitBlock = state.tasks.filter(t => t.status === '等待' || t.status === '阻塞').length;
  const doneToday = state.tasks.filter(t => t.doneDate === todayStr()).length;

  const todayTodos = todayTasks();
  const unschedCount = unscheduledTasks().length;
  const projOptions = state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.code)}</option>`).join('');
  const recentNotes = state.notes.slice(-4).reverse();

  main.innerHTML = `
    <div class="view-head">
      <div>
        <div class="view-title">${geo} ${greet}，Canming</div>
        <div class="view-sub">${fmtDateFull(todayStr())} · 今天也要稳稳推进</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><span class="stat-ico">📁</span><div class="stat-val">${state.projects.length}</div><div class="stat-label">项目总数（进行中 ${activeProjects}）</div></div>
      <div class="stat teal"><span class="stat-ico">✓</span><div class="stat-val">${openTodos}</div><div class="stat-label">未完成待做</div></div>
      <div class="stat blue"><span class="stat-ico">⏸</span><div class="stat-val">${waitBlock}</div><div class="stat-label">等待或阻塞事项</div></div>
      <div class="stat green"><span class="stat-ico">🏁</span><div class="stat-val">${doneToday}</div><div class="stat-label">今日已完成</div></div>
    </div>

    <div class="dash-3col">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 12px;border:none;display:flex;justify-content:space-between;align-items:center;">
          <h3>📋 今日待做</h3>
          <button class="btn btn-ghost btn-sm" onclick="toggleDashAdd()">+ 添加</button>
        </div>
        ${todayTodos.length ? todayTodos.map(t => {
          const p = state.projects.find(x => x.id === t.projectId);
          const done = t.status === '已完成';
          return `<div class="dash-list-item">
            <span class="q-check" style="margin:0;${done ? 'background:var(--orange);border-color:var(--orange);' : ''}" onclick="toggleTodo('${t.id}')"></span>
            <span style="${done ? 'text-decoration:line-through;color:var(--text-3);' : ''} flex:1;">${escapeHtml(t.name)}</span>
            ${quadBadge(t.quad)}
            ${p ? `<span class="badge b-orange">${escapeHtml(p.code)}</span>` : '<span class="badge b-gray">个人</span>'}
            <button class="dash-del" title="删除" onclick="delTask('${t.id}')">🗑️</button>
          </div>`;
        }).join('') : '<div class="empty"><span class="emoji">🎉</span>今天还没有安排任务</div>'}
        ${unschedCount ? `<div style="margin-top:10px;font-size:12px;color:var(--text-3);">${unschedCount} 项未排期 · <span onclick="switchModule('todos')" style="color:var(--orange);cursor:pointer;">去排期 →</span></div>` : ''}

        <div id="dashAddForm" style="display:none;margin-top:12px;border-top:1px dashed var(--border);padding-top:12px;">
          <div class="ti-row">
            <input type="text" class="input" id="dqName" placeholder="要做什么？回车添加…" maxlength="200">
            <select class="select" id="dqType" onchange="refreshDashParentOptions()">
              <option value="project">项目任务</option>
              <option value="personal">个人任务</option>
            </select>
          </div>
          <div class="ti-row">
            <select class="select" id="dqProject" onchange="refreshDashParentOptions()">${projOptions}</select>
            <select class="select" id="dqParent" disabled onchange="document.getElementById('dqNewGroup').style.display = this.value==='__new__'?'inline-block':'none'"></select>
            <input type="text" class="input" id="dqNewGroup" placeholder="新任务组" style="display:none;width:110px;">
          </div>
          <div class="ti-row">
            <input type="date" class="select" id="dqPlan" value="${todayStr()}">
            <input type="date" class="select" id="dqDue" title="截止日期">
            <select class="select" id="dqQuad">${quadOptions2('')}</select>
            <button class="btn btn-primary btn-sm" onclick="dashQuickAdd()">添加</button>
          </div>
        </div>
      </div>

      <div class="card card-pad">
        ${renderWeekPlanDash()}
      </div>

      <div class="card card-pad">
        ${renderQuarterPlanDash()}
      </div>
    </div>

    <div class="card card-pad" style="margin-top:18px;">
      <div class="card-head" style="padding:0 0 12px;border:none;display:flex;justify-content:space-between;align-items:center;">
        <h3>📁 项目进度（点击展开）</h3>
        <span style="font-size:12px;color:var(--text-3);">仅任务数量，不代表完成度</span>
      </div>
      ${renderDashProjectTree()}
    </div>

    <div class="card card-pad" style="margin-top:18px;">
      <div class="card-head" style="padding:0 0 12px;border:none;"><h3>📝 最近手账</h3></div>
      ${recentNotes.length ? recentNotes.map(n => `
        <div class="dash-list-item">
          <span class="badge b-gray">${n.type}</span>
          <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(n.content.slice(0, 40))}</span>
          <span style="color:var(--text-3);font-size:11.5px;">${fmtDateTime(n.createdAt)}</span>
        </div>`).join('') : '<div class="empty">还没有手账，去记一笔吧</div>'}
    </div>
  `;
  refreshDashParentOptions();
}

/* ============================================================
   项目
   ============================================================ */
/* ---------- 任务辅助 ---------- */
function projTasks(pid) { return state.tasks.filter(t => t.projectId === pid); }
function taskGroups(pid) { return state.tasks.filter(t => t.projectId === pid && t.level === 2); }
function childTasks(parentId) { return state.tasks.filter(t => t.parentId === parentId); }
function execTasks(pid) {
  return state.tasks.filter(t => t.projectId === pid && t.level === 3);
}
// 可作为待做展示的任务：只有个人任务 + 执行任务（level 3）。
// 任务组（level 2）是纯分类，永不进待做。
function dailyTasks() {
  return state.tasks.filter(t => t.type === 'personal' || t.level === 3);
}
// 今日待做：只显示计划执行日期 == 今天 的任务（不含未排期）
function todayTasks() {
  const td = todayStr();
  return dailyTasks().filter(t => t.status !== '已完成' && t.planDate === td);
}
function unscheduledTasks() {
  return dailyTasks().filter(t => t.status !== '已完成' && !t.planDate);
}
function upcomingTasks() {
  const td = todayStr();
  return dailyTasks().filter(t => t.status !== '已完成' && t.planDate && t.planDate > td)
    .sort((a, b) => a.planDate.localeCompare(b.planDate));
}
function overdueTasks() {
  const td = todayStr();
  return dailyTasks().filter(t => t.status !== '已完成' && t.planDate && t.planDate < td)
    .sort((a, b) => a.planDate.localeCompare(b.planDate));
}
// 渲染一个任务分组小节（今日 / 已逾期 / 即将到来 / 未排期）
function taskSection(title, arr) {
  if (!arr.length) return '';
  return `<div style="margin-bottom:18px;">
    <div class="sub-head">${title} <span class="muted">(${arr.length})</span></div>
    ${arr.map(t => execRow(t)).join('')}
  </div>`;
}
function projDoneCount(pid) {
  return execTasks(pid).filter(t => t.status === '已完成').length;
}
function projTotalCount(pid) {
  return execTasks(pid).length;
}
function statusClass(s) {
  return { '未开始': 'st-todo', '进行中': 'st-doing', '等待': 'st-wait',
           '阻塞': 'st-block', '已完成': 'st-done' }[s] || 'st-todo';
}
function quadBadge(q) {
  if (!q) return '';
  const m = { q1: ['q1', '紧急且重要'], q2: ['q2', '不紧急但重要'],
              q3: ['q3', '紧急不重要'], q4: ['q4', '不紧急不重要'] };
  const v = m[q]; if (!v) return '';
  return `<span class="q-tag ${v[0]}">${v[1]}</span>`;
}

function projProgress(p) {
  const total = projTotalCount(p.id);
  if (total === 0) return 0;
  return Math.round((projDoneCount(p.id) / total) * 100);
}

let taskUI = { collapsed: {}, multi: { view: null, active: false, sel: {} } };

function statusOptions(sel) {
  return ['未开始', '进行中', '等待', '阻塞', '已完成']
    .map(s => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
}
function projStatusOptions(sel) {
  return ['进行中', '待启动', '已完成', '暂停']
    .map(s => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
}
function quadOptions2(sel) {
  return [['', '（无）'], ['q1', '紧急且重要'], ['q2', '不紧急但重要'],
          ['q3', '紧急不重要'], ['q4', '不紧急不重要']]
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
}

function renderProjects() {
  const main = document.getElementById('main');
  const archived = state.projects.filter(p => p.status === '已完成');
  const active = state.projects.filter(p => p.status !== '已完成');
  if (!state.selectedProjectId && state.projects.length) {
    state.selectedProjectId = state.projects[0].id;
  }
  const sel = state.projects.find(p => p.id === state.selectedProjectId);
  const archOpen = taskUI.collapsed['__archive'] === true; // 默认折叠（undefined 视为折叠）

  const projCard = p => {
    const done = projDoneCount(p.id), total = projTotalCount(p.id);
    const act = p.id === state.selectedProjectId ? 'active' : '';
    return `<div class="proj-card ${act}" onclick="selectProject('${p.id}')">
      <div class="pc-top">
        <span class="pc-code">${escapeHtml(p.code)}</span>
        <span class="badge b-orange">${escapeHtml(p.label)}</span>
        ${p.blocked ? '<span class="badge b-red">阻塞</span>' : ''}
      </div>
      <div class="pc-title">${escapeHtml(p.title)}</div>
      <div class="pc-meta"><span>${escapeHtml(p.status)}</span><span class="pc-pct">已完成 ${done}/${total} 项</span></div>
      <div class="progress" style="margin-top:8px;"><div class="progress-fill" style="width:${projProgress(p)}%"></div></div>
    </div>`;
  };

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">项目</div><div class="view-sub">项目 → 任务组 → 执行任务（三级，数据唯一）</div></div>
      <button class="btn btn-primary" onclick="addProject()">+ 新建项目</button>
    </div>
    <div class="proj-layout">
      <div class="proj-list">
        ${active.map(projCard).join('') || '<div class="empty"><span class="emoji">📭</span>还没有进行中的项目</div>'}
        ${archived.length ? `
          <div class="proj-archive-head" onclick="toggleProjectArchive()">
            📦 已归档（${archived.length}）<span class="tg-arrow">${archOpen ? '▾' : '▸'}</span>
          </div>
          <div id="archiveList" style="${archOpen ? '' : 'display:none;'}">${archived.map(projCard).join('')}</div>` : ''}
      </div>
      <div class="proj-detail">
        ${sel ? renderProjectDetail(sel) : '<div class="empty"><span class="emoji">👈</span>选择左侧项目查看详情</div>'}
      </div>
    </div>
  `;
}
function toggleProjectArchive() {
  taskUI.collapsed['__archive'] = !taskUI.collapsed['__archive'];
  renderProjects();
}

function execRow(t) {
  const done = t.status === '已完成';
  const mchk = (multiOn('proj') || multiOn('todos')) ? `<input type="checkbox" class="mchk" ${taskUI.multi.sel[t.id] ? 'checked' : ''} onchange="multiToggle('${t.id}')" title="选择此项">` : '';
  const noteTip = t.note ? `备注：${escapeHtml(t.note)}` : '添加备注';
  return `<div class="exec ${done ? 'done' : ''}">
    ${mchk}
    <input type="checkbox" class="exec-chk" ${done ? 'checked' : ''} onchange="setTaskStatus('${t.id}', this.checked ? '已完成' : '未开始')">
    <input class="exec-name-input" value="${escapeHtml(t.name)}" title="${noteTip}" onchange="renameTask('${t.id}', this.value)" maxlength="160">
    ${t.note ? `<span class="note-dot" title="${noteTip}">💬</span>` : ''}
    <select class="exec-sel" onchange="setTaskField('${t.id}','status',this.value)">${statusOptions(t.status)}</select>
    <select class="exec-sel" onchange="setTaskField('${t.id}','quad',this.value)">${quadOptions2(t.quad)}</select>
    <input type="date" class="exec-date" value="${t.planDate || ''}" title="计划执行日期" onchange="setTaskField('${t.id}','planDate',this.value)">
    <input type="date" class="exec-date" value="${t.dueDate || ''}" title="截止日期" onchange="setTaskField('${t.id}','dueDate',this.value)">
    <button class="st-del" title="${noteTip}" onclick="editTaskNote('${t.id}')">${t.note ? '💬' : '📝'}</button>
    <button class="st-del" title="删除" onclick="delTask('${t.id}')">🗑️</button>
  </div>`;
}
function editTaskNote(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  const m = document.getElementById('modalRoot');
  if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)window.__tnClose()">
      <div class="modal" style="max-width:420px;">
        <h3>📝 任务备注</h3>
        <div class="modal-form">
          <textarea class="input" id="tnText" rows="4" placeholder="补充说明：具体要求、进展、相关链接…">${escapeHtml(t.note || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="window.__tnClose()">取消</button>
          <button class="btn btn-primary" onclick="window.__tnSave()">保存</button>
        </div>
      </div>
    </div>`;
  window.__tnClose = () => { m.innerHTML = ''; delete window.__tnClose; delete window.__tnSave; };
  window.__tnSave = () => {
    t.note = (document.getElementById('tnText').value || '').trim();
    saveState();
    window.__tnClose();
    if (state.activeModule === 'projects') renderProjects(); else render();
  };
}
function addExecRow(parentId) {
  return `<div class="exec add-row">
    <input class="exec-name-input" id="exec_${parentId}" placeholder="添加执行任务，回车确认…" maxlength="160" onkeydown="if(event.key==='Enter')addExecTask('${parentId}')">
    <button class="btn btn-ghost btn-sm" onclick="addExecTask('${parentId}')">+ 执行任务</button>
  </div>`;
}

function renderProjectDetail(p) {
  const done = projDoneCount(p.id), total = projTotalCount(p.id);
  const groups = taskGroups(p.id);
  const rootExec = execTasks(p.id).filter(t => t.parentId === p.id);

  let tree = '';
  if (groups.length === 0 && rootExec.length === 0) {
    tree = '<div class="empty" style="padding:18px;">还没有任务，先添加任务组或直接添加执行任务</div>';
  } else {
    const rootExecF = applyTaskFilterNP(rootExec);
    tree += rootExecF.map(t => execRow(t)).join('');
    groups.forEach(g => {
      const open = !taskUI.collapsed[g.id];
      const kids = applyTaskFilterNP(childTasks(g.id));
      tree += `
        <div class="tg">
          <div class="tg-head" onclick="toggleGroup('${g.id}')">
            ${multiOn('proj') ? `<input type="checkbox" class="mchk" ${taskUI.multi.sel[g.id] ? 'checked' : ''} onclick="event.stopPropagation();multiToggle('${g.id}')" title="选择任务组（连同子任务删除）">` : ''}
            <span class="tg-arrow">${open ? '▾' : '▸'}</span>
            <span class="tg-name">${escapeHtml(g.name)}</span>
            <span class="tg-count">${kids.filter(k => k.status === '已完成').length}/${kids.length}</span>
            <select class="exec-sel tg-status-sel" onclick="event.stopPropagation()" onchange="setTaskField('${g.id}','status',this.value)" title="任务组状态">${statusOptions(g.status)}</select>
            <button class="st-del" title="删除任务组" onclick="event.stopPropagation();delTask('${g.id}')">🗑️</button>
          </div>
          ${open ? `<div class="tg-body">
            ${kids.map(t => execRow(t)).join('')}
            ${addExecRow(g.id)}
          </div>` : ''}
        </div>`;
    });
  }

  return `
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="pc-code" style="font-size:18px;font-weight:800;font-family:Consolas,monospace;">${escapeHtml(p.code)}</span>
          <input class="input pd-label-input" list="labelPresets" value="${escapeHtml(p.label || '')}" onchange="setProjField('${p.id}','label',this.value)" placeholder="标签（长期/短期/重要）" title="项目标签，可自定义">
          <select class="exec-sel" onchange="setProjField('${p.id}','status',this.value)" title="项目状态">${projStatusOptions(p.status)}</select>
          ${p.blocked ? '<span class="badge b-red">阻塞</span>' : ''}
        </div>
        <button class="btn btn-danger-ghost btn-sm" onclick="delProject('${p.id}')">删除项目</button>
      </div>
      <input class="input" value="${escapeHtml(p.description || '')}" onchange="setProjField('${p.id}','description',this.value)" placeholder="项目简介（可选）" style="margin-bottom:10px;">
      <datalist id="labelPresets">
        <option value="长期"></option><option value="短期"></option><option value="重要"></option><option value="A1主攻"></option><option value="普通"></option>
      </datalist>

      <div class="proj-info">
        <label>当前阶段<input class="input" value="${escapeHtml(p.phase || '')}" onchange="setProjField('${p.id}','phase',this.value)" placeholder="如 数据分析确认"></label>
        <label>当前唯一下一步<input class="input" value="${escapeHtml(p.nextStep || '')}" onchange="setProjField('${p.id}','nextStep',this.value)" placeholder="如 建立待确认清单"></label>
        <label>截止节点<input type="date" class="select" value="${p.deadline || ''}" onchange="setProjField('${p.id}','deadline',this.value)"></label>
        <label class="cb">阻塞<input type="checkbox" ${p.blocked ? 'checked' : ''} onchange="setProjField('${p.id}','blocked',this.checked)"></label>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 6px;">
        <span style="font-size:13px;color:var(--text-2);font-weight:600;">任务计数：已完成 ${done} 项，共 ${total} 项（仅任务数量，不代表项目完成度）</span>
      </div>
      <div class="progress" style="margin-bottom:12px;"><div class="progress-fill" style="width:${projProgress(p)}%"></div></div>

      <div class="add-group-row">
        <input class="input" id="grp_${p.id}" placeholder="添加任务组（如 数据处理）…" maxlength="60" onkeydown="if(event.key==='Enter')addTaskGroup('${p.id}')">
        <button class="btn btn-ghost btn-sm" onclick="addTaskGroup('${p.id}')">+ 任务组</button>
        <button class="btn btn-ghost btn-sm" onclick="addExecTask('${p.id}')">+ 直接加执行任务</button>
      </div>

      <div class="tree-tools">
        ${multiBtn('proj')}
        ${multiBar('proj')}
      </div>
      <div id="taskTree" style="margin-top:10px;">${tree}</div>
    </div>
  `;
}

function resolveProjectId(parentId) {
  const t = state.tasks.find(x => x.id === parentId);
  if (t && t.level === 2) return t.projectId;
  if (state.projects.some(p => p.id === parentId)) return parentId;
  return null;
}
function addTaskGroup(pid) {
  const input = document.getElementById('grp_' + pid);
  const name = input.value.trim();
  if (!name) return;
  state.tasks.push({ id: uid(), name, type: 'project', projectId: pid, parentId: pid,
    level: 2, planDate: null, dueDate: null, quad: null, status: '未开始', note: '', doneDate: null });
  saveState();
  renderProjects();
}
function addExecTask(parentId) {
  const input = document.getElementById('exec_' + parentId);
  const name = input ? input.value.trim() : '';
  if (!name) return;
  const pid = resolveProjectId(parentId);
  if (!pid) return;
  state.tasks.push({ id: uid(), name, type: 'project', projectId: pid, parentId,
    level: 3, planDate: null, dueDate: null, quad: null, status: '未开始', note: '', doneDate: null });
  saveState();
  renderProjects();
}
function setTaskStatus(id, status) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  const wasDone = t.status === '已完成';
  t.status = status;
  t.doneDate = status === '已完成' ? todayStr() : null;
  saveState();
  if (status === '已完成' && !wasDone && t.type === 'project') { openProgressModal(id); return; }
  if (state.activeModule === 'projects') renderProjects(); else render();
}
function setTaskField(id, field, val) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  const wasDone = t.status === '已完成';
  t[field] = val;
  if (field === 'status') {
    t.doneDate = val === '已完成' ? todayStr() : null;
    // 只有执行任务（level 3）完成时才弹进度日志；任务组只是分类标记，不弹
    if (val === '已完成' && !wasDone && t.type === 'project' && t.level === 3) { openProgressModal(id); return; }
  }
  saveState();
  if (state.activeModule === 'projects') renderProjects(); else render();
}
function renameTask(id, name) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  t.name = name.trim() || t.name;
  saveState();
}
async function delTask(id) {
  if (!(await confirmDialog('删除该任务？若它是任务组，其下执行任务也会一并删除。', { icon: '🗑️' }))) return;
  state.tasks = state.tasks.filter(x => x.id !== id && x.parentId !== id);
  delete taskUI.collapsed[id];
  saveState();
  if (state.activeModule === 'projects') renderProjects(); else render();
}
/* ---------- 多选删除 ---------- */
function multiOn(view) { return taskUI.multi.active && taskUI.multi.view === view; }
function toggleMulti(view) {
  if (multiOn(view)) taskUI.multi = { view: null, active: false, sel: {} };
  else taskUI.multi = { view, active: true, sel: {} };
  if (state.activeModule === 'projects') renderProjects(); else render();
}
function multiToggle(id) {
  if (!taskUI.multi.active) return;
  if (taskUI.multi.sel[id]) delete taskUI.multi.sel[id];
  else taskUI.multi.sel[id] = true;
  if (state.activeModule === 'projects') renderProjects(); else render();
}
async function multiDelete(view) {
  const ids = Object.keys(taskUI.multi.sel);
  if (!ids.length) return;
  const gCnt = ids.filter(id => state.tasks.some(t => t.id === id && t.level === 2)).length;
  const willDel = state.tasks.filter(x => ids.includes(x.id) || ids.includes(x.parentId)).length;
  if (!(await confirmDialog(`删除选中的 ${ids.length} 项（${gCnt ? '含 ' + gCnt + ' 个任务组，' : ''}共影响 ${willDel} 条任务）？此操作不可撤销。`, { icon: '🗑️' }))) return;
  state.tasks = state.tasks.filter(x => !ids.includes(x.id) && !ids.includes(x.parentId));
  ids.forEach(id => delete taskUI.collapsed[id]);
  taskUI.multi = { view: null, active: false, sel: {} };
  saveState();
  if (state.activeModule === 'projects') renderProjects(); else render();
}
function multiBar(view) {
  if (!multiOn(view)) return '';
  const n = Object.keys(taskUI.multi.sel).length;
  return `<div class="multi-bar">
    <span>已选 <b>${n}</b> 项</span>
    <button class="btn btn-red btn-sm" onclick="multiDelete('${view}')">🗑️ 删除所选</button>
    <button class="btn btn-ghost btn-sm" onclick="toggleMulti('${view}')">取消</button>
  </div>`;
}
function multiBtn(view) {
  const on = multiOn(view);
  return `<button class="btn btn-ghost btn-sm" onclick="toggleMulti('${view}')">${on ? '✕ 退出多选' : '☑ 多选删除'}</button>`;
}
function toggleGroup(id) {
  taskUI.collapsed[id] = !taskUI.collapsed[id];
  renderProjects();
}
function setProjField(pid, field, val) {
  const p = state.projects.find(x => x.id === pid); if (!p) return;
  p[field] = val;
  saveState();
  renderProjects();
}
function selectProject(id) {
  state.selectedProjectId = id;
  saveState();
  renderProjects();
}
// 从概览"项目进度"跳转到项目页并定位到指定项目
function goProject(pid) {
  state.selectedProjectId = pid;
  state.activeModule = 'projects';
  if (taskUI.multi.active) taskUI.multi = { view: null, active: false, sel: {} };
  saveState();
  render();
  window.scrollTo(0, 0);
}

/* ---------- 全局搜索 ---------- */
function doSearch(kw) {
  kw = (kw || '').trim().toLowerCase();
  if (!kw) return [];
  const hit = (...vals) => vals.some(v => (v || '').toLowerCase().includes(kw));
  const out = [];
  state.projects.forEach(p => {
    if (hit(p.code, p.title, p.label, p.description)) {
      out.push({ ico: '📁', type: '项目', text: `${p.code} ${p.title || ''}`, sub: p.status, go: 'project', id: p.id });
    }
  });
  state.tasks.forEach(t => {
    if (hit(t.name, t.note)) {
      const p = state.projects.find(x => x.id === t.projectId);
      out.push({ ico: '✓', type: t.level === 2 ? '任务组' : '任务', text: t.name, sub: p ? p.code : '个人', go: p ? 'project' : 'module', id: p ? p.id : 'todos' });
    }
  });
  state.notes.forEach(n => {
    if (hit(n.content, n.type)) {
      out.push({ ico: '📝', type: '笔记', text: n.content.slice(0, 50), sub: n.type, go: 'module', id: 'notes' });
    }
  });
  state.literature.forEach(l => {
    if (hit(l.title, l.authors, l.journal, l.doi, l.conclusion)) {
      out.push({ ico: '📚', type: '文献', text: l.title, sub: l.authors, go: 'module', id: 'literature' });
    }
  });
  state.goals.forEach(g => {
    if (hit(g.title)) {
      out.push({ ico: '🎯', type: '目标', text: g.title, sub: g.status, go: 'module', id: 'goals' });
    }
  });
  state.cultural.forEach(c => {
    if (hit(c.name)) {
      out.push({ ico: '🎭', type: '文化', text: c.name, sub: c.type, go: 'module', id: 'culture' });
    }
  });
  return out.slice(0, 20);
}
function renderSearchTo(input, box) {
  const kw = (input.value || '').trim();
  if (!kw) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const results = doSearch(kw);
  window.__lastSearchResults = results;
  if (!results.length) { box.innerHTML = '<div class="sr-empty">无匹配结果</div>'; box.style.display = 'block'; return; }
  box.innerHTML = results.map((r, i) => `
    <div class="sr-item" onclick="goSearchItem(${i})">
      <span class="sr-ico">${r.ico}</span>
      <div class="sr-body"><div class="sr-text">${escapeHtml(r.text)}</div><div class="sr-sub">${r.type}${r.sub ? ' · ' + escapeHtml(r.sub) : ''}</div></div>
    </div>`).join('');
  box.style.display = 'block';
}
function renderSearchResults() {
  const input = document.getElementById('globalSearch');
  const box = document.getElementById('searchResults');
  if (input && box) renderSearchTo(input, box);
}
function renderDrawerSearch() {
  const input = document.getElementById('drawerSearch');
  const box = document.getElementById('drawerSearchResults');
  if (input && box) renderSearchTo(input, box);
}
function goSearchItem(i) {
  const r = (window.__lastSearchResults || [])[i];
  if (!r) return;
  if (r.go === 'project') goProject(r.id);
  else switchModule(r.id);
  const gs = document.getElementById('globalSearch'); if (gs) gs.value = '';
  const ds = document.getElementById('drawerSearch'); if (ds) ds.value = '';
  const sr = document.getElementById('searchResults'); if (sr) { sr.innerHTML = ''; sr.style.display = 'none'; }
  const dr = document.getElementById('drawerSearchResults'); if (dr) { dr.innerHTML = ''; dr.style.display = 'none'; }
  closeDrawer();
}

function addProject() {
  const m = document.getElementById('modalRoot');
  if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)window.__pfClose()">
      <div class="modal" style="max-width:400px;">
        <h3>📁 新建项目</h3>
        <div class="modal-form">
          <input class="input" id="pfCode" placeholder="项目代号（必填，如 IOC_MDD）" maxlength="20">
          <input class="input" id="pfTitle" placeholder="项目中文名（必填）" maxlength="40">
          <input class="input" id="pfLabel" placeholder="标签（如 A1主攻 / 长期 / 重要）" value="普通" maxlength="20">
          <select class="select" id="pfStatus">
            <option>进行中</option><option>待启动</option><option>已完成</option><option>暂停</option>
          </select>
          <input class="input" id="pfDesc" placeholder="一句话描述（可选）" maxlength="100">
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="window.__pfClose()">取消</button>
          <button class="btn btn-primary" onclick="window.__pfSubmit()">创建</button>
        </div>
      </div>
    </div>`;
  window.__pfClose = () => { m.innerHTML = ''; delete window.__pfClose; delete window.__pfSubmit; };
  window.__pfSubmit = () => {
    const cEl = document.getElementById('pfCode');
    const tEl = document.getElementById('pfTitle');
    const code = (cEl.value || '').trim();
    const title = (tEl.value || '').trim();
    let bad = false;
    if (!code) { cEl.style.borderColor = '#e5484d'; bad = true; } else cEl.style.borderColor = '';
    if (!title) { tEl.style.borderColor = '#e5484d'; bad = true; } else tEl.style.borderColor = '';
    if (bad) return;
    const label = (document.getElementById('pfLabel').value || '').trim() || '普通';
    const status = document.getElementById('pfStatus').value || '进行中';
    const description = (document.getElementById('pfDesc').value || '').trim();
    const p = {
      id: uid(), code, title, label, status, description,
      phase: '', nextStep: '', deadline: null, blocked: false,
    };
    state.projects.push(p);
    state.selectedProjectId = p.id;
    saveState();
    renderProjects();
    window.__pfClose();
  };
}

async function delProject(pid) {
  if (!(await confirmDialog('确定删除该项目？其下所有任务组与执行任务也会删除。', { icon: '🗑️' }))) return;
  state.projects = state.projects.filter(p => p.id !== pid);
  state.tasks = state.tasks.filter(t => t.projectId !== pid);
  if (state.selectedProjectId === pid) state.selectedProjectId = null;
  saveState();
  renderProjects();
}

/* ============================================================
   今日待做（统一任务入口；四象限为可选标签）
   ============================================================ */
function refreshParentOptions() {
  const type = document.getElementById('todoType').value;
  const projSel = document.getElementById('todoProject');
  const parentSel = document.getElementById('todoParent');
  const newGrp = document.getElementById('todoNewGroup');
  if (type !== 'project' || !projSel.value) {
    parentSel.disabled = true;
    if (newGrp) newGrp.style.display = 'none';
    return;
  }
  parentSel.disabled = false;
  const groups = taskGroups(projSel.value);
  parentSel.innerHTML = `<option value="">（直接挂在项目下）</option>`
    + groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')
    + `<option value="__new__">＋ 新建任务组…</option>`;
  if (newGrp) newGrp.style.display = 'none';
}

function applyTaskFilter(arr) {
  const f = state.taskFilter || {};
  return arr.filter(t => {
    if (f.project && f.project !== 'all' && t.projectId !== f.project) return false;
    if (f.quad && f.quad !== 'all' && t.quad !== f.quad) return false;
    if (f.status && f.status !== 'all' && t.status !== f.status) return false;
    if (f.dueFrom && (!t.dueDate || t.dueDate < f.dueFrom)) return false;
    if (f.dueTo && (!t.dueDate || t.dueDate > f.dueTo)) return false;
    return true;
  });
}
// 项目详情树专用：复用全局筛选的 象限/状态/截止 条件，但不受「项目」条件限制
function applyTaskFilterNP(arr) {
  const f = state.taskFilter || {};
  return arr.filter(t => {
    if (f.quad && f.quad !== 'all' && t.quad !== f.quad) return false;
    if (f.status && f.status !== 'all' && t.status !== f.status) return false;
    if (f.dueFrom && (!t.dueDate || t.dueDate < f.dueFrom)) return false;
    if (f.dueTo && (!t.dueDate || t.dueDate > f.dueTo)) return false;
    return true;
  });
}
function taskFilterBar() {
  const f = state.taskFilter || {};
  const projOptions = `<option value="all">全部项目</option>` + state.projects.map(p => `<option value="${p.id}" ${f.project === p.id ? 'selected' : ''}>${escapeHtml(p.code)}</option>`).join('');
  return `<div class="lit-filter card card-pad" style="margin-bottom:14px;">
    <select class="select" onchange="setTaskFilter('project',this.value)">${projOptions}</select>
    <select class="select" onchange="setTaskFilter('quad',this.value)">${quadOptions2(f.quad || '')}</select>
    <select class="select" onchange="setTaskFilter('status',this.value)">
      <option value="all" ${f.status === 'all' ? 'selected' : ''}>全部状态</option>
      ${['未开始', '进行中', '等待', '阻塞', '已完成'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <input type="date" class="select" value="${f.dueFrom || ''}" title="截止日期 起" onchange="setTaskFilter('dueFrom',this.value)">
    <span style="color:var(--text-3);align-self:center;">~</span>
    <input type="date" class="select" value="${f.dueTo || ''}" title="截止日期 止" onchange="setTaskFilter('dueTo',this.value)">
    <button class="btn btn-ghost btn-sm" onclick="resetTaskFilter()">清除筛选</button>
  </div>`;
}
function setTaskFilter(field, val) { state.taskFilter[field] = val; saveState(); render(); }
function resetTaskFilter() { state.taskFilter = { project: 'all', quad: 'all', status: 'all', dueFrom: '', dueTo: '' }; saveState(); render(); }

function renderTodos() {
  const main = document.getElementById('main');
  const projOptions = state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.code)}</option>`).join('');
  const quadOptions = quadOptions2('');
  const today = todayStr();

  const todayL = applyTaskFilter(todayTasks());
  const odL = applyTaskFilter(overdueTasks());
  const upL = applyTaskFilter(upcomingTasks());
  const unschL = applyTaskFilter(unscheduledTasks());

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">今日待做</div><div class="view-sub">仅显示计划日期 = 今天的任务；其余按 已逾期 / 即将到来 / 未排期 分组，数据同一份</div></div>
      ${multiBtn('todos')}
    </div>

    ${taskFilterBar()}

    ${multiBar('todos')}

    <div class="todo-input-card card card-pad">
      <div class="ti-row">
        <input type="text" class="input" id="todoName" placeholder="要做什么？回车添加…" maxlength="200">
        <select class="select" id="todoType" onchange="refreshParentOptions()">
          <option value="project">项目任务</option>
          <option value="personal">个人任务</option>
        </select>
      </div>
      <div class="ti-row">
        <select class="select" id="todoProject" onchange="refreshParentOptions()">${projOptions}</select>
        <select class="select" id="todoParent" disabled></select>
        <input type="text" class="input" id="todoNewGroup" placeholder="新任务组名称" style="display:none;width:120px;">
      </div>
      <div class="ti-row">
        <input type="date" class="select" id="todoPlan" value="${today}" title="计划执行日期">
        <input type="date" class="select" id="todoDue" title="截止日期">
        <select class="select" id="todoQuad">${quadOptions}</select>
        <button class="btn btn-primary" onclick="addTodo()">添加</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-top:16px;">
      ${taskSection('📅 今日待做', todayL)}
      ${taskSection('⏳ 已逾期', odL)}
      ${taskSection('🗓️ 即将到来', upL)}
      ${taskSection('📌 未排期（需指定计划日期）', unschL)}
      ${!todayL.length && !odL.length && !upL.length && !unschL.length ? '<div class="empty" style="padding:18px;">没有符合筛选条件的任务</div>' : ''}
    </div>
  `;

  document.getElementById('todoParent').addEventListener('change', e => {
    const ng = document.getElementById('todoNewGroup');
    if (ng) ng.style.display = e.target.value === '__new__' ? 'inline-block' : 'none';
  });
  const ti = document.getElementById('todoName');
  ti.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
  refreshParentOptions();
}

async function addTodo() {
  const name = document.getElementById('todoName').value.trim();
  if (!name) return;
  const type = document.getElementById('todoType').value;
  const projectId = type === 'project' ? document.getElementById('todoProject').value : null;
  let parentId = type === 'project' ? document.getElementById('todoParent').value : null;
  const planDate = document.getElementById('todoPlan').value || null;
  const dueDate = document.getElementById('todoDue').value || null;
  const quad = document.getElementById('todoQuad').value || null;
  if (type === 'project' && !projectId) { await alertDialog('请先选择所属项目', { icon: '⚠️' }); return; }

  if (type === 'project' && parentId === '__new__') {
    const gname = (document.getElementById('todoNewGroup').value || '').trim();
    if (!gname) { await alertDialog('请输入新任务组名称', { icon: '⚠️' }); return; }
    const g = { id: uid(), name: gname, type: 'project', projectId, parentId: projectId,
      level: 2, planDate: null, dueDate: null, quad: null, status: '未开始', note: '', doneDate: null };
    state.tasks.push(g);
    parentId = g.id;
  }
  const finalParent = (type === 'project' && parentId && parentId !== '__new__') ? parentId : projectId;
  state.tasks.push({
    id: uid(), name, type, projectId: type === 'project' ? projectId : null,
    parentId: type === 'project' ? finalParent : null, level: 3,
    planDate, dueDate, quad, status: '未开始', note: '', doneDate: null,
  });
  saveState();
  renderTodos();
}

function toggleTodo(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = t.status === '已完成' ? '未开始' : '已完成';
  t.doneDate = t.status === '已完成' ? todayStr() : null;
  saveState();
  render();
}

function delTodo(id) { delTask(id); }

/* ---------- 概览首页快速添加 ---------- */
function toggleDashAdd() {
  const f = document.getElementById('dashAddForm');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}
function refreshDashParentOptions() {
  const pe = document.getElementById('dqParent');
  const te = document.getElementById('dqType');
  const pje = document.getElementById('dqProject');
  if (!pe || !te || !pje) return;
  if (te.value === 'personal') { pe.disabled = true; pe.innerHTML = ''; return; }
  pe.disabled = false;
  const groups = taskGroups(pje.value);
  let html = `<option value="">（直接挂在项目下）</option>`;
  html += groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  html += `<option value="__new__">＋ 新建任务组…</option>`;
  pe.innerHTML = html;
  const ng = document.getElementById('dqNewGroup');
  if (ng) { ng.style.display = 'none'; ng.value = ''; }
  const nm = document.getElementById('dqName');
  if (nm) nm.onkeydown = e => { if (e.key === 'Enter') dashQuickAdd(); };
}
async function dashQuickAdd() {
  const name = document.getElementById('dqName').value.trim();
  if (!name) return;
  const type = document.getElementById('dqType').value;
  const projectId = type === 'project' ? document.getElementById('dqProject').value : null;
  let parentId = type === 'project' ? document.getElementById('dqParent').value : null;
  const planDate = document.getElementById('dqPlan').value || null;
  const dueDate = document.getElementById('dqDue').value || null;
  const quad = document.getElementById('dqQuad').value || null;
  if (type === 'project' && !projectId) { await alertDialog('请先选择所属项目', { icon: '⚠️' }); return; }
  if (type === 'project' && parentId === '__new__') {
    const gname = (document.getElementById('dqNewGroup').value || '').trim();
    if (!gname) { await alertDialog('请输入新任务组名称', { icon: '⚠️' }); return; }
    const g = { id: uid(), name: gname, type: 'project', projectId, parentId: projectId,
      level: 2, planDate: null, dueDate: null, quad: null, status: '未开始', note: '', doneDate: null };
    state.tasks.push(g);
    parentId = g.id;
  }
  const finalParent = (type === 'project' && parentId && parentId !== '__new__') ? parentId : projectId;
  state.tasks.push({
    id: uid(), name, type, projectId: type === 'project' ? projectId : null,
    parentId: type === 'project' ? finalParent : null, level: 3,
    planDate, dueDate, quad, status: '未开始', note: '', doneDate: null,
  });
  saveState();
  render();
}

/* ============================================================
   日历 / 日程
   ============================================================ */
function renderCalendar() {
  const main = document.getElementById('main');
  const { year, month } = state.calMonth;
  if (!state.calSelDay) state.calSelDay = todayStr();

  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const evtDays = new Set(state.calEvents.map(e => e.date));
  const planDays = new Set(state.tasks.filter(t => t.planDate).map(t => t.planDate));
  const dueDays = new Set(state.tasks.filter(t => t.dueDate).map(t => t.dueDate));
  const t = now();
  const isCur = t.getFullYear() === year && t.getMonth() === month;

  let cells = '';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(d => cells += `<div class="cal-dow">${d}</div>`);
  for (let i = startDow - 1; i >= 0; i--) cells += `<div class="cal-day other">${prevDays - i}</div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = [
      isCur && d === t.getDate() ? 'today' : '',
      ds === state.calSelDay ? 'sel' : '',
      (evtDays.has(ds) || planDays.has(ds) || dueDays.has(ds)) ? 'has-evt' : '',
    ].join(' ');
    const hp = planDays.has(ds), hd = dueDays.has(ds), he = evtDays.has(ds);
    cells += `<div class="cal-day ${cls}" onclick="selDay('${ds}')">${d}<span class="cal-dots">${hp ? '<i class="cdot plan"></i>' : ''}${hd ? '<i class="cdot due"></i>' : ''}${he ? '<i class="cdot evt"></i>' : ''}</span></div>`;
  }
  const total = startDow + days;
  const fill = (7 - (total % 7)) % 7;
  for (let d = 1; d <= fill; d++) cells += `<div class="cal-day other">${d}</div>`;

  const dayEvents = state.calEvents.filter(e => e.date === state.calSelDay).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayPlan = state.tasks.filter(t => t.planDate === state.calSelDay);
  const dayDue = state.tasks.filter(t => t.dueDate === state.calSelDay);

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">日历</div><div class="view-sub">点击日期添加日程安排</div></div>
    </div>
    <div class="cal-layout">
      <div class="card card-pad">
        <div class="cal-head">
          <div class="cal-title">${year}年${month + 1}月</div>
          <div class="cal-nav">
            <button onclick="calShift(-1)">‹</button>
            <button onclick="calToday()">今</button>
            <button onclick="calShift(1)">›</button>
          </div>
        </div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="card card-pad">
        <div class="cal-head"><div class="cal-title">${fmtDateFull(state.calSelDay)} 的日程</div></div>
      <div id="dayEvents">
        ${dayPlan.length ? `<div class="cal-sec-title">🟧 计划执行（${dayPlan.length}）</div>` + dayPlan.map(t => {
          const p = state.projects.find(x => x.id === t.projectId);
          return `<div class="fin-row">
            <span class="badge b-orange">${p ? escapeHtml(p.code) : '个人'}</span>
            <div style="flex:1;"><div class="fr-note ${t.status === '已完成' ? 'done' : ''}">${escapeHtml(t.name)}</div></div>
            <button class="fr-del" onclick="delTask('${t.id}')">🗑️</button>
          </div>`;
        }).join('') : ''}
        ${dayDue.length ? `<div class="cal-sec-title">🔴 截止（${dayDue.length}）</div>` + dayDue.map(t => {
          const p = state.projects.find(x => x.id === t.projectId);
          return `<div class="fin-row">
            <span class="badge b-red">${p ? escapeHtml(p.code) : '个人'}</span>
            <div style="flex:1;"><div class="fr-note ${t.status === '已完成' ? 'done' : ''}">${escapeHtml(t.name)}</div></div>
            <button class="fr-del" onclick="delTask('${t.id}')">🗑️</button>
          </div>`;
        }).join('') : ''}
        ${dayEvents.length ? `<div class="cal-sec-title">📌 日程（${dayEvents.length}）</div>` + dayEvents.map(e => `<div class="fin-row">
          <span class="badge b-teal">${e.time || '全天'}</span>
          <div style="flex:1;"><div class="fr-note">${escapeHtml(e.title)}</div>${e.note ? `<div class="fr-date">${escapeHtml(e.note)}</div>` : ''}</div>
          <button class="fr-del" onclick="delEvent('${e.id}')">🗑️</button>
        </div>`).join('') : ''}
        ${!dayPlan.length && !dayDue.length && !dayEvents.length ? '<div class="empty" style="padding:18px;">这一天还没有安排</div>' : ''}
      </div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <input type="time" class="select" id="evtTime">
          <input type="text" class="input" id="evtTitle" placeholder="日程内容…" maxlength="120">
          <button class="btn btn-ghost btn-sm" onclick="addEvent()">添加</button>
        </div>
      </div>
    </div>
  `;

  const et = document.getElementById('evtTitle');
  et.addEventListener('keydown', e => { if (e.key === 'Enter') addEvent(); });
}

function calShift(d) {
  let { year, month } = state.calMonth;
  month += d;
  if (month < 0) { month = 11; year--; }
  else if (month > 11) { month = 0; year++; }
  state.calMonth = { year, month };
  saveState();
  renderCalendar();
}
function calToday() {
  state.calMonth = curMonth();
  state.calSelDay = todayStr();
  saveState();
  renderCalendar();
}
function selDay(ds) {
  state.calSelDay = ds;
  saveState();
  renderCalendar();
}
function addEvent() {
  const title = document.getElementById('evtTitle').value.trim();
  if (!title) return;
  const time = document.getElementById('evtTime').value || '';
  state.calEvents.push({ id: uid(), title, date: state.calSelDay, time, note: '' });
  saveState();
  renderCalendar();
}
function delEvent(id) {
  state.calEvents = state.calEvents.filter(e => e.id !== id);
  saveState();
  renderCalendar();
}

/* ============================================================
   笔记手账
   ============================================================ */
function renderNotes() {
  const main = document.getElementById('main');
  const filters = ['all', ...NOTE_TYPES];
  const typeOptions = NOTE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');

  const list = state.noteFilter === 'all'
    ? state.notes.slice().reverse()
    : state.notes.filter(n => n.type === state.noteFilter).slice().reverse();

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">笔记手账</div><div class="view-sub">灵感、吐槽、随笔、备忘，all-in-one</div></div>
    </div>

    <div class="note-compose">
      <textarea class="textarea" id="noteContent" rows="3" placeholder="想到什么写什么…"></textarea>
      <div style="display:flex;gap:8px;align-items:center;">
        <select class="select" id="noteType">${typeOptions}</select>
        <button class="btn btn-primary btn-sm" onclick="addNote()">记一笔</button>
        <span style="color:var(--text-3);font-size:12px;margin-left:auto;">Ctrl+Enter 快速记录</span>
      </div>
    </div>

    <div class="filter-row">
      ${filters.map(f => `<button class="f-btn ${state.noteFilter === f ? 'active' : ''}" onclick="setNoteFilter('${f}')">${f === 'all' ? '全部' : f}</button>`).join('')}
    </div>

    <div class="note-feed">
      ${list.map(n => `
        <div class="note-entry t-${n.type}">
          <div class="ne-top">
            <div><span class="badge b-gray">${n.type}</span></div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="ne-time">${fmtDateTime(n.createdAt)}</span>
              <button class="ne-del" onclick="delNote('${n.id}')">🗑️</button>
            </div>
          </div>
          <div class="ne-text">${escapeHtml(n.content)}</div>
        </div>`).join('') || '<div class="empty"><span class="emoji">📝</span>还没有手账，写第一笔吧</div>'}
    </div>
  `;

  const ta = document.getElementById('noteContent');
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
  });
}

function setNoteFilter(f) {
  state.noteFilter = f;
  saveState();
  renderNotes();
}
function addNote() {
  const ta = document.getElementById('noteContent');
  const content = ta.value.trim();
  if (!content) return;
  const type = document.getElementById('noteType').value;
  state.notes.push({ id: uid(), content, type, createdAt: Date.now() });
  saveState();
  renderNotes();
}
function delNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  saveState();
  renderNotes();
}

/* ============================================================
   记账
   ============================================================ */
function renderFinance() {
  const main = document.getElementById('main');
  state.finF = state.finF || { from: '', to: '', cat: 'all', src: 'all' };
  const f = state.finF;
  const items = finFiltered();
  const exp = items.filter(x => x.type === 'expense');
  const daily = exp.filter(x => x.cat !== 'big').reduce((s, x) => s + x.amount, 0);
  const big = exp.filter(x => x.cat === 'big').reduce((s, x) => s + x.amount, 0);
  const income = items.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0);
  const catBadge = c => c === 'big' ? '<span class="badge b-teal">大额花销</span>' : '<span class="badge b-orange">日常花销</span>';

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">记账</div><div class="view-sub">支出分 日常/大额，收入记来源，支持日期段与来源筛选</div></div>
    </div>

    <div class="card card-pad" style="margin-bottom:16px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input type="date" class="select" id="finFrom" value="${f.from}" title="起始日期">
        <span style="color:var(--text-3);">~</span>
        <input type="date" class="select" id="finTo" value="${f.to}" title="结束日期">
        <select class="select" id="finCatF" style="width:135px;" onchange="finApplyFilter()">
          <option value="all" ${f.cat === 'all' ? 'selected' : ''}>支出：全部</option>
          <option value="daily" ${f.cat === 'daily' ? 'selected' : ''}>支出：日常花销</option>
          <option value="big" ${f.cat === 'big' ? 'selected' : ''}>支出：大额花销</option>
        </select>
        <select class="select" id="finSrcF" style="width:135px;" onchange="finApplyFilter()">
          <option value="all" ${f.src === 'all' ? 'selected' : ''}>收入：全部来源</option>
          <option value="爸爸" ${f.src === '爸爸' ? 'selected' : ''}>收入：爸爸</option>
          <option value="妈妈" ${f.src === '妈妈' ? 'selected' : ''}>收入：妈妈</option>
          <option value="其他" ${f.src === '其他' ? 'selected' : ''}>收入：其他</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="finQuick('month')">本月</button>
        <button class="btn btn-ghost btn-sm" onclick="finQuick('3m')">近3月</button>
        <button class="btn btn-ghost btn-sm" onclick="finQuick('year')">今年</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="finClearFilter()">清除</button>
      </div>
    </div>

    <div class="fin-summary">
      <div class="card fin-card"><div class="fc-val" style="color:var(--orange-dark);">¥${daily.toFixed(2)}</div><div class="fc-label">日常花销</div></div>
      <div class="card fin-card"><div class="fc-val" style="color:var(--teal);">¥${big.toFixed(2)}</div><div class="fc-label">大额花销</div></div>
      <div class="card fin-card"><div class="fc-val" style="color:var(--green);">¥${income.toFixed(2)}</div><div class="fc-label">收入</div></div>
      <div class="card fin-card"><div class="fc-val" style="color:var(--orange-dark);">¥${(income - daily - big).toFixed(2)}</div><div class="fc-label">结余</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-3);margin:-10px 0 16px;">统计范围：${f.from ? fmtDate(f.from) : '最早'} ~ ${f.to ? fmtDate(f.to) : '今天'}${f.cat !== 'all' ? ' · 仅' + (f.cat === 'big' ? '大额' : '日常') + '支出' : ''}${f.src !== 'all' ? ' · 仅「' + escapeHtml(f.src) + '」收入' : ''}</div>

    <div class="card card-pad">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <select class="select" id="finType" onchange="finFormSwitch()">
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <input type="number" class="input" id="finAmount" placeholder="金额" step="0.01" style="width:110px;">
        <input type="date" class="select" id="finDate" value="${todayStr()}">
        <input type="text" class="input" id="finNote" placeholder="备注（可选）" maxlength="60" style="flex:1;min-width:120px;">
        <button class="btn btn-primary btn-sm" onclick="addFin()">记一笔</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select class="select" id="finCat" style="width:200px;">
          <option value="daily">日常花销（吃饭/通勤等）</option>
          <option value="big">大额花销（购物/电影等）</option>
        </select>
        <div id="finSrcBox" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;">
          <select class="select" id="finSource" style="width:110px;" onchange="finSrcSwitch()">
            <option value="爸爸">爸爸</option>
            <option value="妈妈">妈妈</option>
            <option value="其他">其他…</option>
          </select>
          <input type="text" class="input" id="finSourceCustom" placeholder="填写来源（如 奶奶）" maxlength="20" style="display:none;width:150px;">
        </div>
      </div>

      ${items.length ? items.map(x => `
        <div class="fin-row">
          <span class="badge ${x.type === 'expense' ? 'b-red' : 'b-green'}">${x.type === 'expense' ? '支出' : '收入'}</span>
          ${x.type === 'expense' ? catBadge(x.cat) : (x.source ? `<span class="badge b-amber">${escapeHtml(x.source)}</span>` : '')}
          <span class="fr-date">${fmtDate(x.date)}</span>
          <span class="fr-note" style="flex:1;">${x.note ? escapeHtml(x.note) : '<span style="color:var(--text-3)">—</span>'}</span>
          <span class="fr-amt ${x.type === 'expense' ? 'exp' : 'inc'}">${x.type === 'expense' ? '-' : '+'}${x.amount.toFixed(2)}</span>
          <button class="fr-del" title="删除" onclick="delFin('${x.id}')">🗑️</button>
        </div>`).join('') : '<div class="empty">该范围内还没有账目</div>'}
    </div>
  `;

  const fa = document.getElementById('finAmount');
  fa.addEventListener('keydown', e => { if (e.key === 'Enter') addFin(); });
}

function finFiltered() {
  const f = state.finF || {};
  return state.finance.filter(x => {
    if (f.from && x.date < f.from) return false;
    if (f.to && x.date > f.to) return false;
    if (x.type === 'expense') {
      if (f.cat && f.cat !== 'all' && (x.cat || 'daily') !== f.cat) return false;
      if (f.src && f.src !== 'all') return false; // 只看收入来源时，不显示支出
    } else {
      if (f.cat && f.cat !== 'all') return false; // 只看支出分类时，不显示收入
      if (f.src && f.src !== 'all' && x.source !== f.src) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}
function finApplyFilter() {
  const f = state.finF;
  f.from = document.getElementById('finFrom').value;
  f.to = document.getElementById('finTo').value;
  f.cat = document.getElementById('finCatF').value;
  f.src = document.getElementById('finSrcF').value;
  saveState(); renderFinance();
}
function finClearFilter() {
  state.finF = { from: '', to: '', cat: 'all', src: 'all' };
  saveState(); renderFinance();
}
function finQuick(k) {
  const t = now();
  const y = t.getFullYear(), m = t.getMonth();
  let from = '';
  if (k === 'month') from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  else if (k === '3m') { const d = new Date(y, m - 2, 1); from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
  else from = `${y}-01-01`;
  state.finF.from = from;
  state.finF.to = todayStr();
  saveState(); renderFinance();
}
function finFormSwitch() {
  const t = document.getElementById('finType').value;
  document.getElementById('finCat').style.display = t === 'expense' ? 'inline-block' : 'none';
  document.getElementById('finSrcBox').style.display = t === 'income' ? 'flex' : 'none';
}
function finSrcSwitch() {
  const s = document.getElementById('finSource').value;
  document.getElementById('finSourceCustom').style.display = s === '其他' ? 'inline-block' : 'none';
}
function addFin() {
  const type = document.getElementById('finType').value;
  const amount = parseFloat(document.getElementById('finAmount').value);
  if (!amount || amount <= 0) return;
  const date = document.getElementById('finDate').value || todayStr();
  const note = document.getElementById('finNote').value.trim();
  const rec = { id: uid(), type, amount, date, note, createdAt: Date.now() };
  if (type === 'expense') rec.cat = document.getElementById('finCat').value;
  else {
    let src = document.getElementById('finSource').value;
    if (src === '其他') src = document.getElementById('finSourceCustom').value.trim() || '其他';
    rec.source = src;
  }
  state.finance.push(rec);
  saveState();
  renderFinance();
}
function delFin(id) {
  state.finance = state.finance.filter(f => f.id !== id);
  saveState();
  renderFinance();
}

/* ============================================================
   健身
   ============================================================ */
function renderFitness() {
  const main = document.getElementById('main');
  const ms = state.fitness.measures.slice().reverse();
  const ex = state.fitness.exercises.slice().reverse();
  const last = ms[0];
  const ym = curMonthStr();
  const mEx = state.fitness.exercises.filter(e => e.date && e.date.slice(0, 7) === ym);
  const mCount = mEx.length;
  const mMin = mEx.reduce((s, e) => s + (e.duration || 0), 0);
  const mHours = (mMin / 60).toFixed(1);

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">健身</div><div class="view-sub">体重 + 体脂率 + 每日运动</div></div>
      <div class="filter-row" style="margin:0;">
        <button class="f-btn ${state.fitTab === 'measure' ? 'active' : ''}" onclick="setFitTab('measure')">身材记录</button>
        <button class="f-btn ${state.fitTab === 'exercise' ? 'active' : ''}" onclick="setFitTab('exercise')">运动记录</button>
      </div>
    </div>

    ${state.fitTab === 'measure' ? `
  <div class="current-stats">
    <div class="cs"><div class="cs-val">${last ? last.weight : '—'}</div><div class="cs-label">体重 kg</div></div>
    <div class="cs"><div class="cs-val">${last ? (last.bodyfat != null ? last.bodyfat : '—') : '—'}</div><div class="cs-label">体脂率 %</div></div>
  </div>
      <div class="card card-pad">
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <input type="date" class="select" id="mDate" value="${todayStr()}">
      <input type="number" class="input" id="mWeight" placeholder="体重kg" step="0.1" style="width:100px;">
      <input type="number" class="input" id="mBodyfat" placeholder="体脂率%" step="0.1" style="width:100px;">
      <button class="btn btn-primary btn-sm" onclick="addMeasure()">记录</button>
        </div>
        ${ms.length ? ms.map(m => `
          <div class="measure-row">
            <span class="mr-date">${fmtDate(m.date)}</span>
        <span class="mr-vals">
          <span>体重 <span class="mr-num">${m.weight ?? '—'}</span></span>
          <span>体脂率 <span class="mr-num">${m.bodyfat ?? '—'}</span></span>
        </span>
            <button class="mr-del" title="删除" onclick="delMeasure('${m.id}')">🗑️</button>
          </div>`).join('') : '<div class="empty">还没有身材记录</div>'}
      </div>
      <div class="card card-pad" style="margin-top:16px;">
        <div class="card-head" style="padding:0 0 12px;border:none;"><h3>📈 体重变化曲线</h3></div>
        ${weightChart()}
      </div>
    ` : `
      <div class="current-stats">
        <div class="cs"><div class="cs-val">${mCount}</div><div class="cs-label">本月运动次数</div></div>
        <div class="cs"><div class="cs-val">${mMin}</div><div class="cs-label">本月总时长（分钟）</div></div>
        <div class="cs"><div class="cs-val">${mHours}</div><div class="cs-label">折合小时</div></div>
      </div>
      <div class="card card-pad">
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          <input type="date" class="select" id="eDate" value="${todayStr()}">
          <input type="text" class="input" id="eType" placeholder="运动类型（如 跑步/力量/瑜伽）" maxlength="40" style="min-width:160px;">
          <input type="number" class="input" id="eDuration" placeholder="时长(分)" step="1" style="width:110px;">
          <button class="btn btn-primary btn-sm" onclick="addExercise()">记录</button>
        </div>
        ${ex.length ? ex.map(e => `
          <div class="measure-row">
            <span class="mr-date">${fmtDate(e.date)}</span>
            <span class="mr-vals">
              <span style="font-weight:700;">${escapeHtml(e.type)}</span>
              <span>${e.duration ? e.duration + ' 分钟' : ''}</span>
            </span>
            <button class="mr-del" title="删除" onclick="delExercise('${e.id}')">🗑️</button>
          </div>`).join('') : '<div class="empty">还没有运动记录</div>'}
      </div>
    `}
  `;
}

// 体重变化曲线（SVG 折线图）
function weightChart() {
  const pts = state.fitness.measures.filter(m => m.weight != null)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return '<div class="empty" style="padding:16px;">至少记录 2 次体重后，这里会显示变化曲线</div>';
  const W = 640, H = 220, padL = 40, padR = 18, padT = 22, padB = 26;
  const ws = pts.map(p => p.weight);
  let min = Math.min(...ws), max = Math.max(...ws);
  const span = (max - min) || 1;
  min -= span * 0.25; max += span * 0.25;
  const x = i => padL + (W - padL - padR) * i / (pts.length - 1);
  const y = v => padT + (H - padT - padB) * (max - v) / (max - min);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="4" fill="var(--orange)"><title>${p.date} ${p.weight}kg</title></circle>`).join('');
  const labels = pts.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${(y(p.weight) - 8).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="var(--text-2)">${p.weight}</text>`).join('');
  const step = Math.max(1, Math.ceil(pts.length / 6));
  const dates = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="var(--text-3)">${p.date.slice(5)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--border-2)"/>
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--border-2)"/>
    <text x="${padL - 6}" y="${padT + 4}" font-size="10" text-anchor="end" fill="var(--text-3)">${max.toFixed(1)}</text>
    <text x="${padL - 6}" y="${H - padB}" font-size="10" text-anchor="end" fill="var(--text-3)">${min.toFixed(1)}</text>
    <path d="${path}" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}${dates}${dots}
  </svg>`;
}

function setFitTab(t) { state.fitTab = t; saveState(); renderFitness(); }
async function addMeasure() {
  const get = id => { const v = document.getElementById(id).value; return v === '' ? null : parseFloat(v); };
  const weight = get('mWeight'), bodyfat = get('mBodyfat');
  if (weight == null && bodyfat == null) { await alertDialog('请至少填写体重或体脂率一项', { icon: '⚠️' }); return; }
  const m = {
    id: uid(), date: document.getElementById('mDate').value || todayStr(),
    weight, bodyfat,
  };
  state.fitness.measures.push(m);
  saveState();
  renderFitness();
}
function delMeasure(id) {
  state.fitness.measures = state.fitness.measures.filter(m => m.id !== id);
  saveState();
  renderFitness();
}
function addExercise() {
  const type = document.getElementById('eType').value.trim();
  if (!type) return;
  const e = {
    id: uid(), date: document.getElementById('eDate').value || todayStr(),
    type, duration: document.getElementById('eDuration').value ? parseInt(document.getElementById('eDuration').value) : null,
  };
  state.fitness.exercises.push(e);
  saveState();
  renderFitness();
}
function delExercise(id) {
  state.fitness.exercises = state.fitness.exercises.filter(e => e.id !== id);
  saveState();
  renderFitness();
}

/* ============================================================
   习惯打卡
   ============================================================ */
function renderHabits() {
  const main = document.getElementById('main');
  if (!state.habitMonth) state.habitMonth = curMonthStr();
  const [hy, hm] = state.habitMonth.split('-').map(Number);
  const daysInMonth = new Date(hy, hm, 0).getDate();
  const dayArr = [];
  for (let d = 1; d <= daysInMonth; d++) dayArr.push(`${state.habitMonth}-${String(d).padStart(2, '0')}`);
  const today = todayStr();
  const curYm = curMonthStr();

  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">习惯打卡</div><div class="view-sub">按月打卡，坚持积累</div></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="cal-nav">
          <button onclick="shiftHabitMonth(-1)">‹</button>
          <span style="align-self:center;font-weight:700;min-width:80px;text-align:center;">${hy}年${hm}月</span>
          <button onclick="shiftHabitMonth(1)">›</button>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="state.habitMonth='${curYm}';saveState();renderHabits()">本月</button>
        <button class="btn btn-ghost btn-sm" onclick="addHabit()">+ 添加习惯</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px;">
      <div class="card-head" style="padding:0 0 12px;border:none;"><h3>今日打卡</h3></div>
      <div class="habit-today">
        ${state.habits.items.map(h => {
          const done = state.habits.log[today] && state.habits.log[today][h.id];
          return `<div class="habit-today-item ${done ? 'done' : ''}" onclick="toggleHabitToday('${h.id}')">
            <div class="ht-check"></div>
            <span class="ht-name">${escapeHtml(h.name)}</span>
            <span class="ht-check-label">${done ? '已完成 ✓' : '点击完成'}</span>
          </div>`;
        }).join('') || '<div class="empty">还没有习惯，点右上角添加</div>'}
      </div>
    </div>

    <div class="card card-pad">
      <div class="card-head" style="padding:0 0 12px;border:none;"><h3>${hy}年${hm}月打卡</h3></div>
      <div class="habit-grid">
        <table>
          <tr><th style="text-align:left;">习惯</th><th>完成</th>${dayArr.map(ds => `<th class="${ds === today ? 'h-today' : ''}">${parseInt(ds.slice(8, 10))}</th>`).join('')}</tr>
          ${state.habits.items.map(h => {
            let cnt = 0;
            const cells = dayArr.map(ds => {
              const on = state.habits.log[ds] && state.habits.log[ds][h.id];
              if (on) cnt++;
              return `<td><div class="hg-cell ${on ? 'on' : ''}" onclick="toggleHabitCell('${h.id}','${ds}')"></div></td>`;
            }).join('');
            return `<tr><td class="hname">${escapeHtml(h.name)}</td><td class="hcnt">${cnt}/${daysInMonth}</td>${cells}</tr>`;
          }).join('') || `<tr><td colspan="${dayArr.length + 2}" class="empty">暂无习惯</td></tr>`}
        </table>
      </div>
    </div>
  `;
}

function shiftHabitMonth(d) {
  let [y, m] = state.habitMonth.split('-').map(Number);
  m += d;
  if (m < 1) { m = 12; y--; }
  else if (m > 12) { m = 1; y++; }
  state.habitMonth = `${y}-${String(m).padStart(2, '0')}`;
  saveState();
  renderHabits();
}

function toggleHabitToday(hid) {
  const t = todayStr();
  if (!state.habits.log[t]) state.habits.log[t] = {};
  state.habits.log[t][hid] = !state.habits.log[t][hid];
  saveState();
  renderHabits();
}
function toggleHabitCell(hid, ds) {
  if (!state.habits.log[ds]) state.habits.log[ds] = {};
  state.habits.log[ds][hid] = !state.habits.log[ds][hid];
  saveState();
  renderHabits();
}
async function addHabit() {
  const name = await promptDialog('习惯名称（如 读书 / 冥想）：');
  if (!name) return;
  state.habits.items.push({ id: uid(), name: name.trim() });
  saveState();
  renderHabits();
}

/* ============================================================
   年度目标
   ============================================================ */
function renderGoals() {
  const main = document.getElementById('main');
  const curYear = now().getFullYear();
  const goals = state.goals.filter(g => (g.year || curYear) === curYear);
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">年度目标 ${curYear}</div><div class="view-sub">目标关联项目，不重复创建项目内容（不使用主观百分比）</div></div>
      <button class="btn btn-primary btn-sm" onclick="openGoalModal(null)">+ 添加目标</button>
    </div>
    <div class="grid grid-2">
      ${goals.map(g => {
        const p = g.projectId ? state.projects.find(x => x.id === g.projectId) : null;
        return `<div class="goal-card">
          <div class="gc-top">
            <span class="gc-title">${escapeHtml(g.title)}</span>
            <button class="btn btn-danger-ghost btn-sm" onclick="delGoal('${g.id}')">删除</button>
          </div>
          <div class="gc-detail"><b>验收标准：</b>${escapeHtml(g.accept || g.detail || '（待填）')}</div>
          <div class="gc-meta">
            ${p ? `<span class="badge b-orange">${escapeHtml(p.code)}</span>` : ''}
            <span class="badge b-teal">${escapeHtml(g.status || '进行中')}</span>
            ${g.deadline ? `<span class="badge b-gray">截止 ${fmtDate(g.deadline)}</span>` : ''}
          </div>
          ${g.progress_note ? `<div class="gc-detail" style="margin-top:6px;"><b>最近进展：</b>${escapeHtml(g.progress_note)}</div>` : ''}
          <div style="margin-top:10px;"><button class="btn btn-ghost btn-sm" onclick="openGoalModal('${g.id}')">编辑</button></div>
        </div>`;
      }).join('') || '<div class="empty"><span class="emoji">🎯</span>还没有年度目标</div>'}
    </div>`;
}
function openGoalModal(id) {
  const g = id ? state.goals.find(x => x.id === id) : null;
  const projOptions = `<option value="">（无）</option>` + state.projects.map(p => `<option value="${p.id}" ${g && g.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.code)}</option>`).join('');
  const m = document.getElementById('authModal'); if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal">
        <h3>🎯 ${g ? '编辑目标' : '添加年度目标'}</h3>
        <div class="modal-form">
          <div class="fld">目标名称 *</div>
          <input type="text" class="input" id="gmTitle" value="${escapeHtml(g ? g.title : '')}">
          <div class="fld">验收标准</div>
          <textarea class="textarea" id="gmAccept" rows="2">${escapeHtml(g ? (g.accept || g.detail) : '')}</textarea>
          <div class="ti-row">
            <div style="width:130px"><div class="fld">当前状态</div><select class="select" id="gmStatus"><option value="进行中" ${!g || g.status === '进行中' ? 'selected' : ''}>进行中</option><option value="已完成" ${g && g.status === '已完成' ? 'selected' : ''}>已完成</option><option value="暂停" ${g && g.status === '暂停' ? 'selected' : ''}>暂停</option></select></div>
            <div style="flex:1"><div class="fld">截止节点</div><input type="date" class="select" id="gmDeadline" value="${g && g.deadline ? g.deadline : ''}"></div>
            <div style="flex:1"><div class="fld">关联项目</div><select class="select" id="gmProj">${projOptions}</select></div>
          </div>
          <div class="fld">最近进展</div>
          <textarea class="textarea" id="gmNote" rows="2">${escapeHtml(g ? g.progress_note : '')}</textarea>
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">取消</button>
            <button class="btn btn-primary btn-sm" onclick="saveGoal('${id || ''}')">保存</button>
          </div>
        </div>
      </div>
    </div>`;
}
async function saveGoal(id) {
  const title = document.getElementById('gmTitle').value.trim();
  if (!title) { await alertDialog('请填写目标名称', { icon: '⚠️' }); return; }
  const data = {
    title,
    accept: document.getElementById('gmAccept').value.trim(),
    status: document.getElementById('gmStatus').value,
    deadline: document.getElementById('gmDeadline').value || null,
    projectId: document.getElementById('gmProj').value || null,
    progress_note: document.getElementById('gmNote').value.trim(),
    year: now().getFullYear(),
  };
  if (id) { Object.assign(state.goals.find(x => x.id === id), data); }
  else state.goals.push(Object.assign({ id: uid() }, data));
  saveState(); closeProgressModal(); renderGoals();
}
async function delGoal(id) {
  if (!(await confirmDialog('删除该年度目标？', { icon: '🗑️' }))) return;
  state.goals = state.goals.filter(g => g.id !== id);
  saveState();
  renderGoals();
}

/* ============================================================
   文化生活（书籍 / 电影 / 播客 单一作品库）
   ============================================================ */
function culFiltered() {
  const f = state.culF || {};
  const q = (f.search || '').trim().toLowerCase();
  const v = state.culView || 'all';
  return state.cultural.filter(w => {
    if (q && !(w.name || '').toLowerCase().includes(q)) return false;
    if (f.type && f.type !== 'all' && w.type !== f.type) return false;
    if (f.cat && f.cat !== 'all' && (w.category || '') !== f.cat) return false;
    if (f.year && f.year !== 'all' && String(w.year || '') !== f.year) return false;
    if (f.rating && f.rating !== 'all') {
      const r = w.rating || 0;
      if (f.rating === 'none') { if (r !== 0) return false; }
      else if (r !== Number(f.rating)) return false;
    }
    if (f.tag && f.tag !== 'all' && !(w.tags || []).includes(f.tag)) return false;
    if (v === 'doing' && w.status !== '进行中') return false;
    if (v === 'books' && !(w.type === 'book' && w.status === '已完成')) return false;
    if (v === 'movies' && !(w.type === 'movie' && w.status === '已完成')) return false;
    if (v === 'podcasts' && w.type !== 'podcast') return false;
    if (v === 'wish' && w.status !== '想读想看') return false;
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function starsHtml(r) {
  const n = Number(r) || 0;
  if (n <= 0) return '<span class="cul-stars none">未评分</span>';
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '<span class="on">★</span>' : '<span>☆</span>';
  return `<span class="cul-stars">${s}</span>`;
}
function culCard(w) {
  const t = CUL_TYPES[w.type] || { label: w.type || '', ico: '📄', cls: 'b-gray' };
  const st = CUL_STATUS[w.status] || null;
  const meta = [];
  if (st) meta.push(`<span class="badge ${st.cls}">${st.label}</span>`);
  meta.push(`<span class="badge ${t.cls}">${t.ico} ${t.label}</span>`);
  if (w.category) meta.push(`<span class="badge b-gray">${escapeHtml(w.category)}</span>`);
  if (w.year) meta.push(`<span class="cul-dim">${escapeHtml(w.year)}</span>`);
  if (w.creator) meta.push(`<span class="cul-dim">${escapeHtml(w.creator)}</span>`);
  if (w.startDate || w.endDate) {
    const d = `${w.startDate ? fmtDate(w.startDate) : ''}${w.startDate && w.endDate ? ' → ' : ''}${w.endDate ? fmtDate(w.endDate) : ''}`;
    meta.push(`<span class="cul-dim">${d}</span>`);
  }
  const dates = meta.join(' ');
  return `<div class="cul-card" onclick="openCulDetail('${w.id}')">
    <div class="cul-ico">${t.ico}</div>
    <div class="cul-body">
      <div class="cul-top">
        <span class="cul-name">${escapeHtml(w.name)}</span>
        ${starsHtml(w.rating)}
      </div>
      <div class="cul-meta">${dates}</div>
      ${w.feel ? `<div class="cul-feel">${escapeHtml(w.feel)}</div>` : ''}
      ${(w.tags || []).length ? `<div class="cul-tags">${w.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="cul-actions">
      <button class="cul-btn" title="编辑" onclick="event.stopPropagation();openCulModal('${w.id}')">✎</button>
      <button class="cul-btn del" title="删除" onclick="event.stopPropagation();delCul('${w.id}')">🗑️</button>
    </div>
  </div>`;
}
function culTypeOptions() {
  const f = state.culF || {};
  return `<option value="all" ${f.type === 'all' ? 'selected' : ''}>全部类型</option>` +
    Object.keys(CUL_TYPES).map(k => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${CUL_TYPES[k].label}</option>`).join('');
}
function culCatOptions() {
  const f = state.culF || {};
  const cats = [...new Set(state.cultural.map(w => w.category).filter(Boolean))].sort();
  return `<option value="all" ${f.cat === 'all' ? 'selected' : ''}>全部分类</option>` +
    cats.map(c => `<option value="${escapeHtml(c)}" ${f.cat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
function culYearOptions() {
  const f = state.culF || {};
  const years = [...new Set(state.cultural.map(w => w.year).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return `<option value="all" ${f.year === 'all' ? 'selected' : ''}>全部年份</option>` +
    years.map(y => `<option value="${escapeHtml(y)}" ${f.year === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('');
}
function culRatingOptions() {
  const f = state.culF || {};
  const opt = (v, label) => `<option value="${v}" ${f.rating === v ? 'selected' : ''}>${label}</option>`;
  return opt('all', '全部评分') + opt('none', '未评分') +
    [1, 2, 3, 4, 5].map(i => opt(String(i), '★'.repeat(i))).join('');
}
function culTagOptions() {
  const f = state.culF || {};
  const tags = [...new Set(state.cultural.flatMap(w => w.tags || []))].sort();
  return `<option value="all" ${f.tag === 'all' ? 'selected' : ''}>全部标签</option>` +
    tags.map(t => `<option value="${escapeHtml(t)}" ${f.tag === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
}
function culSet(k, v) { state.culF = state.culF || { search: '', type: 'all', cat: 'all', year: 'all', rating: 'all', tag: 'all' }; state.culF[k] = v; saveState(); renderCulture(); }
function culSetView(v) { state.culView = v; saveState(); renderCulture(); }
function culResetFilter() {
  state.culF = { search: '', type: 'all', cat: 'all', year: 'all', rating: 'all', tag: 'all' };
  saveState(); renderCulture();
}
function renderCulture() {
  const main = document.getElementById('main');
  const f = state.culF || {};
  const list = culFiltered();
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">文化生活</div><div class="view-sub">书籍 · 电影 · 播客，一个作品库统一记录（仅名称与类型必填，其余可留空）</div></div>
      <button class="btn btn-primary" onclick="openCulModal(null)">+ 添加作品</button>
    </div>
    <div class="cul-views">
      ${CUL_VIEWS.map(v => `<button class="f-btn ${state.culView === v.key ? 'active' : ''}" onclick="culSetView('${v.key}')">${v.label}</button>`).join('')}
    </div>
    <div class="lit-filter card card-pad">
      <input type="text" class="input" id="culSearch" placeholder="搜索作品名称…" value="${escapeHtml(f.search || '')}" onkeydown="if(event.key==='Enter'){state.culF.search=this.value;saveState();renderCulture();}">
      <select class="select" onchange="culSet('type',this.value)">${culTypeOptions()}</select>
      <select class="select" onchange="culSet('cat',this.value)">${culCatOptions()}</select>
      <select class="select" onchange="culSet('year',this.value)">${culYearOptions()}</select>
      <select class="select" onchange="culSet('rating',this.value)">${culRatingOptions()}</select>
      <select class="select" onchange="culSet('tag',this.value)">${culTagOptions()}</select>
      <button class="btn btn-ghost btn-sm" onclick="culResetFilter()">清除筛选</button>
    </div>
    <div style="margin-top:14px;">
      ${list.length ? list.map(w => culCard(w)).join('') : '<div class="card card-pad"><div class="empty"><span class="emoji">🎭</span>没有匹配的作品，点右上角「+ 添加作品」开始记录</div></div>'}
    </div>
    <div style="margin-top:8px;text-align:center;color:var(--text-3);font-size:12px;">共 ${list.length} 条作品</div>
  `;
}
function openCulModal(id) {
  const w = id ? state.cultural.find(x => x.id === id) : null;
  window.__culRating = w ? (w.rating || 0) : 0;
  window.__culModalTags = w ? (w.tags || []).slice() : [];
  const m = document.getElementById('authModal'); if (!m) return;
  const typeOpts = Object.keys(CUL_TYPES).map(k => `<option value="${k}" ${(w ? w.type : 'book') === k ? 'selected' : ''}>${CUL_TYPES[k].label}</option>`).join('');
  const stOpts = ['', '想读想看', '进行中', '已完成', '暂停', '放弃'].map(s => `<option value="${s}" ${(w ? w.status : '想读想看') === s ? 'selected' : ''}>${s || '（未设置）'}</option>`).join('');
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal modal-wide">
        <h3>🎭 ${w ? '编辑作品' : '添加作品'}</h3>
        <div class="modal-form">
          <div class="ti-row">
            <div style="flex:1.5;min-width:160px;"><div class="fld">作品名称 *</div><input type="text" class="input" id="cmName" value="${escapeHtml(w ? w.name : '')}" placeholder="如：活着 / 星际穿越 / 得意忘形" maxlength="200"></div>
            <div style="flex:1;"><div class="fld">作品类型 *</div><select class="select" id="cmType">${typeOpts}</select></div>
          </div>
          <div class="ti-row">
            <div style="flex:1;"><div class="fld">状态</div><select class="select" id="cmStatus">${stOpts}</select></div>
            <div style="flex:1;"><div class="fld">分类</div><input type="text" class="input" id="cmCat" value="${escapeHtml(w ? w.category : '')}" placeholder="如：小说 / 科幻 / 心理学"></div>
            <div style="width:110px;"><div class="fld">作品年份</div><input type="text" class="input" id="cmYear" value="${escapeHtml(w ? w.year : '')}" placeholder="如 2023"></div>
          </div>
          <div class="ti-row">
            <div style="flex:1.5;min-width:160px;"><div class="fld">作者 / 主创</div><input type="text" class="input" id="cmCreator" value="${escapeHtml(w ? w.creator : '')}" placeholder="书籍填作者，电影填导演，播客填节目/主创"></div>
            <div style="flex:1;"><div class="fld">开始日期</div><input type="date" class="select" id="cmStart" value="${w && w.startDate || ''}"></div>
            <div style="flex:1;"><div class="fld">结束日期</div><input type="date" class="select" id="cmEnd" value="${w && w.endDate || ''}"></div>
          </div>
          <div>
            <div class="fld">评分（五星制，可不评）</div>
            <div class="star-pick" id="culStarPick"></div>
          </div>
          <div class="fld">一句话感受</div>
          <input type="text" class="input" id="cmFeel" value="${escapeHtml(w ? w.feel : '')}" placeholder="如：眼泪为时代而流，也为活着本身" maxlength="200">
          <div class="fld">标签（回车添加，可删除）</div>
          <div class="tag-input" id="culTags">${window.__culModalTags.map(t => `<span class="tag-chip" onclick="culModalTagRemove('${escapeHtml(t)}')">${escapeHtml(t)} ✕</span>`).join('')}</div>
          <input type="text" class="input" id="culTagInput" placeholder="输入标签后回车…" onkeydown="if(event.key==='Enter'){event.preventDefault();culModalTagAdd();}">
          <div class="ti-row" style="margin-bottom:0;">
            <div style="flex:1;min-width:200px;"><div class="fld">选择它的原因</div><textarea class="textarea" id="cmReason" rows="2" placeholder="可选">${escapeHtml(w ? w.reason : '')}</textarea></div>
            <div style="flex:1;min-width:200px;"><div class="fld">核心内容</div><textarea class="textarea" id="cmCore" rows="2" placeholder="可选">${escapeHtml(w ? w.core : '')}</textarea></div>
          </div>
          <div class="ti-row" style="margin-bottom:0;">
            <div style="flex:1;min-width:200px;"><div class="fld">喜欢的片段</div><textarea class="textarea" id="cmFav" rows="2" placeholder="可选">${escapeHtml(w ? w.fav : '')}</textarea></div>
            <div style="flex:1;min-width:200px;"><div class="fld">个人感受</div><textarea class="textarea" id="cmThought" rows="2" placeholder="可选">${escapeHtml(w ? w.thought : '')}</textarea></div>
          </div>
          <div class="ti-row" style="margin-bottom:0;">
            <div style="flex:1;"><div class="fld">带来的启发</div><textarea class="textarea" id="cmInsight" rows="2" placeholder="可选">${escapeHtml(w ? w.insight : '')}</textarea></div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">取消</button>
            <button class="btn btn-primary btn-sm" onclick="saveCul('${id || ''}')">保存</button>
          </div>
        </div>
      </div>
    </div>`;
  renderCulStars();
}
function culPick(n) {
  window.__culRating = (window.__culRating === n && n !== 0) ? 0 : n;
  renderCulStars();
}
function renderCulStars() {
  const box = document.getElementById('culStarPick');
  if (!box) return;
  const r = window.__culRating || 0;
  box.innerHTML = [1, 2, 3, 4, 5].map(i =>
    `<span class="sp-star ${i <= r ? 'on' : ''}" onclick="culPick(${i})">★</span>`
  ).join('') + '<span class="sp-clear" onclick="culPick(0)">清除</span>';
}
function culModalTagAdd() {
  const inp = document.getElementById('culTagInput');
  const v = inp.value.trim(); if (!v) return;
  if (!window.__culModalTags.includes(v)) window.__culModalTags.push(v);
  inp.value = '';
  renderCulModalTags();
}
function culModalTagRemove(tag) {
  window.__culModalTags = window.__culModalTags.filter(x => x !== tag);
  renderCulModalTags();
}
function renderCulModalTags() {
  const box = document.getElementById('culTags');
  if (box) box.innerHTML = window.__culModalTags.map(t => `<span class="tag-chip" onclick="culModalTagRemove('${escapeHtml(t)}')">${escapeHtml(t)} ✕</span>`).join('');
}
async function saveCul(id) {
  const name = document.getElementById('cmName').value.trim();
  if (!name) { await alertDialog('请填写作品名称', { icon: '⚠️' }); return; }
  const data = {
    name,
    type: document.getElementById('cmType').value,
    status: document.getElementById('cmStatus').value,
    category: document.getElementById('cmCat').value.trim(),
    year: document.getElementById('cmYear').value.trim(),
    startDate: document.getElementById('cmStart').value,
    endDate: document.getElementById('cmEnd').value,
    creator: document.getElementById('cmCreator').value.trim(),
    rating: window.__culRating || 0,
    feel: document.getElementById('cmFeel').value.trim(),
    tags: window.__culModalTags.slice(),
    reason: document.getElementById('cmReason').value.trim(),
    core: document.getElementById('cmCore').value.trim(),
    fav: document.getElementById('cmFav').value.trim(),
    thought: document.getElementById('cmThought').value.trim(),
    insight: document.getElementById('cmInsight').value.trim(),
  };
  if (id) {
    Object.assign(state.cultural.find(w => w.id === id), data);
  } else {
    state.cultural.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
  }
  saveState();
  closeProgressModal();
  renderCulture();
}
function openCulDetail(id) {
  const w = state.cultural.find(x => x.id === id); if (!w) return;
  const m = document.getElementById('authModal'); if (!m) return;
  const t = CUL_TYPES[w.type] || { label: w.type || '', ico: '📄', cls: 'b-gray' };
  const st = CUL_STATUS[w.status] || null;
  const badges = [st ? `<span class="badge ${st.cls}">${st.label}</span>` : '',
    `<span class="badge ${t.cls}">${t.ico} ${t.label}</span>`,
    w.category ? `<span class="badge b-gray">${escapeHtml(w.category)}</span>` : ''].join(' ');
  const row = (label, val) => val ? `<div class="le-row"><b>${label}</b><span style="white-space:pre-wrap;">${escapeHtml(val)}</span></div>` : '';
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal modal-wide">
        <h3>${t.ico} ${escapeHtml(w.name)}</h3>
        <div class="modal-form">
          <div style="margin-bottom:4px;">${badges} ${starsHtml(w.rating)}</div>
          ${row('作品年份', w.year)}
          ${row('作者 / 主创', w.creator)}
          ${(w.startDate || w.endDate) ? `<div class="le-row"><b>阅读/观看时间</b><span>${w.startDate ? fmtDateFull(w.startDate) : ''}${w.startDate && w.endDate ? ' → ' : ''}${w.endDate ? fmtDateFull(w.endDate) : ''}</span></div>` : ''}
          ${row('一句话感受', w.feel)}
          ${(w.tags || []).length ? `<div class="le-row"><b>标签</b><span>${w.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join(' ')}</span></div>` : ''}
          ${row('选择它的原因', w.reason)}
          ${row('核心内容', w.core)}
          ${row('喜欢的片段', w.fav)}
          ${row('个人感受', w.thought)}
          ${row('带来的启发', w.insight)}
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">关闭</button>
            <button class="btn btn-ghost btn-sm" onclick="closeProgressModal();openCulModal('${w.id}')">编辑</button>
          </div>
        </div>
      </div>
    </div>`;
}
async function delCul(id) {
  if (!(await confirmDialog('删除这条作品记录？', { icon: '🗑️' }))) return;
  state.cultural = state.cultural.filter(w => w.id !== id);
  saveState();
  renderCulture();
}

/* ============================================================
   文献管理
   ============================================================ */
function litFiltered() {
  const f = state.litF || {};
  const q = (f.search || '').trim().toLowerCase();
  return state.literature.filter(l => {
    if (q && !((l.title || '').toLowerCase().includes(q) || (l.authors || '').toLowerCase().includes(q))) return false;
    if (f.cat && f.cat !== 'all' && (l.category || '') !== f.cat) return false;
    if (f.read && f.read !== 'all' && (l.readStatus || '未读') !== f.read) return false;
    if (f.proj && f.proj !== 'all' && l.projectId !== f.proj) return false;
    if (f.tags && f.tags.length) {
      const tags = l.tags || [];
      if (!f.tags.every(t => tags.includes(t))) return false;
    }
    return true;
  });
}
function litCatOptions() {
  const cats = Array.from(new Set(state.literature.map(l => l.category).filter(Boolean)));
  return `<option value="all">全部分类</option>` + cats.map(c => `<option value="${escapeHtml(c)}" ${state.litF.cat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
function litTagChips() {
  const all = Array.from(new Set(state.literature.flatMap(l => l.tags || [])));
  if (!all.length) return '';
  return all.map(t => `<button class="f-btn ${(state.litF.tags || []).includes(t) ? 'active' : ''}" onclick="litToggleTag('${escapeHtml(t)}')">${escapeHtml(t)}</button>`).join('');
}
function litToggleTag(tag) {
  const f = state.litF; if (!f.tags) f.tags = [];
  f.tags = f.tags.includes(tag) ? f.tags.filter(x => x !== tag) : [...f.tags, tag];
  saveState(); renderLiterature();
}
function litSet(field, val) { state.litF[field] = val; saveState(); renderLiterature(); }
function litResetFilter() { state.litF = { search: '', cat: 'all', read: 'all', proj: 'all', tags: [] }; saveState(); renderLiterature(); }

function renderLiterature() {
  const main = document.getElementById('main');
  const f = state.litF;
  const projOptions = `<option value="all">全部项目</option>` + state.projects.map(p => `<option value="${p.id}" ${f.proj === p.id ? 'selected' : ''}>${escapeHtml(p.code)}</option>`).join('');
  const list = litFiltered();
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">文献管理</div><div class="view-sub">Excel 式表格 · 精读/略读记录，支撑博士计划</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="openLitModal(null)">+ 添加文献</button>
        <label class="btn btn-outline btn-sm">⬆ 导入CSV<input type="file" accept=".csv,text/csv" style="display:none;" onchange="if(this.files[0])importLitCSV(this.files[0])"></label>
        <button class="btn btn-outline btn-sm" onclick="exportLitCSV()">⬇ 导出CSV</button>
        <button class="btn btn-outline btn-sm" onclick="exportLitBib()">⬇ BibTeX</button>
      </div>
    </div>

    <div class="lit-filter card card-pad">
      <input type="text" class="input" id="litSearch" placeholder="搜索标题 / 作者…" value="${escapeHtml(f.search || '')}" style="min-width:150px;" onkeydown="if(event.key==='Enter'){state.litF.search=this.value;saveState();renderLiterature();}">
      <select class="select" onchange="litSet('cat',this.value)">${litCatOptions()}</select>
      <select class="select" onchange="litSet('read',this.value)">
        <option value="all" ${f.read === 'all' ? 'selected' : ''}>全部阅读状态</option>
        <option value="未读" ${f.read === '未读' ? 'selected' : ''}>未读</option>
        <option value="略读" ${f.read === '略读' ? 'selected' : ''}>略读</option>
        <option value="精读" ${f.read === '精读' ? 'selected' : ''}>精读</option>
      </select>
      <select class="select" onchange="litSet('proj',this.value)">${projOptions}</select>
      <button class="btn btn-ghost btn-sm" onclick="litResetFilter()">清除筛选</button>
    </div>
    <div class="lit-tags">${litTagChips() || '<span style="color:var(--text-3);font-size:12px;">暂无标签（在添加/编辑文献时可自定义，如 奖赏系统 / MDD / ADHD / ERP / fMRI）</span>'}</div>

    <div class="card card-pad" style="margin-top:14px;overflow:auto;">
      <table class="lit-table">
        <thead><tr>
          <th>标题</th><th>作者</th><th>年份</th><th>期刊</th><th>DOI/链接</th><th>阅读</th><th>分类</th><th>标签</th><th>关联项目</th><th>核心结论</th><th></th>
        </tr></thead>
        <tbody>
          ${list.length ? list.map(l => {
            const p = state.projects.find(x => x.id === l.projectId);
            return `<tr onclick="openLitDetail('${l.id}')">
              <td class="lt-title">${escapeHtml(l.title || '')}</td>
              <td>${escapeHtml(l.authors || '')}</td>
              <td>${escapeHtml(l.year || '')}</td>
              <td>${escapeHtml(l.journal || '')}</td>
              <td class="lt-link">${l.doi ? `<a href="${escapeHtml(l.doi)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(l.doi)}</a>` : (l.link ? `<a href="${escapeHtml(l.link)}" target="_blank" onclick="event.stopPropagation()">链接</a>` : '')}</td>
              <td><span class="badge b-${l.readStatus === '精读' ? 'teal' : l.readStatus === '略读' ? 'amber' : 'gray'}">${l.readStatus || '未读'}</span></td>
              <td>${escapeHtml(l.category || '')}</td>
              <td class="lt-tags">${(l.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</td>
              <td>${p ? `<span class="badge b-orange">${escapeHtml(p.code)}</span>` : ''}</td>
              <td class="lt-concl">${escapeHtml((l.conclusion || '').slice(0, 60))}</td>
              <td><button class="lit-del" onclick="event.stopPropagation();delLit('${l.id}')">🗑️</button></td>
            </tr>`;
          }).join('') : '<tr><td colspan="11" class="empty">没有匹配的文献</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function openLitModal(id) {
  const l = id ? state.literature.find(x => x.id === id) : null;
  const projOptions = `<option value="">（无）</option>` + state.projects.map(p => `<option value="${p.id}" ${l && l.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.code)}</option>`).join('');
  window.__litModalTags = l ? (l.tags || []).slice() : [];
  const m = document.getElementById('authModal'); if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal modal-wide">
        <h3>📚 ${l ? '编辑文献' : '添加文献'}</h3>
        <div class="modal-form">
          <div class="fld">标题 *</div>
          <input type="text" class="input" id="lmTitle" value="${escapeHtml(l ? l.title : '')}" placeholder="文献标题">
          <div class="ti-row">
            <div style="flex:1"><div class="fld">作者</div><input type="text" class="input" id="lmAuthors" value="${escapeHtml(l ? l.authors : '')}" placeholder="如 Amy et al."></div>
            <div style="width:90px"><div class="fld">年份</div><input type="text" class="input" id="lmYear" value="${escapeHtml(l ? l.year : '')}"></div>
            <div style="flex:1"><div class="fld">期刊</div><input type="text" class="input" id="lmJournal" value="${escapeHtml(l ? l.journal : '')}"></div>
          </div>
          <div class="ti-row">
            <div style="flex:1"><div class="fld">DOI</div><input type="text" class="input" id="lmDoi" value="${escapeHtml(l ? l.doi : '')}" placeholder="10.xxxx/..."></div>
            <div style="flex:1"><div class="fld">链接</div><input type="text" class="input" id="lmLink" value="${escapeHtml(l ? l.link : '')}"></div>
            <div style="flex:1"><div class="fld">Zotero</div><input type="text" class="input" id="lmZotero" value="${escapeHtml(l ? l.zotero : '')}"></div>
          </div>
          <div class="ti-row">
            <div style="width:130px"><div class="fld">阅读状态</div><select class="select" id="lmRead"><option value="未读" ${!l || l.readStatus === '未读' ? 'selected' : ''}>未读</option><option value="略读" ${l && l.readStatus === '略读' ? 'selected' : ''}>略读</option><option value="精读" ${l && l.readStatus === '精读' ? 'selected' : ''}>精读</option></select></div>
            <div style="flex:1"><div class="fld">分类</div><input type="text" class="input" id="lmCat" value="${escapeHtml(l ? l.category : '')}" placeholder="如 ERP / fMRI / ADHD"></div>
            <div style="flex:1"><div class="fld">关联项目</div><select class="select" id="lmProj">${projOptions}</select></div>
          </div>
          <div class="fld">标签（回车添加，可多选/自定义/删除）</div>
          <div class="tag-input" id="lmTags">${window.__litModalTags.map(t => `<span class="tag-chip" onclick="litModalTagRemove('${escapeHtml(t)}')">${escapeHtml(t)} ✕</span>`).join('')}</div>
          <input type="text" class="input" id="lmTagInput" placeholder="输入标签后回车…" onkeydown="if(event.key==='Enter'){event.preventDefault();litModalTagAdd();}">
          <div class="fld">核心结论</div><textarea class="textarea" id="lmConclusion" rows="2">${escapeHtml(l ? l.conclusion : '')}</textarea>
          <div class="fld">研究问题</div><textarea class="textarea" id="lmRQ" rows="2">${escapeHtml(l ? l.researchQ : '')}</textarea>
          <div class="fld">样本</div><textarea class="textarea" id="lmSample" rows="2">${escapeHtml(l ? l.sample : '')}</textarea>
          <div class="fld">方法</div><textarea class="textarea" id="lmMethod" rows="2">${escapeHtml(l ? l.method : '')}</textarea>
          <div class="fld">核心结果</div><textarea class="textarea" id="lmResults" rows="2">${escapeHtml(l ? l.coreResults : '')}</textarea>
          <div class="fld">局限</div><textarea class="textarea" id="lmLim" rows="2">${escapeHtml(l ? l.limitations : '')}</textarea>
          <div class="fld">与自己研究的连接</div><textarea class="textarea" id="lmConn" rows="2">${escapeHtml(l ? l.connection : '')}</textarea>
          <div class="fld">可形成的研究问题</div><textarea class="textarea" id="lmForm" rows="2">${escapeHtml(l ? l.formedQuestion : '')}</textarea>
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">取消</button>
            <button class="btn btn-primary btn-sm" onclick="saveLit('${id || ''}')">保存</button>
          </div>
        </div>
      </div>
    </div>`;
}
function litModalTagAdd() {
  const inp = document.getElementById('lmTagInput');
  const v = inp.value.trim(); if (!v) return;
  if (!window.__litModalTags.includes(v)) window.__litModalTags.push(v);
  inp.value = '';
  renderLitModalTags();
}
function litModalTagRemove(tag) {
  window.__litModalTags = window.__litModalTags.filter(x => x !== tag);
  renderLitModalTags();
}
function renderLitModalTags() {
  const box = document.getElementById('lmTags');
  if (box) box.innerHTML = window.__litModalTags.map(t => `<span class="tag-chip" onclick="litModalTagRemove('${escapeHtml(t)}')">${escapeHtml(t)} ✕</span>`).join('');
}
async function saveLit(id) {
  const title = document.getElementById('lmTitle').value.trim();
  if (!title) { await alertDialog('请填写标题', { icon: '⚠️' }); return; }
  const doi = document.getElementById('lmDoi').value.trim();
  if (doi) {
    const dup = state.literature.find(l => l.doi && l.doi === doi && l.id !== id);
    if (dup && !(await confirmDialog('已存在相同 DOI 的文献：' + dup.title + '\n仍要添加？', { icon: '⚠️' }))) return;
  }
  const data = {
    title,
    authors: document.getElementById('lmAuthors').value.trim(),
    year: document.getElementById('lmYear').value.trim(),
    journal: document.getElementById('lmJournal').value.trim(),
    doi, link: document.getElementById('lmLink').value.trim(),
    zotero: document.getElementById('lmZotero').value.trim(),
    readStatus: document.getElementById('lmRead').value,
    category: document.getElementById('lmCat').value.trim(),
    projectId: document.getElementById('lmProj').value || null,
    tags: window.__litModalTags.slice(),
    conclusion: document.getElementById('lmConclusion').value.trim(),
    researchQ: document.getElementById('lmRQ').value.trim(),
    sample: document.getElementById('lmSample').value.trim(),
    method: document.getElementById('lmMethod').value.trim(),
    coreResults: document.getElementById('lmResults').value.trim(),
    limitations: document.getElementById('lmLim').value.trim(),
    connection: document.getElementById('lmConn').value.trim(),
    formedQuestion: document.getElementById('lmForm').value.trim(),
  };
  if (id) {
    const l = state.literature.find(x => x.id === id);
    Object.assign(l, data);
  } else {
    state.literature.push(Object.assign({ id: uid() }, data));
  }
  saveState();
  closeProgressModal();
  renderLiterature();
}
function openLitDetail(id) {
  const l = state.literature.find(x => x.id === id); if (!l) return;
  const p = l.projectId ? state.projects.find(x => x.id === l.projectId) : null;
  const m = document.getElementById('authModal'); if (!m) return;
  const row = (label, val) => val ? `<div class="le-row"><b>${label}</b><span>${escapeHtml(val)}</span></div>` : '';
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal modal-wide">
        <h3>📄 ${escapeHtml(l.title)}</h3>
        <div class="modal-form">
          <div style="margin-bottom:8px;">
            ${l.readStatus ? `<span class="badge b-${l.readStatus === '精读' ? 'teal' : l.readStatus === '略读' ? 'amber' : 'gray'}">${l.readStatus}</span> ` : ''}
            ${l.category ? `<span class="badge b-gray">${escapeHtml(l.category)}</span> ` : ''}
            ${p ? `<span class="badge b-orange">${escapeHtml(p.code)}</span> ` : ''}
            ${(l.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}
          </div>
          ${row('作者', l.authors)}
          ${row('年份', l.year)}
          ${row('期刊', l.journal)}
          ${l.doi ? `<div class="le-row"><b>DOI</b><span><a href="${escapeHtml(l.doi)}" target="_blank">${escapeHtml(l.doi)}</a></span></div>` : ''}
          ${l.link ? `<div class="le-row"><b>链接</b><span><a href="${escapeHtml(l.link)}" target="_blank">${escapeHtml(l.link)}</a></span></div>` : ''}
          ${l.zotero ? `<div class="le-row"><b>Zotero</b><span><a href="${escapeHtml(l.zotero)}" target="_blank">链接</a></span></div>` : ''}
          ${row('核心结论', l.conclusion)}
          ${row('研究问题', l.researchQ)}
          ${row('样本', l.sample)}
          ${row('方法', l.method)}
          ${row('核心结果', l.coreResults)}
          ${row('局限', l.limitations)}
          ${row('与自己研究的连接', l.connection)}
          ${row('可形成的研究问题', l.formedQuestion)}
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">关闭</button>
            <button class="btn btn-ghost btn-sm" onclick="closeProgressModal();openLitModal('${l.id}')">编辑</button>
          </div>
        </div>
      </div>
    </div>`;
}
async function delLit(id) {
  if (!(await confirmDialog('删除这条文献？', { icon: '🗑️' }))) return;
  state.literature = state.literature.filter(l => l.id !== id);
  saveState();
  renderLiterature();
}

/* ============================================================
   项目进度（进度日志；第一阶段为占位，第二阶段完整化）
   ============================================================ */
function renderProgress() {
  const main = document.getElementById('main');
  const logs = state.progressLogs.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  let html = '';
  if (logs.length) {
    let cur = null;
    logs.forEach(l => {
      if (l.date !== cur) { cur = l.date; html += `<div class="log-date">${fmtDateFull(l.date)}</div>`; }
      const p = l.projectId ? state.projects.find(x => x.id === l.projectId) : null;
      const t = l.taskId ? state.tasks.find(x => x.id === l.taskId) : null;
      const v = { verified: ['v-ok', '已经验证'], impl: ['v-imp', '实现完成但尚未验证'], na: ['v-na', '不适用'] }[l.verify] || ['', ''];
      html += `<div class="log-entry">
        <div class="le-top">
          ${p ? `<span class="badge b-orange">${escapeHtml(p.code)}</span>` : ''}
          ${t ? `<span class="badge b-gray">${escapeHtml(t.name)}</span>` : ''}
          <span class="v-badge ${v[0]}">${v[1]}</span>
          <button class="le-del" onclick="delProgressLog('${l.id}')">🗑️</button>
        </div>
        ${l.evidence ? `<div class="le-row"><b>证据</b><span>${escapeHtml(l.evidence)}</span></div>` : ''}
        ${l.problems ? `<div class="le-row"><b>问题</b><span>${escapeHtml(l.problems)}</span></div>` : ''}
        ${l.blocker ? `<div class="le-row"><b>阻塞/待确认</b><span>${escapeHtml(l.blocker)}</span></div>` : ''}
        ${l.next ? `<div class="le-row"><b>下一步</b><span>${escapeHtml(l.next)}</span></div>` : ''}
      </div>`;
    });
  }
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">项目进度</div><div class="view-sub">记录真实产出与验证边界，不混入手账</div></div>
      <button class="btn btn-primary btn-sm" onclick="openProgressModal(null)">+ 添加进度日志</button>
    </div>
    <div class="card card-pad">
      ${logs.length ? html : '<div class="empty"><span class="emoji">📈</span>还没有进度日志。完成项目任务时会自动询问，也可手动添加。</div>'}
    </div>`;
}
async function delProgressLog(id) {
  if (!(await confirmDialog('删除这条进度日志？', { icon: '🗑️' }))) return;
  state.progressLogs = state.progressLogs.filter(l => l.id !== id);
  saveState(); renderProgress();
}
function openProgressModal(taskId) {
  const t = taskId ? state.tasks.find(x => x.id === taskId) : null;
  const pid = t ? t.projectId : (state.projects[0] ? state.projects[0].id : '');
  const projOpts = state.projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${escapeHtml(p.code)}</option>`).join('');
  const m = document.getElementById('authModal');
  if (!m) return;
  m.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeProgressModal()">
      <div class="modal modal-wide">
        <h3>📈 ${taskId ? '任务完成 · 记录进度' : '添加进度日志'}</h3>
        <div class="modal-form">
          <div class="ti-row">
            <div style="flex:1;min-width:120px;"><div class="fld">关联项目</div><select class="select" id="pmProj" onchange="refreshPmTask()">${projOpts}</select></div>
            <div style="flex:1;min-width:120px;"><div class="fld">关联任务</div><select class="select" id="pmTask">${pmTaskOpts(pid, t ? t.id : '')}</select></div>
          </div>
          <div class="fld">完成证据（实际产出）</div>
          <textarea class="textarea" id="pmEvidence" rows="2" placeholder="如：跑通真实 E-Prime TXT，输出 30 名被试的 MID 行为指标"></textarea>
          <div class="fld">验证状态</div>
          <select class="select" id="pmVerify">
            <option value="verified">已经验证</option>
            <option value="impl" selected>实现完成但尚未验证</option>
            <option value="na">不适用</option>
          </select>
          <div class="fld">遇到的问题</div>
          <textarea class="textarea" id="pmProblems" rows="2" placeholder="可选"></textarea>
          <div class="fld">阻塞或待确认</div>
          <textarea class="textarea" id="pmBlocker" rows="2" placeholder="可选"></textarea>
          <div class="fld">下一步</div>
          <textarea class="textarea" id="pmNext" rows="2" placeholder="可选"></textarea>
          <div class="modal-actions">
            <button class="btn btn-outline btn-sm" onclick="closeProgressModal()">${taskId ? '跳过' : '取消'}</button>
            <button class="btn btn-primary btn-sm" onclick="saveProgressLog()">保存</button>
          </div>
        </div>
      </div>
    </div>`;
}
function pmTaskOpts(pid, sel) {
  const ts = state.tasks.filter(x => x.projectId === pid && x.level === 3);
  return ts.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')
    || '<option value="">（该项目暂无执行任务）</option>';
}
function refreshPmTask() {
  const pid = document.getElementById('pmProj').value;
  const sel = document.getElementById('pmTask');
  if (sel) sel.innerHTML = pmTaskOpts(pid, '');
}
function closeProgressModal() {
  const m = document.getElementById('authModal');
  if (m) m.innerHTML = '';
}
function saveProgressLog() {
  const projectId = document.getElementById('pmProj').value || null;
  const taskId = document.getElementById('pmTask').value || null;
  const evidence = document.getElementById('pmEvidence').value.trim();
  const verify = document.getElementById('pmVerify').value;
  const problems = document.getElementById('pmProblems').value.trim();
  const blocker = document.getElementById('pmBlocker').value.trim();
  const next = document.getElementById('pmNext').value.trim();
  state.progressLogs.push({ id: uid(), date: todayStr(), createdAt: Date.now(), projectId, taskId, evidence, verify, problems, blocker, next });
  saveState();
  closeProgressModal();
  if (state.activeModule === 'progress') renderProgress(); else render();
}

/* ============================================================
   数据备份 / 恢复
   ============================================================ */
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportAll() {
  const data = JSON.stringify(state, null, 2);
  downloadText(`canming_life_backup_${todayStr()}.json`, data, 'application/json');
  state.lastBackup = Date.now();
  saveState();
  renderBackup();
}
function importAll(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!(await confirmDialog('导入将覆盖当前所有数据，确定继续？', { icon: '⚠️' }))) return;
      state = Object.assign(defaultState(), parsed);
      ensureArrays();
      migrateState();
      if (!state.calMonth) state.calMonth = curMonth();
      if (!state.financeMonth) state.financeMonth = curMonthStr();
      saveState();
      render();
      await alertDialog('导入成功', { icon: '✅' });
    } catch (e) { await alertDialog('导入失败：文件格式不正确', { icon: '⚠️' }); }
  };
  reader.readAsText(file);
}
function exportLitCSV() {
  const rows = [['标题', '作者', '年份', '期刊', 'DOI', '链接', 'Zotero', '阅读状态', '分类', '标签', '关联项目', '核心结论', '研究问题', '样本', '方法', '核心结果', '局限', '连接', '可形成问题']];
  state.literature.forEach(l => {
    const p = l.projectId ? state.projects.find(x => x.id === l.projectId) : null;
    rows.push([
      l.title || '', l.authors || '', l.year || '', l.journal || '', l.doi || '', l.link || '', l.zotero || '',
      l.readStatus || '', l.category || '', (l.tags || []).join('|'), p ? p.code : '',
      l.conclusion || '', l.researchQ || '', l.sample || '', l.method || '', l.coreResults || '',
      l.limitations || '', l.connection || '', l.formedQuestion || '',
    ]);
  });
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadText(`literature_${todayStr()}.csv`, csv, 'text/csv;charset=utf-8');
}
function exportLitBib() {
  const bib = state.literature.map(l => {
    const key = ((l.authors || 'anon').split(' ')[0] || 'anon').replace(/[^A-Za-z]/g, '') + (l.year || '');
    return `@article{${key},\n  title={${l.title || ''}},\n  author={${l.authors || ''}},\n  year={${l.year || ''}},\n  journal={${l.journal || ''}}${l.doi ? `,\n  doi={${l.doi}}` : ''}\n}`;
  }).join('\n\n');
  downloadText(`literature_${todayStr()}.bib`, bib, 'application/x-bibtex');
}
function parseCSVLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur); return out;
}
function importLitCSV(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = reader.result;
      const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
      const hdr = parseCSVLine(lines[0]);
      const idx = name => hdr.indexOf(name);
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const c = parseCSVLine(lines[i]);
        const get = n => { const k = idx(n); return k >= 0 ? c[k] : ''; };
        const title = get('标题');
        if (!title) continue;
        const projName = get('关联项目');
        const pid = projName ? (state.projects.find(p => p.code === projName) || {}).id : null;
        state.literature.push({
          id: uid(), title,
          authors: get('作者'), year: get('年份'), journal: get('期刊'),
          doi: get('DOI'), link: get('链接'), zotero: get('Zotero'),
          readStatus: get('阅读状态') || '未读', category: get('分类'), projectId: pid,
          tags: (get('标签') ? get('标签').split('|') : []).map(s => s.trim()).filter(Boolean),
          conclusion: get('核心结论'), researchQ: get('研究问题'), sample: get('样本'),
          method: get('方法'), coreResults: get('核心结果'), limitations: get('局限'),
          connection: get('连接'), formedQuestion: get('可形成问题'),
        });
        added++;
      }
      saveState(); renderLiterature();
      await alertDialog('已导入 ' + added + ' 条文献', { icon: '✅' });
    } catch (e) { await alertDialog('导入失败：' + (e.message || e), { icon: '⚠️' }); }
  };
  reader.readAsText(file);
}
async function clearAllData() {
  if (!(await confirmDialog('⚠️ 这将清空全部本地数据（项目/任务/笔记/记账/健身等），且无法通过此按钮恢复。\n确定要继续吗？', { icon: '⚠️' }))) return;
  if (!(await confirmDialog('⚠️ 二次确认：真的要清空所有数据吗？建议先点「导出全部 JSON」备份。', { icon: '⚠️', requireText: '确认清空', confirmText: '清空全部数据' }))) return;
  state = defaultState();
  state.calMonth = curMonth();
  state.financeMonth = curMonthStr();
  seed();
  saveState();
  render();
  await alertDialog('已清空并重置为初始示例数据', { icon: '✅' });
}
function renderBackup() {
  const main = document.getElementById('main');
  const last = state.lastBackup ? fmtDateTime(state.lastBackup) : '从未备份';
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">数据备份</div><div class="view-sub">本地数据定期备份，防止丢失（云同步未上线前尤其重要）</div></div>
    </div>
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <span>最近备份：<b>${last}</b></span>
      </div>
      <div class="backup-actions">
        <button class="btn btn-primary" onclick="exportAll()">⬇ 导出全部 JSON</button>
        <label class="btn btn-outline">⬆ 从 JSON 恢复<input type="file" accept="application/json" style="display:none;" onchange="if(this.files[0])importAll(this.files[0])"></label>
        <button class="btn btn-outline" onclick="exportLitCSV()">📚 文献导出 CSV</button>
        <button class="btn btn-danger-ghost" onclick="clearAllData()">🗑 清空数据</button>
      </div>
      <p class="backup-note">导出文件保存在本机下载目录，可通过 AirDrop 在 iPhone / Mac / Windows 之间传递实现手动同步。升级后旧数据会自动迁移，不会丢失。</p>
    </div>
    <div class="card card-pad" style="margin-top:16px;">
      <div class="card-head" style="padding:0 0 12px;border:none;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3>📄 一键周报 / 月报</h3>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="genReport('week')">生成周报</button>
          <button class="btn btn-ghost btn-sm" onclick="genReport('month')">生成月报</button>
        </div>
      </div>
      <textarea class="input" id="reportArea" rows="14" placeholder="点击上方按钮，自动汇总本周 / 本月完成的任务、项目进展、进度记录…"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-primary btn-sm" onclick="copyReport()">📋 复制报告</button>
      </div>
    </div>`;
}

/* ---------- 一键周报 / 月报 ---------- */
function fmtDateYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function generateReport(kind) {
  const isWeek = kind === 'week';
  const label = isWeek ? '周' : '月';
  const now = new Date();
  const td = todayStr();
  let startStr;
  if (isWeek) {
    const day = now.getDay() || 7; // 周日 = 7
    const s = new Date(now);
    s.setDate(now.getDate() - (day - 1));
    startStr = fmtDateYMD(s);
  } else {
    startStr = fmtDateYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  const doneTasks = state.tasks.filter(t => t.doneDate && t.doneDate >= startStr && t.doneDate <= td);
  const logs = state.progressLogs.filter(l => l.date && l.date >= startStr && l.date <= td);
  const active = state.projects.filter(p => p.status === '进行中');
  const wp = isWeek ? getWeeklyPlan() : null;

  const L = [];
  L.push(`【本${label}工作汇报】`);
  L.push(`（${startStr} ~ ${td}）`);
  L.push('');
  L.push(`一、本${label}完成任务（${doneTasks.length} 项）`);
  if (doneTasks.length) {
    doneTasks.forEach(t => {
      const p = state.projects.find(x => x.id === t.projectId);
      L.push(`- ${p ? '[' + p.code + '] ' : ''}${t.name}`);
    });
  } else { L.push('- （无）'); }
  L.push('');

  L.push(`二、进行中项目进展（${active.length} 个）`);
  if (active.length) {
    active.forEach(p => {
      const done = projDoneCount(p.id), total = projTotalCount(p.id);
      L.push(`- ${p.code} ${p.title}：阶段「${p.phase || '—'}」，下一步「${p.nextStep || '—'}」，任务 ${done}/${total}${p.deadline ? '，截止 ' + p.deadline : ''}`);
    });
  } else { L.push('- （无进行中项目）'); }
  L.push('');

  if (logs.length) {
    L.push(`三、进度记录（${logs.length} 条）`);
    logs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(l => {
      const p = state.projects.find(x => x.id === l.projectId);
      L.push(`- ${l.date} ${p ? '[' + p.code + '] ' : ''}${(l.evidence || '').slice(0, 50)}`);
    });
    L.push('');
  }

  if (wp && (wp.items || []).length) {
    L.push(`四、下周计划（${wp.items.length} 项）`);
    wp.items.forEach(it => L.push(`- ${it.name}`));
    L.push('');
  }

  L.push(`—— 生成于 ${fmtDateFull(td)} · Canming's Life Projects`);
  return L.join('\n');
}
function genReport(kind) {
  const area = document.getElementById('reportArea');
  if (area) area.value = generateReport(kind);
}
async function copyReport() {
  const area = document.getElementById('reportArea');
  const text = area ? area.value : '';
  if (!text) { await alertDialog('请先生成报告', { icon: '⚠️' }); return; }
  try { await navigator.clipboard.writeText(text); await alertDialog('报告已复制到剪贴板', { icon: '✅' }); }
  catch (e) { await alertDialog('复制失败，请手动全选复制', { icon: '⚠️' }); }
}

/* ---------- 深色模式 ---------- */
function renderThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  [['themeIcon', 'themeLabel'], ['themeIconDrawer', 'themeLabelDrawer']].forEach(([iid, lid]) => {
    const icon = document.getElementById(iid);
    const label = document.getElementById(lid);
    if (icon) icon.textContent = dark ? '☀️' : '🌙';
    if (label) label.textContent = dark ? '浅色模式' : '深色模式';
  });
}
function setTheme(t) {
  const v = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', v);
  try { localStorage.setItem('wb_theme', v); } catch (e) {}
  renderThemeBtn();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(cur ? 'light' : 'dark');
}
function loadTheme() {
  let t = 'light';
  try { t = localStorage.getItem('wb_theme') || 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
  renderThemeBtn();
}

/* ============================================================
   只读分享（第三部分）
   —— 服务端快照 + 随机 token；只读页面 share.html 仅调 wb_get_share
   ============================================================ */
const SHARE_MODULES = [
  { key: 'projects', label: '项目概览', ico: '📁' },
  { key: 'progress', label: '项目进度', ico: '📈' },
  { key: 'goals',    label: '年度目标', ico: '🎯' },
  { key: 'culture',  label: '文化生活', ico: '🎭' },
];
async function shareRpc(name, params) {
  if (!sb) throw new Error('云同步未初始化，请先登录');
  const { data, error } = await sb.rpc(name, params || {});
  if (error) throw new Error(error.message || error.details || '调用失败');
  return data;
}
function shareLinkFor(token) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return base + 'share.html?t=' + token;
}
function renderShare() {
  const main = document.getElementById('main');
  if (!syncUser) {
    main.innerHTML = `
      <div class="view-head"><div><div class="view-title">🔗 只读分享</div>
        <div class="view-sub">把项目概览 / 项目进度 / 年度目标 / 文化生活做成只读链接给别人看</div></div></div>
      <div class="card card-pad"><div class="empty"><span class="emoji">🔒</span>请先登录（☁️ 登录同步）后再创建分享</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="view-head">
      <div><div class="view-title">🔗 只读分享</div>
        <div class="view-sub">服务端生成过滤快照 + 随机链接；对方只能看，改不了任何数据</div></div>
      <button class="btn btn-primary" onclick="shareCreate()">创建分享</button>
    </div>

    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="fld">分享标题</div>
      <input type="text" class="input" id="shTitle" placeholder="如：博士申请进度（给老师看）" maxlength="60" style="margin-bottom:10px;">
      <div class="fld">选择要分享的模块（其余数据不会进入分享快照）</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px;">
        ${SHARE_MODULES.map(m => `<label class="sh-chk"><input type="checkbox" value="${m.key}" checked> ${m.ico} ${m.label}</label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="fld" style="margin:0;">有效期</div>
        <select class="select" id="shExpiry" style="width:140px;">
          <option value="0">永久有效</option>
          <option value="1">1 天</option>
          <option value="7" selected>7 天</option>
          <option value="30">30 天</option>
          <option value="90">90 天</option>
        </select>
        <span style="color:var(--text-3);font-size:12px;">分享后随时可暂停 / 撤销</span>
      </div>
    </div>

    <div class="card card-pad">
      <div class="card-head" style="padding:0 0 12px;border:none;"><h3>我的分享</h3></div>
      <div id="shareList"><div class="empty">加载中…</div></div>
    </div>`;
  refreshShareList();
}
async function refreshShareList() {
  const box = document.getElementById('shareList');
  if (!box) return;
  try {
    const list = await shareRpc('wb_list_shares');
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="empty">还没有创建过分享</div>';
      return;
    }
    const mlabel = k => (SHARE_MODULES.find(m => m.key === k) || {}).label || k;
    box.innerHTML = list.map(s => {
      const st = s.revoked
        ? '<span class="badge b-red">已撤销</span>'
        : s.paused
          ? '<span class="badge b-amber">已暂停</span>'
          : '<span class="badge b-green">生效中</span>';
      const mods = (s.modules || []).map(m => `<span class="badge b-orange" style="font-size:10px;">${escapeHtml(mlabel(m))}</span>`).join(' ');
      const exp = s.expires_at ? `· 过期 ${fmtDate(s.expires_at)}` : '· 永久有效';
      const btns = [];
      if (!s.revoked) {
        btns.push(`<button class="btn btn-ghost btn-sm" onclick="shareCopy('${s.token}')">📋 复制链接</button>`);
        btns.push(`<button class="btn btn-ghost btn-sm" onclick="shareTogglePause('${s.token}',${s.paused})">${s.paused ? '▶ 恢复' : '⏸ 暂停'}</button>`);
        btns.push(`<button class="btn btn-danger-ghost btn-sm" onclick="shareRevoke('${s.token}')">⛔ 撤销</button>`);
      }
      btns.push(`<button class="btn btn-danger-ghost btn-sm" onclick="shareDelete('${s.token}')">🗑 删除</button>`);
      return `<div class="sh-row">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <b>${escapeHtml(s.title)}</b>${st}
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px;">
            ${mods}<span class="cul-dim">创建 ${fmtDateTime(s.created_at)} ${exp}</span>
          </div>
          <div class="cul-dim" style="margin-top:4px;word-break:break-all;">${escapeHtml(shareLinkFor(s.token))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;">${btns.join('')}</div>
      </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}
async function shareCreate() {
  const title = (document.getElementById('shTitle').value || '').trim();
  const modules = [...document.querySelectorAll('.sh-chk input:checked')].map(el => el.value);
  if (!modules.length) { await alertDialog('请至少选择一个要分享的模块', { icon: '⚠️' }); return; }
  const days = parseInt(document.getElementById('shExpiry').value) || 0;
  try {
    const res = await shareRpc('wb_create_share', { title, modules, expires_in_days: days || null });
    const link = shareLinkFor(res.token);
    await navigator.clipboard.writeText(link).catch(() => {});
    await alertDialog('分享已创建，链接已复制到剪贴板：\n' + link, { icon: '✅' });
    refreshShareList();
  } catch (e) {
    await alertDialog('创建失败：' + e.message, { icon: '⚠️' });
  }
}
async function shareCopy(token) {
  const link = shareLinkFor(token);
  try { await navigator.clipboard.writeText(link); await alertDialog('链接已复制：\n' + link, { icon: '✅' }); }
  catch (e) { await alertDialog('复制失败，请手动复制：\n' + link, { icon: '⚠️' }); }
}
async function shareTogglePause(token, paused) {
  try { await shareRpc('wb_pause_share', { token, paused: !paused }); refreshShareList(); }
  catch (e) { await alertDialog('操作失败：' + e.message, { icon: '⚠️' }); }
}
async function shareRevoke(token) {
  if (!(await confirmDialog('永久撤销该分享？撤销后链接立即失效且不可恢复。', { icon: '⚠️' }))) return;
  try { await shareRpc('wb_revoke_share', { token }); refreshShareList(); }
  catch (e) { await alertDialog('操作失败：' + e.message, { icon: '⚠️' }); }
}
async function shareDelete(token) {
  if (!(await confirmDialog('删除该分享记录？', { icon: '🗑️' }))) return;
  try { await shareRpc('wb_delete_share', { token }); refreshShareList(); }
  catch (e) { await alertDialog('操作失败：' + e.message, { icon: '⚠️' }); }
}

/* ============================================================
   种子数据（6 个项目）
   ============================================================ */
function seed() {
  const ioc = uid(), fmri = uid(), liulu = uid(), mid = uid(), yong = uid(), ddt = uid();
  const projects = [
    { id: ioc, code: 'IOC_MDD', title: '实验SCI · 抑郁症ERP研究', label: 'A1 主攻', status: '进行中',
      description: '控制错觉对抑郁症患者奖赏加工过程的调控机制（ERP）。实验和数据收集已完成，进入数据分析最后确认阶段。当前最不透明的项目，需尽快补充最新进度。',
      phase: '数据分析最后确认', nextStep: '建立"最终分析现状与待确认问题清单"', deadline: null, blocked: false },
    { id: fmri, code: 'fMRI_analysis', title: 'fMRI学习 · 长期学习与中文PPT', label: '长期项目', status: '进行中',
      description: '2027年1月前完成一套完整可供他人学习的中文任务态fMRI PPT。长期原则：每日学习结果转化为PPT素材。现有材料 fMRI_Part1.pptx、SPM12.pptx、核磁学习1.pptx（只读，不覆盖）。',
      phase: '起点整理', nextStep: '整理三份原始PPT材料', deadline: '2027-01-31', blocked: false },
    { id: liulu, code: 'Ph.D_Liulu', title: '刘璐老师博士计划', label: '重要', status: '进行中',
      description: '形成有证据支撑、与经历和刘老师团队方向匹配的博士计划，9月底携真实进展再次联系刘老师。方向：儿童青少年精神医学、ADHD、执行功能、情绪调节及神经机制。',
      phase: '文献证据积累', nextStep: '建立文献证据表并录入首篇精读', deadline: '2026-09-30', blocked: false },
    { id: mid, code: 'MID_Gao', title: 'MID_Gao 医院数据', label: '医院数据', status: '进行中',
      description: '医院 MID 任务数据（E-Prime TXT）处理。注意：MATLAB 函数已完成，但尚未用真实完整 E-Prime TXT 验证，不能记为流程已跑通。',
      phase: '脚本实现', nextStep: '用真实完整 E-Prime TXT 验证 MATLAB 函数', deadline: null, blocked: false },
    { id: yong, code: '永州NSSI', title: '永州青少年NSSI实验', label: '短期', status: '待启动',
      description: '2026年9月赴湖南永州参与青少年非自杀性自伤（NSSI）项目，完成实际实验职责，积累儿童青少年临床研究经验。',
      phase: '行前准备', nextStep: '确认行程与住宿', deadline: '2026-09-30', blocked: false },
    { id: ddt, code: 'DDT_fMRI', title: '核磁数据处理', label: '八月底截止', status: '进行中',
      description: '手头待处理的核磁数据，八月底尽量完成处理。与fMRI_analysis同属核磁能力线，但作为独立项目单独追踪截止时间。',
      phase: '数据预处理', nextStep: '数据整理与质量检查', deadline: '2026-08-31', blocked: false },
  ];

  // 统一任务库（项目 → 任务组 → 执行任务）
  const T = [];
  const t = (o) => T.push(Object.assign(
    { id: uid(), type: 'project', planDate: null, dueDate: null, quad: null, status: '未开始', note: '', doneDate: null }, o));

  // IOC_MDD：演示三级结构
  const gData = uid(), gWrite = uid(), gRead = uid();
  t({ id: gData, name: '数据处理', projectId: ioc, parentId: ioc, level: 2 });
  t({ id: gWrite, name: '论文撰写', projectId: ioc, parentId: ioc, level: 2 });
  t({ id: gRead, name: '分析确认', projectId: ioc, parentId: ioc, level: 2 });
  t({ name: '行为数据处理', projectId: ioc, parentId: gData, level: 3 });
  t({ name: '脑电数据处理', projectId: ioc, parentId: gData, level: 3 });
  t({ name: 'Results', projectId: ioc, parentId: gWrite, level: 3 });
  t({ name: 'Discussion', projectId: ioc, parentId: gWrite, level: 3 });
  t({ name: '全文整合与投稿', projectId: ioc, parentId: gWrite, level: 3 });
  t({ name: '建立"最终分析现状与待确认问题清单"', projectId: ioc, parentId: gRead, level: 3 });
  t({ name: '确认最终样本量与排除规则冻结', projectId: ioc, parentId: gRead, level: 3 });
  t({ name: '确定主分析与补充分析划分', projectId: ioc, parentId: gRead, level: 3 });
  t({ name: '确定最终统计模型', projectId: ioc, parentId: gRead, level: 3 });
  t({ name: '生成主结果表和主图', projectId: ioc, parentId: gRead, level: 3 });

  // fMRI_analysis
  t({ name: '8月：起点整理、fMRI基本原理、Unix/BIDS基础', projectId: fmri, parentId: fmri, level: 3, dueDate: '2026-08-31' });
  t({ name: '整理现有三份原始PPT材料（只读）', projectId: fmri, parentId: fmri, level: 3 });
  t({ name: '9-12月阶段主题规划', projectId: fmri, parentId: fmri, level: 3 });
  t({ name: '每次学习记录：章节/页码/图或代码证据/未理解点', projectId: fmri, parentId: fmri, level: 3 });

  // Ph.D_Liulu
  t({ name: '建立文献证据表', projectId: liulu, parentId: liulu, level: 3 });
  t({ name: '录入第一篇结构化精读记录', projectId: liulu, parentId: liulu, level: 3 });
  t({ name: '形成3个候选研究问题', projectId: liulu, parentId: liulu, level: 3 });
  t({ name: '比较候选问题（意义/创新性/可行性/匹配度）', projectId: liulu, parentId: liulu, level: 3 });
  t({ name: '确定主方向', projectId: liulu, parentId: liulu, level: 3 });
  t({ name: '形成1-2页博士计划', projectId: liulu, parentId: liulu, level: 3, dueDate: '2026-09-20' });
  t({ name: '更新简历和5分钟科研汇报', projectId: liulu, parentId: liulu, level: 3, dueDate: '2026-09-25' });
  t({ name: '9月底携真实进展联系刘老师', projectId: liulu, parentId: liulu, level: 3, dueDate: '2026-09-30' });

  // MID_Gao
  t({ name: 'MATLAB 函数实现（读取与解析 E-Prime TXT）', projectId: mid, parentId: mid, level: 3, status: '已完成', doneDate: todayStr() });
  t({ name: '用真实完整 E-Prime TXT 验证 MATLAB 函数', projectId: mid, parentId: mid, level: 3 });
  t({ name: '输出 MID 行为指标', projectId: mid, parentId: mid, level: 3 });

  // 永州NSSI
  t({ name: '确认行程与住宿', projectId: yong, parentId: yong, level: 3, dueDate: '2026-09-01' });
  t({ name: '了解实验流程与职责', projectId: yong, parentId: yong, level: 3, dueDate: '2026-09-10' });
  t({ name: '完成实验参与', projectId: yong, parentId: yong, level: 3, dueDate: '2026-09-30' });
  t({ name: '总结临床研究经验', projectId: yong, parentId: yong, level: 3 });

  // DDT_fMRI
  t({ name: '数据整理与质量检查', projectId: ddt, parentId: ddt, level: 3, dueDate: '2026-08-20' });
  t({ name: '预处理流程', projectId: ddt, parentId: ddt, level: 3, dueDate: '2026-08-25' });
  t({ name: '统计分析', projectId: ddt, parentId: ddt, level: 3, dueDate: '2026-08-28' });
  t({ name: '结果输出', projectId: ddt, parentId: ddt, level: 3, dueDate: '2026-08-31' });

  const habits = [
    { id: uid(), name: '读书' },
    { id: uid(), name: '运动' },
    { id: uid(), name: '写日记' },
  ];

  // 文化生活示例（书籍 / 电影 / 播客，单一作品库）
  const nowTs = Date.now();
  state.cultural = [
    {
      id: uid(), name: '三体', type: 'book', status: '已完成', category: '科幻', year: '2008',
      creator: '刘慈欣', rating: 5, feel: '宇宙尺度上的浪漫与冷酷',
      startDate: '2026-06-01', endDate: '2026-06-20', tags: ['科幻', '小说'],
      reason: '科幻经典，补上宇宙观这一课。', core: '三体文明与人类的对抗，黑暗森林法则。',
      fav: '「给岁月以文明，而不是给文明以岁月。」', thought: '读完久久无法平静。', insight: '人类渺小，但选择本身有意义。',
      createdAt: nowTs - 3000,
    },
    {
      id: uid(), name: '星际穿越', type: 'movie', status: '想读想看', category: '科幻', year: '2014',
      creator: '克里斯托弗·诺兰', rating: 0, feel: '', tags: [], createdAt: nowTs - 2000,
    },
    {
      id: uid(), name: '得意忘形', type: 'podcast', status: '进行中', category: '个人成长', year: '',
      creator: '张潇雨', rating: 0, feel: '常听常新，陪跑通勤', tags: ['播客'], createdAt: nowTs - 1000,
    },
  ];

  const goals = [
    {
      id: uid(), title: '完成自己的 SCI 并形成投稿成果', year: 2026,
      accept: 'IOC_MDD 数据分析冻结、主结果表与主图生成、Results/Discussion 完成并投稿 SCI。',
      status: '进行中', deadline: '2026-12-31', projectId: ioc, progress_note: '实验与数据收集已完成，进入结果确认阶段。',
    },
    {
      id: uid(), title: '完成 2027 北大六院博士申请准备', year: 2026,
      accept: '形成 1-2 页博士计划、更新简历与 5 分钟汇报、9 月底携真实进展再联系刘璐老师。',
      status: '进行中', deadline: '2026-09-30', projectId: liulu, progress_note: '已联系刘璐老师，等待 9 月携进展再沟通。',
    },
    {
      id: uid(), title: '建立可复现的 fMRI 分析能力', year: 2026,
      accept: '真正掌握 fMRI 分析，完成中文任务态 fMRI PPT，形成可展示的代码与模型成果。',
      status: '进行中', deadline: '2027-01-31', projectId: fmri, progress_note: '8 月起点整理、fMRI 基本原理、Unix/BIDS 基础。',
    },
  ];

  state.projects = projects;
  state.tasks = T;
  state.selectedProjectId = ioc;
  state.habits = { items: habits, log: {} };
  state.goals = goals;
  state.calEvents = [];
  saveState();
}

/* ============================================================
   初始化
   ============================================================ */
function init() {
  loadLocal();
  loadOfflinePending(); // 恢复离线未同步标记（防止刷新后 pull 覆盖本地改动）
  loadTheme(); // 恢复深色/浅色偏好
  initSync().then(() => {
    renderAuthArea();
    render();
    setupMobileNav();
  });
  // 离线 / 在线监听：离线提示；恢复网络后若有未同步改动则弹提示条
  window.addEventListener('offline', () => {
    setSyncStatus('离线', 'err');
  });
  window.addEventListener('online', () => {
    if (offlinePending) showSyncBanner();
    else queuePush();
  });
  // 注册 Service Worker（PWA 离线缓存；仅 HTTPS/localhost 生效）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);

/* ============================================================
   云同步建表 SQL（在 Supabase → SQL Editor 里执行一次）
   ============================================================
   create table if not exists workbench_state (
     user_id uuid primary key references auth.users(id) on delete cascade,
     data jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );
   alter table workbench_state enable row level security;
   drop policy if exists "own_row" on workbench_state;
   create policy "own_row" on workbench_state
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

   -- 开启实时同步：Database → Replication → 把 workbench_state 加入 publication
   -- 或在 SQL Editor 执行：
   -- alter publication supabase_realtime add table workbench_state;
   ============================================================ */
