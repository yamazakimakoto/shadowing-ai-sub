'use strict';
// =====================================================================
//  サブスクリプション UI モジュール
// =====================================================================

// サブスク状態キャッシュ
window.subState = {
  active: false,
  sub: null,
};

// ── サブスク情報取得 ──────────────────────────────────────────────────
async function fetchSubStatus() {
  if (!window.authState.user) {
    window.subState = { active: false, sub: null };
    return;
  }
  try {
    const res = await fetch('/api/sub/status');
    if (!res.ok) { window.subState = { active: false, sub: null }; return; }
    const data = await res.json();
    window.subState.active = data.active;
    window.subState.sub    = data.sub;
  } catch {
    window.subState = { active: false, sub: null };
  }
}

// ── プランタブ描画 ────────────────────────────────────────────────────
function renderSubTab() {
  const gateEl   = document.getElementById('gate-sub-tab');
  const subEl    = document.getElementById('sub-content');
  const activeView   = document.getElementById('sub-active-view');
  const inactiveView = document.getElementById('sub-inactive-view');

  if (!window.authState.user) {
    gateEl.classList.remove('hidden');
    subEl.classList.add('hidden');
    return;
  }
  gateEl.classList.add('hidden');
  subEl.classList.remove('hidden');

  if (window.subState.active && window.subState.sub) {
    activeView.classList.remove('hidden');
    inactiveView.classList.add('hidden');
    const sub = window.subState.sub;
    // 期限
    const endDate = new Date(sub.end_date).toLocaleDateString('ja-JP');
    document.getElementById('sub-end-date').textContent = endDate;
    // クォータ
    const used = sub.gen_used || 0;
    const max  = sub.gen_max  || 30;
    document.getElementById('quota-text').textContent = `${used} / ${max} 件`;
    const pct = Math.min(100, Math.round(used / max * 100));
    document.getElementById('quota-fill').style.width = `${pct}%`;
  } else {
    activeView.classList.add('hidden');
    inactiveView.classList.remove('hidden');
  }
}

// ── 練習タブのゲート制御 ─────────────────────────────────────────────
function renderPracticeGate() {
  const gatePractice = document.getElementById('gate-practice');
  const gateSub      = document.getElementById('gate-sub');
  const practiceContent = document.getElementById('practice-content');
  const genQuota     = document.getElementById('gen-quota');

  if (!window.authState.user) {
    gatePractice.classList.remove('hidden');
    gateSub.classList.add('hidden');
    practiceContent.classList.add('hidden');
    return;
  }
  gatePractice.classList.add('hidden');

  if (!window.subState.active) {
    gateSub.classList.remove('hidden');
    practiceContent.classList.add('hidden');
    return;
  }
  gateSub.classList.add('hidden');
  practiceContent.classList.remove('hidden');

  // クォータ表示
  const sub = window.subState.sub;
  if (sub) {
    const used = sub.gen_used || 0;
    const max  = sub.gen_max  || 30;
    genQuota.textContent = `今月 ${used} / ${max} 件`;
  }
}

// ── 保存タブのゲート制御 ─────────────────────────────────────────────
function renderHistoryGate() {
  const gateEl   = document.getElementById('gate-history');
  const contentEl = document.getElementById('history-content');

  if (!window.authState.user || !window.subState.active) {
    gateEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }
  gateEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
}

// ── Stripe Checkout ───────────────────────────────────────────────────
window.startCheckout = async function() {
  if (!window.authState.user) { openAuth('login'); return; }
  const btn = document.getElementById('checkout-btn') || document.getElementById('gate-sub-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch('/api/sub/checkout', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    location.href = data.url;
  } catch (err) {
    showToast(err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = btn.id === 'checkout-btn' ? '今すぐ始める →' : 'プランに申し込む'; }
  }
};

// ── Customer Portal ───────────────────────────────────────────────────
document.getElementById('portal-btn').addEventListener('click', async () => {
  const btn = document.getElementById('portal-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch('/api/sub/portal', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    location.href = data.url;
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false; btn.textContent = '💳 支払い管理ポータル';
  }
});

document.getElementById('checkout-btn').addEventListener('click', startCheckout);

// ── 認証変化フック ────────────────────────────────────────────────────
window.onAuthChangedHooks.push(async () => {
  await fetchSubStatus();
  renderSubTab();
  renderPracticeGate();
  renderHistoryGate();
});

// ── タブ切り替えで再描画 ──────────────────────────────────────────────
// app.js の switchTab からも呼ばれる
window.onTabSwitch = window.onTabSwitch || {};
window.onTabSwitch['subscription'] = () => { renderSubTab(); };
window.onTabSwitch['history']      = () => { renderHistoryGate(); };

// ── 初期描画 ──────────────────────────────────────────────────────────
// auth.js の初期化後に呼ばれるよう少し遅延
(async () => {
  // authState の初期化を待つ
  let tries = 0;
  while (!window.authState.initialized && tries < 20) {
    await new Promise(r => setTimeout(r, 50));
    tries++;
  }
  await fetchSubStatus();
  renderSubTab();
  renderPracticeGate();
  renderHistoryGate();
})();
