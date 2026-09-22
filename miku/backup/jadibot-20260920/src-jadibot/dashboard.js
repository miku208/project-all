// src/jadibot/dashboard.js — Admin Dashboard (§28, §37-§41)
// Phase 1: web dashboard di backend. Nanti APK memakai API yang sama (§2).

export const dashboardHTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Miku Jadibot — Admin Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 16px; }
  h1 span { color: #38bdf8; }
  .card { background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .stat { background: #1e293b; border-radius: 12px; padding: 14px; }
  .stat b { display: block; font-size: 22px; color: #38bdf8; }
  .stat span { font-size: 12px; color: #94a3b8; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  nav button { background: #1e293b; color: #94a3b8; border: 0; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
  nav button.active { background: #38bdf8; color: #0f172a; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-weight: 500; }
  .btn { border: 0; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 4px; }
  .btn.p { background: #22c55e; color: #052e16; }
  .btn.d { background: #ef4444; color: #fff; }
  .btn.n { background: #334155; color: #e2e8f0; }
  input, select { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px; border-radius: 6px; margin: 2px 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .badge { padding: 2px 8px; border-radius: 99px; font-size: 11px; }
  .pending { background: #f59e0b33; color: #fbbf24; }
  .approved { background: #22c55e33; color: #4ade80; }
  .rejected { background: #ef444433; color: #f87171; }
  .online { background: #22c55e33; color: #4ade80; }
  .offline, .expired, .error, .cancelled { background: #64748b33; color: #cbd5e1; }
  img.proof { max-width: 260px; max-height: 260px; border-radius: 8px; }
  #login { max-width: 340px; margin: 12vh auto; }
  #login input { width: 100%; margin-bottom: 8px; }
  .muted { color: #94a3b8; font-size: 12px; }
  .msg { margin-top: 8px; font-size: 13px; color: #fbbf24; min-height: 18px; }
  pre { background:#0f172a; padding:10px; border-radius:8px; font-size:11px; overflow:auto; max-height:340px; }
</style>
</head>
<body>
<div id="login" class="card">
  <h1>Miku <span>Jadibot</span> — Admin</h1>
  <input id="lu" placeholder="username admin" autocomplete="username">
  <input id="lp" type="password" placeholder="password" autocomplete="current-password">
  <button class="btn p" onclick="doLogin()" style="width:100%">Login</button>
  <div class="msg" id="lmsg"></div>
</div>

<div id="app" class="wrap" style="display:none">
  <h1>Miku <span>Jadibot</span> — Admin Dashboard</h1>
  <nav id="tabs"></nav>
  <div id="view"></div>
</div>

<script>
let TOK = localStorage.getItem('jadibot_tok') || '';
let ME = null;
const $ = s => document.querySelector(s);

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK, ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({ success: false, error: { message: 'bad response' } }));
  if (r.status === 401) { logout(); }
  return j;
}

async function doLogin() {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: $('#lu').value, password: $('#lp').value }),
  });
  const j = await r.json();
  if (!j.success) { $('#lmsg').textContent = j.error?.message || 'Login gagal'; return; }
  if (j.data.user.role !== 'admin') { $('#lmsg').textContent = 'Akun ini bukan admin'; return; }
  TOK = j.data.access_token; localStorage.setItem('jadibot_tok', TOK);
  boot();
}
function logout() { localStorage.removeItem('jadibot_tok'); TOK = ''; location.reload(); }
$('#lp').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

const TABS = ['Overview','Users','Jadibots','Top Ups','Transactions','Settings','Logs'];
let activeTab = 'Overview';

function boot() {
  if (!TOK) return;
  $('#login').style.display = 'none';
  $('#app').style.display = 'block';
  renderTabs(); renderTab();
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(t =>
    '<button class="' + (t === activeTab ? 'active' : '') + '" onclick="setTab(\\'' + t + '\\')">' + t + '</button>'
  ).join('') + '<button class="n btn" style="margin-left:auto" onclick="logout()">Logout</button>';
}
function setTab(t) { activeTab = t; renderTabs(); renderTab(); }

function stat(label, val) { return '<div class="stat"><b>' + val + '</b><span>' + label + '</span></div>'; }
function badge(s) { return '<span class="badge ' + s + '">' + s + '</span>'; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function renderTab() {
  const v = $('#view');
  if (activeTab === 'Overview') {
    const j = await api('/admin/overview');
    if (!j.success) return v.innerHTML = 'gagal load';
    const d = j.data;
    v.innerHTML = '<div class="grid">' +
      stat('Total Users', d.total_users) + stat('Active', d.active_users) + stat('Suspended', d.suspended_users) +
      stat('Jadibots', d.total_bots) + stat('Online', d.online_bots) + stat('Pending Topups', d.pending_topups) +
      stat('Subs Aktif', d.active_subscriptions) + stat('Total Balance', 'Rp' + d.total_balance.toLocaleString('id-ID')) +
      '</div>';
  }

  if (activeTab === 'Users') {
    const j = await api('/admin/users');
    if (!j.success) return;
    v.innerHTML = '<div class="card"><div class="row">' +
      '<input id="nu" placeholder="username"><input id="np" placeholder="password" type="password">' +
      '<select id="nr"><option value="user">user</option><option value="admin">admin</option></select>' +
      '<button class="btn p" onclick="createUser()">+ Create User</button></div>' +
      '<table><tr><th>ID</th><th>Username</th><th>Role</th><th>Status</th><th>Balance</th><th>Subs</th><th>Aksi</th></tr>' +
      j.data.users.map(u => '<tr><td class="muted">' + esc(u.id) + '</td><td>' + esc(u.username) + '</td><td>' + esc(u.role) +
        '</td><td>' + badge(u.account_status) + '</td><td>Rp' + (u.balance || 0).toLocaleString('id-ID') + '</td><td>' + badge(u.subscription_status === 'active' ? 'active' : 'inactive') +
        '</td><td>' +
        '<button class="btn n" onclick="balancePrompt(\\'' + u.id + '\\', 1)">+ Balance</button>' +
        '<button class="btn n" onclick="balancePrompt(\\'' + u.id + '\\', -1)">- Balance</button>' +
        (u.account_status === 'active'
          ? '<button class="btn d" onclick="setStatus(\\'' + u.id + '\\',\\'suspended\\')">Suspend</button>'
          : '<button class="btn p" onclick="setStatus(\\'' + u.id + '\\',\\'active\\')">Activate</button>') +
        '<button class="btn d" onclick="delUser(\\'' + u.id + '\\')">Delete</button>' +
        '</td></tr>').join('') + '</table></div>';
  }

  if (activeTab === 'Jadibots') {
    const j = await api('/admin/bots');
    if (!j.success) return;
    v.innerHTML = '<div class="card"><table><tr><th>Bot ID</th><th>Owner</th><th>Nomor</th><th>Status</th><th>Aksi</th></tr>' +
      j.data.bots.map(b => '<tr><td class="muted">' + esc(b.id) + '</td><td class="muted">' + esc(b.owner_id) + '</td><td>+' + esc(b.phone_number) +
        '</td><td>' + badge(b.status) + '</td><td>' +
        '<button class="btn n" onclick="botAction(\\'' + b.id + '\\',\\'restart\\')">Restart</button>' +
        '<button class="btn d" onclick="botAction(\\'' + b.id + '\\',\\'stop\\')">Stop</button></td></tr>').join('') +
      '</table></div>';
  }

  if (activeTab === 'Top Ups') {
    const j = await api('/admin/topups?status=all');
    if (!j.success) return;
    v.innerHTML = '<div class="card"><table><tr><th>ID</th><th>User</th><th>Nominal</th><th>Status</th><th>Bukti</th><th>Tanggal</th><th>Aksi</th></tr>' +
      j.data.topups.map(t => '<tr><td class="muted">' + esc(t.id) + '</td><td>' + esc(t.username) + '</td><td>' + t.amount_label +
        '</td><td>' + badge(t.status) + '</td><td>' +
        (t.proof_url ? '<img class="proof" src="/api' + t.proof_url + '" alt="bukti">' : '<span class="muted">belum ada</span>') +
        '</td><td class="muted">' + esc(t.created_at_label) + '</td><td>' +
        (t.status === 'pending'
          ? '<button class="btn p" onclick="review(\\'' + t.id + '\\',\\'approve\\')">APPROVE</button>' +
            '<button class="btn d" onclick="review(\\'' + t.id + '\\',\\'reject\\')">REJECT</button>'
          : '<span class="muted">' + esc(t.admin_note || '') + '</span>') +
        '</td></tr>').join('') + '</table></div>';
  }

  if (activeTab === 'Transactions') {
    const j = await api('/admin/transactions?limit=200');
    if (!j.success) return;
    v.innerHTML = '<div class="card"><table><tr><th>Waktu</th><th>User</th><th>Type</th><th>Amount</th><th>Saldo Akhir</th><th>Ref</th></tr>' +
      j.data.transactions.map(t => '<tr><td class="muted">' + new Date(t.created_at).toLocaleString('id-ID') + '</td><td class="muted">' + esc(t.user_id) +
        '</td><td>' + esc(t.type) + '</td><td>' + (t.amount > 0 ? '+' : '') + 'Rp' + t.amount.toLocaleString('id-ID') +
        '</td><td>Rp' + t.balance_after.toLocaleString('id-ID') + '</td><td class="muted">' + esc(t.reference_id || '') + '</td></tr>').join('') +
      '</table></div>';
  }

  if (activeTab === 'Settings') {
    const j = await api('/admin/settings');
    if (!j.success) return;
    const s = j.data.settings;
    v.innerHTML = '<div class="card">' +
      '<div class="row"><input id="s_trial" style="width:90px" value="' + s.trialDurationHours + '" title="Trial (jam)"> jam trial' +
      '<input id="s_price" style="width:110px" value="' + s.subscriptionPrice + '"> Rp subs' +
      '<input id="s_days" style="width:70px" value="' + s.subscriptionDurationDays + '"> hari subs</div>' +
      '<div class="row"><input id="s_min" style="width:110px" value="' + s.minTopup + '"> min topup' +
      '<input id="s_max" style="width:110px" value="' + s.maxTopup + '"> max topup' +
      '<input id="s_maxbots" style="width:70px" value="' + s.maxBotsPerUser + '"> max bot/user</div>' +
      '<div class="row" style="margin-top:8px">QRIS URL: <input id="s_qris" style="flex:1" value="' + esc(s.qrisUrl || '') + '"></div>' +
      '<div class="row" style="margin-top:8px">Upload QRIS image: <input type="file" id="s_qrisfile" accept="image/*">' +
      '<button class="btn p" onclick="saveSettings()">Simpan</button></div>' +
      '<div class="msg" id="smsg"></div></div>';
  }

  if (activeTab === 'Logs') {
    const a = await api('/admin/logs?type=admin&limit=100');
    const s = await api('/admin/logs?limit=100');
    v.innerHTML = '<div class="card"><h1 style="font-size:14px;margin-bottom:8px">Admin Logs</h1><pre>' +
      esc((a.data?.logs || []).map(l => new Date(l.created_at).toLocaleString('id-ID') + ' | ' + l.admin_id + ' | ' + l.action + ' | ' + (l.target_id || '')).join('\\n')) +
      '</pre><h1 style="font-size:14px;margin:12px 0 8px">System Logs</h1><pre>' +
      esc((s.data?.logs || []).map(l => new Date(l.created_at).toLocaleString('id-ID') + ' | ' + l.event + ' | ' + JSON.stringify(l.meta || {})).join('\\n')) +
      '</pre></div>';
  }
}

/* ---------- actions ---------- */
async function createUser() {
  const j = await api('/admin/users', { method: 'POST', body: JSON.stringify({ username: $('#nu').value, password: $('#np').value, role: $('#nr').value }) });
  renderTab(); if (!j.success) alert(j.error?.message);
}
async function setStatus(id, status) { await api('/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ account_status: status }) }); renderTab(); }
async function delUser(id) { if (confirm('Hapus user ' + id + ' beserta botnya?')) { await api('/admin/users/' + id, { method: 'DELETE' }); renderTab(); } }
async function balancePrompt(id, sign) {
  const amount = sign * parseInt(prompt('Nominal (Rp):') || '0');
  if (!amount) return;
  const reason = prompt('Alasan:') || '';
  const j = await api('/admin/users/' + id + '/balance', { method: 'POST', body: JSON.stringify({ amount, reason }) });
  if (!j.success) alert(j.error?.message); else alert('Balance sekarang: Rp' + j.data.balance.toLocaleString('id-ID'));
  renderTab();
}
async function botAction(id, action) { await api('/admin/bots/' + id + '/' + action, { method: 'POST' }); renderTab(); }
async function review(id, action) {
  const note = action === 'reject' ? (prompt('Alasan reject:') || '') : '';
  const j = await api('/admin/topups/' + id + '/' + action, { method: 'POST', body: JSON.stringify({ admin_note: note }) });
  if (!j.success) alert(j.error?.message);
  renderTab();
}
async function saveSettings() {
  await api('/admin/settings', { method: 'PUT', body: JSON.stringify({
    trialDurationHours: parseInt($('#s_trial').value),
    subscriptionPrice: parseInt($('#s_price').value),
    subscriptionDurationDays: parseInt($('#s_days').value),
    minTopup: parseInt($('#s_min').value),
    maxTopup: parseInt($('#s_max').value),
    maxBotsPerUser: parseInt($('#s_maxbots').value),
    qrisUrl: $('#s_qris').value,
  })});
  const f = $('#s_qrisfile').files[0];
  if (f) {
    const buf = await f.arrayBuffer();
    await fetch('/api/admin/settings/qris', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', Authorization: 'Bearer ' + TOK }, body: buf });
  }
  $('#smsg').textContent = 'Tersimpan ✓';
  setTimeout(() => renderTab(), 600);
}

boot();
</script>
</body>
</html>`;
