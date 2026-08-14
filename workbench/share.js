/* ============================================================
   share.js —— 只读分享页（第三部分）
   * 本页只调用 wb_get_share(token)（服务端只读函数），
     不存在任何写操作；即使篡改脚本也写不进数据库
   * 展示数据来自创建分享时服务端过滤后的快照，
     不含记账/健身/习惯/笔记等隐私模块
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://ovoxuecbclvgrvlfgjpk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92b3h1ZWNiY2x2Z3J2bGZnanBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NzE4ODQsImV4cCI6MjEwMjI0Nzg4NH0.SlHL9t3C9nkogVkQNYqS0YdbmsH3K0BaXsOQPM8-fyo';

const app = document.getElementById('shareApp');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}
function fmtDateFull(s) {
  if (!s) return '';
  return fmtDate(s);
}
function starsHtml(r) {
  const n = Number(r) || 0;
  if (n <= 0) return '<span class="cul-stars none">未评分</span>';
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '<span class="on">★</span>' : '<span>☆</span>';
  return `<span class="cul-stars">${s}</span>`;
}

const MODULE_LABELS = {
  projects: '项目概览',
  progress: '项目进度',
  goals: '年度目标',
  culture: '文化生活',
};

function showStatus(title, msg) {
  app.innerHTML = `
    <div class="view-head"><div><div class="view-title">🔗 只读分享</div></div></div>
    <div class="card card-pad" style="max-width:560px;margin:0 auto;">
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:34px;margin-bottom:10px;">📎</div>
        <div style="font-size:16px;font-weight:700;">${esc(title)}</div>
        <div style="color:var(--text-3);font-size:13px;margin-top:8px;">${esc(msg)}</div>
      </div>
    </div>`;
}

async function load() {
  const token = new URLSearchParams(location.search).get('t');
  if (!token) { showStatus('链接无效', '缺少分享令牌参数。'); return; }
  let sb;
  try {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    showStatus('加载失败', '无法初始化数据服务。');
    return;
  }
  const { data, error } = await sb.rpc('wb_get_share', { token });
  if (error) {
    showStatus('无法打开分享', error.message || '分享无效或已失效。');
    return;
  }
  render(data);
}

function render(share) {
  const modules = Array.isArray(share.modules) ? share.modules : (share.modules || []);
  const data = share.data || {};
  const chips = modules.map(m => `<span class="badge b-orange">${esc(MODULE_LABELS[m] || m)}</span>`).join(' ');
  const exp = share.expires_at ? `<span class="badge b-gray">有效期至 ${fmtDate(share.expires_at)}</span>` : '<span class="badge b-gray">永久有效</span>';
  const created = share.created_at ? `创建于 ${fmtDate(share.created_at)}` : '';

  let body = '';
  if (modules.includes('projects') && data.projects && data.projects.length) {
    body += `<h3 class="share-sec">📁 项目概览</h3>
      <div class="grid grid-2">
        ${data.projects.map(p => {
          const total = p.total || 0;
          const done = p.done || 0;
          const pct = total ? Math.round(done / total * 100) : 0;
          return `<div class="card card-pad">
            <div class="pc-top"><span class="pc-code">${esc(p.code)}</span><span class="badge b-orange">${esc(p.label || '')}</span>${p.blocked ? '<span class="badge b-red">阻塞</span>' : ''}</div>
            <div class="pc-title">${esc(p.title || '')}</div>
            <div style="font-size:12.5px;color:var(--text-2);margin-bottom:8px;">状态：<b>${esc(p.status || '—')}</b> · 阶段：${esc(p.phase || '—')}</div>
            ${p.description ? `<div style="font-size:12.5px;color:var(--text-2);margin-bottom:8px;line-height:1.6;">${esc(p.description)}</div>` : ''}
            <div style="font-size:12.5px;color:var(--text-2);margin-bottom:6px;">下一步：${esc(p.nextStep || '—')} · 截止：${p.deadline ? fmtDate(p.deadline) : '—'}</div>
            <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div style="font-size:11.5px;color:var(--text-3);margin-top:4px;">已完成 ${done}/${total}</div>
          </div>`;
        }).join('')}
      </div>`;
  }
  if (modules.includes('progress') && data.progress && data.progress.length) {
    body += `<h3 class="share-sec">📈 项目进度</h3><div class="card card-pad">
      ${data.progress.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(l => {
        const v = { verified: ['v-ok', '已验证'], impl: ['v-imp', '实现未验证'], na: ['v-na', '不适用'] }[l.verify] || ['', ''];
        const row = (label, val) => val ? `<div class="le-row"><b>${label}</b><span style="white-space:pre-wrap;">${esc(val)}</span></div>` : '';
        return `<div class="log-entry">
          <div class="le-top"><span class="badge b-gray">${esc(l.date || '')}</span><span class="v-badge ${v[0]}">${v[1]}</span></div>
          ${row('证据', l.evidence)}${row('问题', l.problems)}${row('阻塞', l.blocker)}${row('下一步', l.next)}
        </div>`;
      }).join('')}
    </div>`;
  }
  if (modules.includes('goals') && data.goals && data.goals.length) {
    body += `<h3 class="share-sec">🎯 年度目标</h3>
      <div class="grid grid-2">
        ${data.goals.map(g => `<div class="goal-card">
          <div class="gc-top"><span class="gc-title">${esc(g.title || '')}</span><span class="badge b-teal">${esc(g.status || '进行中')}</span></div>
          <div class="gc-detail"><b>验收标准：</b>${esc(g.accept || g.detail || '（待填）')}</div>
          ${g.deadline ? `<div style="font-size:12px;color:var(--text-3);">截止 ${fmtDate(g.deadline)}</div>` : ''}
          ${g.progress_note ? `<div class="gc-detail" style="margin-top:6px;"><b>最近进展：</b>${esc(g.progress_note)}</div>` : ''}
        </div>`).join('')}
      </div>`;
  }
  if (modules.includes('culture') && data.culture && data.culture.length) {
    const tMap = { book: ['📖', '书籍'], movie: ['🎬', '电影'], podcast: ['🎙️', '播客'] };
    body += `<h3 class="share-sec">🎭 文化生活</h3>
      ${data.culture.map(w => {
        const t = tMap[w.type] || ['📄', w.type || ''];
        const meta = [`<span class="badge b-gray">${t[1]}</span>`];
        if (w.status) meta.push(`<span class="badge b-orange">${esc(w.status)}</span>`);
        if (w.category) meta.push(`<span class="badge b-gray">${esc(w.category)}</span>`);
        if (w.year) meta.push(`<span class="cul-dim">${esc(w.year)}</span>`);
        if (w.creator) meta.push(`<span class="cul-dim">${esc(w.creator)}</span>`);
        return `<div class="cul-card" style="cursor:default;">
          <div class="cul-ico">${t[0]}</div>
          <div class="cul-body">
            <div class="cul-top"><span class="cul-name">${esc(w.name)}</span>${starsHtml(w.rating)}</div>
            <div class="cul-meta">${meta.join(' ')}</div>
            ${w.feel ? `<div class="cul-feel">${esc(w.feel)}</div>` : ''}
            ${(w.tags || []).length ? `<div class="cul-tags">${w.tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>
        </div>`;
      }).join('')}`;
  }

  app.innerHTML = `
    <div class="view-head">
      <div>
        <div class="view-title">🔗 ${esc(share.title || '我的工作台分享')}</div>
        <div class="view-sub">${created} · 由分享者提供</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${chips}${exp}</div>
    </div>
    ${body || '<div class="card card-pad"><div class="empty">该分享暂无可展示的内容</div></div>'}
    <div style="margin-top:26px;text-align:center;color:var(--text-3);font-size:12px;">
      本页面为只读分享，仅展示分享者筛选后的数据 · Canming's Life Projects
    </div>`;
}

load();
