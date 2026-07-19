/**
 * Admin dashboard client. Survives refresh & logout via localStorage-persisted JWT.
 * Backend base is auto-detected: same origin as this HTML.
 */
const API = window.location.origin;
const STORAGE_TOKEN = 'gala.admin.token';
const STORAGE_USER = 'gala.admin.user';

let TOKEN = localStorage.getItem(STORAGE_TOKEN) || null;
let CACHE = { stats: null, leaderboard: [], transactions: [], voters: [], categories: [] };

// ---------- API helper ----------
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    logout(); throw new Error('Session expired');
  }
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || 'Request failed');
  return body;
}

// ---------- Toast ----------
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Login / Logout ----------
async function login() {
  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  const err = document.getElementById('loginErr');
  err.textContent = '';
  if (!username || !password) { err.textContent = 'Enter your credentials.'; return; }
  try {
    const res = await fetch(API + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Login failed'; return; }
    TOKEN = data.token;
    localStorage.setItem(STORAGE_TOKEN, TOKEN);
    localStorage.setItem(STORAGE_USER, JSON.stringify(data.admin));
    enterDashboard();
  } catch (e) { err.textContent = 'Could not reach server.'; }
}
function logout() {
  TOKEN = null;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  document.getElementById('dashView').style.display = 'none';
  document.getElementById('loginView').style.display = 'flex';
}
function enterDashboard() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashView').style.display = 'grid';
  const u = JSON.parse(localStorage.getItem(STORAGE_USER) || '{}');
  document.getElementById('sideUser').textContent = u.username || 'admin';
  refreshAll();
  startAutoRefresh();
}

// ---------- Navigation ----------
const CRUMBS = {
  overview:      ['Overview',      'Live at-a-glance metrics'],
  leaderboard:   ['Leaderboard',   'Complete rankings across every category'],
  transactions:  ['Transactions',  'Every payment attempt, live'],
  wallet:        ['Wallet',        'Successful M-Pesa payments only'],
  voters:        ['Voters',        'Registered accounts and their activity'],
  manage:        ['Nominees',      'Add, remove and adjust nominee votes'],
  log:           ['Activity Log',  'What organisers have done recently']
};
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.style.display = v.dataset.view === name ? '' : 'none');
  const [c, s] = CRUMBS[name] || [name, ''];
  document.getElementById('crumb').textContent = c;
  document.getElementById('crumbSub').textContent = s;
}
document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => switchView(n.dataset.view)));

// ---------- Data fetch ----------
async function refreshAll() {
  try {
    const [stats, lb, tx, voters, cats] = await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/leaderboard'),
      api('/api/admin/transactions?limit=300'),
      api('/api/admin/voters'),
      api('/api/categories')
    ]);
    CACHE.stats = stats;
    CACHE.leaderboard = lb.rows;
    CACHE.transactions = tx.transactions;
    CACHE.voters = voters.voters;
    CACHE.categories = cats.categories;
    render();
  } catch (e) {
    if (!/session/i.test(e.message)) toast(e.message, 'err');
  }
}

let autoTimer = null;
function startAutoRefresh() {
  clearInterval(autoTimer);
  autoTimer = setInterval(refreshAll, 6000);
}

// ---------- Render ----------
function fmtKES(n) { return 'KES ' + (n || 0).toLocaleString(); }
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statPill(s) {
  const cls = s === 'success' ? 'ok' : s === 'failed' ? 'fail' : 'pending';
  return `<span class="pill ${cls}">${s}</span>`;
}

function render() {
  renderStats();
  renderOverview();
  renderLeaderboard();
  renderTransactions();
  renderWallet();
  renderVoters();
  renderManage();
  renderLog();
}

function renderStats() {
  const s = CACHE.stats || {};
  document.getElementById('statsGrid').innerHTML = `
    ${statCard('Total votes', (s.totalVotes||0).toLocaleString(), 'Paid + bonus')}
    ${statCard('Paid votes', (s.paidVotes||0).toLocaleString(), 'From M-Pesa')}
    ${statCard('Bonus votes', (s.bonusVotes||0).toLocaleString(), 'Admin-added')}
    ${statCard('Revenue', fmtKES(s.revenue), 'Successful payments')}
    ${statCard('Transactions', (s.txCount||0).toLocaleString(), (s.pendingCount||0)+' pending')}
    ${statCard('Voters', (s.voters||0).toLocaleString(), 'Registered accounts')}
  `;
}
function statCard(lbl, val, sub) {
  return `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val">${val}</div><div class="stat-delta">${sub||''}</div></div>`;
}

