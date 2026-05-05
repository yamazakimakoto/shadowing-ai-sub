'use strict';
// =====================================================================
//  認証 UI モジュール
//  グローバル: window.authState, openAuth(), closeAuth()
// =====================================================================

window.authState = {
  user: null,         // { id, email, name } | null
  initialized: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────
const authModal     = document.getElementById('auth-modal');
const loginView     = document.getElementById('auth-login-view');
const registerView  = document.getElementById('auth-register-view');
const loginError    = document.getElementById('auth-login-error');
const registerError = document.getElementById('auth-register-error');
const registerSuccess = document.getElementById('auth-register-success');
const registerForm  = document.getElementById('register-form');

// ── ユーティリティ ────────────────────────────────────────────────────
function showAuthError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideAuthError(el) { el.classList.add('hidden'); }

// ── モーダル開閉 ──────────────────────────────────────────────────────
window.openAuth = function(mode = 'login') {
  authModal.classList.remove('hidden');
  if (mode === 'register') {
    loginView.classList.add('hidden');
    registerView.classList.remove('hidden');
  } else {
    loginView.classList.remove('hidden');
    registerView.classList.add('hidden');
  }
  hideAuthError(loginError);
  hideAuthError(registerError);
};

window.closeAuth = function() {
  authModal.classList.add('hidden');
};

authModal.addEventListener('click', e => {
  if (e.target === authModal) closeAuth();
});

document.getElementById('go-register').addEventListener('click', () => openAuth('register'));
document.getElementById('go-login').addEventListener('click', () => openAuth('login'));
document.getElementById('header-login-btn').addEventListener('click', () => openAuth('login'));

// ── ログイン ──────────────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  hideAuthError(loginError);
  document.getElementById('resend-verify-area').classList.add('hidden');

  if (!email || !password) {
    return showAuthError(loginError, 'メールアドレスとパスワードを入力してください');
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = '…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'EMAIL_NOT_VERIFIED') {
        showAuthError(loginError, 'メールアドレスが未確認です。確認メールをご確認ください。');
        document.getElementById('resend-verify-area').classList.remove('hidden');
        document.getElementById('resend-verify-area').dataset.email = email;
      } else {
        showAuthError(loginError, data.error || 'ログインに失敗しました');
      }
      return;
    }
    window.authState.user = data.user;
    closeAuth();
    onAuthChanged();
    showToast(`✅ ようこそ、${data.user.name} さん！`);
  } catch {
    showAuthError(loginError, 'ネットワークエラーが発生しました');
  } finally {
    btn.disabled = false; btn.textContent = 'ログイン';
  }
}

// ── 確認メール再送 ────────────────────────────────────────────────────
document.getElementById('resend-verify-btn').addEventListener('click', async () => {
  const email = document.getElementById('resend-verify-area').dataset.email;
  if (!email) return;
  try {
    await fetch('/api/auth/resend-verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    showToast('📧 確認メールを再送しました');
  } catch {}
});

// ── 登録 ──────────────────────────────────────────────────────────────
document.getElementById('register-btn').addEventListener('click', doRegister);
document.getElementById('register-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doRegister();
});

async function doRegister() {
  const name     = document.getElementById('register-name').value.trim();
  const email    = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  hideAuthError(registerError);
  registerSuccess.classList.add('hidden');

  if (!name || !email || !password) {
    return showAuthError(registerError, 'すべての項目を入力してください');
  }
  if (password.length < 6) {
    return showAuthError(registerError, 'パスワードは6文字以上にしてください');
  }

  const btn = document.getElementById('register-btn');
  btn.disabled = true; btn.textContent = '…';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return showAuthError(registerError, data.error || '登録に失敗しました');
    }
    // 登録成功 → メール確認待ち
    registerForm.classList.add('hidden');
    registerSuccess.textContent = '✅ 確認メールを送信しました。メールをご確認ください。';
    registerSuccess.classList.remove('hidden');
  } catch {
    showAuthError(registerError, 'ネットワークエラーが発生しました');
  } finally {
    btn.disabled = false; btn.textContent = '登録する';
  }
}

// ── 現在のユーザー取得 ────────────────────────────────────────────────
async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.authState.user = null; return; }
    window.authState.user = await res.json();
  } catch {
    window.authState.user = null;
  }
}

// ── ログアウト ────────────────────────────────────────────────────────
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.authState.user = null;
  onAuthChanged();
  showToast('ログアウトしました');
}

// ── ユーザーメニュー（ヘッダー） ──────────────────────────────────────
function renderHeaderAuth() {
  const area = document.getElementById('header-auth-area');
  const user = window.authState.user;
  if (!user) {
    area.innerHTML = `
      <button class="btn-primary" id="header-login-btn" style="padding:6px 14px;font-size:.83rem"
        onclick="openAuth('login')">ログイン / 登録</button>`;
    return;
  }
  area.innerHTML = `
    <div class="user-menu">
      <button class="user-btn" id="user-menu-btn">👤 ${escHtml(user.name)} ▾</button>
      <div class="user-menu-dropdown hidden" id="user-dropdown">
        <button class="user-menu-item" onclick="switchTab('subscription')">💳 プラン</button>
        <button class="user-menu-item danger" onclick="doLogout()">ログアウト</button>
      </div>
    </div>`;

  document.getElementById('user-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('user-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.add('hidden');
  }, { once: false, capture: false });
}

// ── 認証状態変化時の処理 ─────────────────────────────────────────────
// app.js / subscription.js が onAuthChanged をオーバーライドできるよう window に公開
window.onAuthChangedHooks = [];
function onAuthChanged() {
  renderHeaderAuth();
  window.onAuthChangedHooks.forEach(fn => fn(window.authState.user));
}
window.doLogout = doLogout;

// ── 初期化 ────────────────────────────────────────────────────────────
(async () => {
  await fetchCurrentUser();

  // URL パラメータチェック（verified=1）
  const params = new URLSearchParams(location.search);
  if (params.get('verified') === '1') {
    showToast('✅ メールアドレスが確認されました！');
    history.replaceState({}, '', '/');
  }
  if (params.get('sub') === 'success') {
    showToast('🎉 サブスクリプションが開始されました！');
    history.replaceState({}, '', '/');
  }

  window.authState.initialized = true;
  onAuthChanged();
})();

// ── ヘルパー ──────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// トーストは app.js で定義、ここでも使うので先に定義
window.showToast = window.showToast || function(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error-toast', isError);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
};