function renderOverview() {
  const top = [...CACHE.leaderboard].sort((a, b) => b.total_votes - a.total_votes).slice(0, 8);
  document.getElementById('topList').innerHTML = top.length ? top.map((r, i) => `
    <div class="top-row">
      <div class="top-rank">${i + 1}</div>
      <div class="top-info">
        <div class="top-name">${escapeHtml(r.nominee)}</div>
        <div class="top-cat">${escapeHtml(r.category)}</div>
      </div>
      <div class="top-votes">${r.total_votes.toLocaleString()}</div>
    </div>
  `).join('') : '<div class="empty">No votes yet.</div>';

  const recent = CACHE.transactions.filter(t => t.status === 'success').slice(0, 8);
  document.getElementById('txMini').innerHTML = recent.length ? recent.map(t => `
    <div class="tx-mini-row">
      <div class="tx-mini-left">
        <div class="tx-mini-l1">${escapeHtml(t.nominee)} · ${t.votes} vote${t.votes===1?'':'s'}</div>
        <div class="tx-mini-l2">${escapeHtml(t.receipt)} · ${escapeHtml(t.phone)} · ${fmtTime(t.completed_at || t.created_at)}</div>
      </div>
      <div class="tx-mini-amt">+${fmtKES(t.amount)}</div>
    </div>
  `).join('') : '<div class="empty">No payments yet.</div>';
}

function renderLeaderboard() {
  const q = (document.getElementById('lbSearch').value || '').toLowerCase();
  const rows = CACHE.leaderboard.filter(r => !q || r.nominee.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  let lastCat = null;
  let html = '';
  rows.forEach(r => {
    if (r.category !== lastCat) {
      html += `<tr class="cat-hdr"><td colspan="7">${escapeHtml(r.category)}</td></tr>`;
      lastCat = r.category;
    }
    html += `
      <tr>
        <td></td>
        <td>${escapeHtml(r.nominee)}${r.detail ? '<div style="color:var(--detail);font-size:11px;margin-top:2px;">'+escapeHtml(r.detail)+'</div>' : ''}</td>
        <td class="num">${r.paid_votes.toLocaleString()}</td>
        <td class="num">${r.bonus_votes.toLocaleString()}</td>
        <td class="num" style="color:var(--gold-bright);font-weight:600;">${r.total_votes.toLocaleString()}</td>
        <td class="num">${fmtKES(r.revenue)}</td>
        <td><button class="row-btn" onclick="openBonus(${r.nominee_id})">Adjust</button></td>
      </tr>`;
  });
  document.getElementById('lbBody').innerHTML = html || '<tr><td colspan="7" class="empty">No nominees.</td></tr>';
}

function renderTransactions() {
  const q = (document.getElementById('txSearch').value || '').toLowerCase();
  const f = document.getElementById('txFilter').value;
  const rows = CACHE.transactions.filter(t =>
    (!f || t.status === f) &&
    (!q || (t.receipt||'').toLowerCase().includes(q) || (t.phone||'').toLowerCase().includes(q))
  );
  document.getElementById('txBody').innerHTML = rows.length ? rows.map(t => `
    <tr>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;">${escapeHtml(t.receipt)}</td>
      <td>${statPill(t.status)}</td>
      <td>${escapeHtml(t.voter_name || '—')}</td>
      <td class="num">${escapeHtml(t.phone)}</td>
      <td>${escapeHtml(t.nominee)}</td>
      <td>${escapeHtml(t.category)}</td>
      <td class="num">${fmtKES(t.amount)}</td>
      <td class="num">${t.votes}</td>
      <td>${fmtTime(t.completed_at || t.created_at)}</td>
    </tr>
  `).join('') : '<tr><td colspan="9" class="empty">No transactions yet.</td></tr>';
}

function renderWallet() {
  const successTx = CACHE.transactions.filter(t => t.status === 'success');
  const s = CACHE.stats || {};
  document.getElementById('walletAmt').textContent = fmtKES(s.walletBalance || 0);
  document.getElementById('walletSub').textContent = `From ${s.txCount || 0} successful payments · ${(s.paidVotes||0).toLocaleString()} paid votes`;

  document.getElementById('walletStats').innerHTML = `
    ${statCard('Total received', fmtKES(s.walletBalance), 'All-time')}
    ${statCard('Successful tx', (s.txCount||0).toLocaleString(), 'Confirmed only')}
    ${statCard('Pending tx', (s.pendingCount||0).toLocaleString(), 'Awaiting confirmation')}
    ${statCard('Avg per tx', fmtKES(s.txCount ? Math.round(s.walletBalance/s.txCount) : 0), 'Mean payment')}
  `;

  document.getElementById('walletBody').innerHTML = successTx.length ? successTx.map(t => `
    <tr>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;">${escapeHtml(t.receipt)}</td>
      <td>${escapeHtml(t.voter_name || '—')}</td>
      <td class="num">${escapeHtml(t.phone)}</td>
      <td>${escapeHtml(t.nominee)}</td>
      <td class="num" style="color:var(--green-bright);">+${fmtKES(t.amount)}</td>
      <td class="num">${t.votes}</td>
      <td>${fmtTime(t.completed_at || t.created_at)}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty">No payments yet.</td></tr>';
}

function renderVoters() {
  const q = (document.getElementById('voterSearch').value || '').toLowerCase();
  const rows = CACHE.voters.filter(v => !q || v.full_name.toLowerCase().includes(q) || (v.phone||'').includes(q));
  document.getElementById('voterBody').innerHTML = rows.length ? rows.map(v => `
    <tr>
      <td>${escapeHtml(v.full_name)}</td>
      <td class="num">${escapeHtml(v.phone)}</td>
      <td>${escapeHtml(v.email || '—')}</td>
      <td class="num">${v.tx_count}</td>
      <td class="num">${v.total_votes}</td>
      <td class="num">${fmtKES(v.total_spent)}</td>
      <td>${fmtTime(v.created_at)}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty">No voters yet.</td></tr>';
}

function renderManage() {
  let html = '';
  let lastCat = null;
  CACHE.leaderboard.forEach(r => {
    if (r.category !== lastCat) {
      html += `<div class="manage-cat">${escapeHtml(r.category)}</div>`;
      lastCat = r.category;
    }
    html += `
      <div class="manage-row">
        <div>
          <div class="mn-name">${escapeHtml(r.nominee)}</div>
          ${r.detail ? '<div class="mn-detail">'+escapeHtml(r.detail)+'</div>' : ''}
        </div>
        <div class="mn-stat"><div class="mn-stat-lbl">Paid</div><div class="mn-stat-val">${r.paid_votes}</div></div>
        <div class="mn-stat"><div class="mn-stat-lbl">Bonus</div><div class="mn-stat-val">${r.bonus_votes}</div></div>
        <div class="mn-stat"><div class="mn-stat-lbl">Total</div><div class="mn-stat-val">${r.total_votes}</div></div>
        <div style="display:flex;gap:6px;">
          <button class="row-btn" onclick="openBonus(${r.nominee_id})">Adjust</button>
          <button class="row-btn danger" onclick="delNominee(${r.nominee_id}, '${escapeAttr(r.nominee)}')">✕</button>
        </div>
      </div>`;
  });
  document.getElementById('manageList').innerHTML = html || '<div class="empty">No nominees yet.</div>';

  // populate category dropdown
  const sel = document.getElementById('newNomCat');
  sel.innerHTML = CACHE.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

async function renderLog() {
  try {
    const { log } = await api('/api/admin/log');
    document.getElementById('logBody').innerHTML = log.length ? log.map(l => `
      <tr>
        <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--gold-bright);">${escapeHtml(l.action)}</td>
        <td>${escapeHtml(l.detail || '')}</td>
        <td>${fmtTime(l.created_at)}</td>
      </tr>
    `).join('') : '<tr><td colspan="3" class="empty">No activity yet.</td></tr>';
  } catch (e) { }
}

// ---------- Bonus modal ----------
let CURRENT_NOMINEE = null;
function openBonus(id) {
  const r = CACHE.leaderboard.find(x => x.nominee_id === id);
  if (!r) return;
  CURRENT_NOMINEE = r;
  document.getElementById('bonusTitle').textContent = r.nominee;
  document.getElementById('bonusSub').textContent = `${r.category} · adjust the bonus votes for this nominee.`;
  document.getElementById('bcPaid').textContent = r.paid_votes;
  document.getElementById('bcBonus').textContent = r.bonus_votes;
  document.getElementById('bcTotal').textContent = r.total_votes;
  document.getElementById('bonusDelta').value = '';
  document.getElementById('bonusSet').value = '';
  document.getElementById('bonusOverlay').classList.add('show');
}
function closeBonus() { document.getElementById('bonusOverlay').classList.remove('show'); CURRENT_NOMINEE = null; }
document.getElementById('bonusClose').addEventListener('click', closeBonus);
document.getElementById('bonusOverlay').addEventListener('click', (e) => { if (e.target.id === 'bonusOverlay') closeBonus(); });
document.querySelectorAll('.quick-row .mini-btn').forEach(b => b.addEventListener('click', () => {
  document.getElementById('bonusDelta').value = b.dataset.d;
}));
document.getElementById('bonusApply').addEventListener('click', async () => {
  if (!CURRENT_NOMINEE) return;
  const setV = document.getElementById('bonusSet').value;
  const delta = document.getElementById('bonusDelta').value;
  const body = setV !== '' ? { set: parseInt(setV, 10) } : { delta: parseInt(delta, 10) || 0 };
  try {
    await api(`/api/admin/nominees/${CURRENT_NOMINEE.nominee_id}/bonus`, { method: 'POST', body: JSON.stringify(body) });
    toast('Votes updated', 'ok');
    closeBonus();
    refreshAll();
  } catch (e) { toast(e.message, 'err'); }
});

// ---------- Add category / nominee / reset ----------
document.getElementById('addNomBtn').addEventListener('click', async () => {
  const categoryId = parseInt(document.getElementById('newNomCat').value, 10);
  const name = document.getElementById('newNomName').value.trim();
  const detail = document.getElementById('newNomDetail').value.trim();
  if (!name) return toast('Enter a nominee name', 'err');
  try {
    await api('/api/admin/nominees', { method: 'POST', body: JSON.stringify({ categoryId, name, detail }) });
    document.getElementById('newNomName').value = '';
    document.getElementById('newNomDetail').value = '';
    toast('Nominee added', 'ok');
    refreshAll();
  } catch (e) { toast(e.message, 'err'); }
});
document.getElementById('addCatBtn').addEventListener('click', async () => {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) return toast('Enter a category name', 'err');
  try {
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('newCatName').value = '';
    toast('Category added', 'ok');
    refreshAll();
  } catch (e) { toast(e.message, 'err'); }
});
async function delNominee(id, name) {
  if (!confirm('Delete "' + name + '"? Their transaction history will remain.')) return;
  try {
    await api('/api/admin/nominees/' + id, { method: 'DELETE' });
    toast('Nominee removed', 'ok');
    refreshAll();
  } catch (e) { toast(e.message, 'err'); }
}
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset ALL votes AND delete every transaction? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure?')) return;
  try {
    await api('/api/admin/reset', { method: 'POST' });
    toast('Everything reset', 'ok');
    refreshAll();
  } catch (e) { toast(e.message, 'err'); }
});
window.delNominee = delNominee;
window.openBonus = openBonus;

// ---------- Search / filter listeners ----------
document.getElementById('lbSearch').addEventListener('input', renderLeaderboard);
document.getElementById('txSearch').addEventListener('input', renderTransactions);
document.getElementById('txFilter').addEventListener('change', renderTransactions);
document.getElementById('voterSearch').addEventListener('input', renderVoters);
document.getElementById('refreshBtn').addEventListener('click', () => { refreshAll(); toast('Refreshed', 'ok'); });

document.getElementById('exportLbBtn').addEventListener('click', async () => {
  const res = await fetch(API + '/api/admin/export.csv', { headers: { Authorization: 'Bearer ' + TOKEN } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'gala-transactions.csv'; a.click();
  URL.revokeObjectURL(url);
});

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

// ---------- Boot ----------
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('logoutBtn').addEventListener('click', logout);

// Restore session if token exists
(async function boot() {
  if (!TOKEN) return;
  try {
    await api('/api/admin/me');
    enterDashboard();
  } catch (e) { logout(); }
})();
