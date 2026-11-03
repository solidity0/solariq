// SolarIQ cloud sync — signs installers in with Supabase and keeps their data in the database.
// The app keeps using localStorage as its working copy; every change to a synced key is
// pushed to the `user_data` table, and the latest cloud copy is pulled on sign-in.
// With no Supabase settings in config.js this file does nothing (local-only mode).
(function () {
  const cfg = window.SOLARIQ_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey) return;

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.min.js';
  const SYNC_KEYS = ['solariq_state', 'solariq_crm', 'solariq_installer'];
  const OWNER_KEY = 'solariq_owner';     // which account the local copy belongs to
  const PENDING_KEY = 'solariq_pending'; // keys changed locally but not yet saved to the cloud
  const APP_URL = location.origin + location.pathname;

  // Hold the app's own init() until the installer is signed in and their data is loaded
  window._appInitialized = true;

  const store = window.localStorage;
  const target = (typeof Storage !== 'undefined' && store instanceof Storage) ? Storage.prototype : store;
  const rawSet = target.setItem, rawRemove = target.removeItem;
  const setRaw = (k, v) => rawSet.call(store, k, v);
  const removeRaw = k => rawRemove.call(store, k);

  let client = null, user = null, syncing = false, timer = null, queue = Promise.resolve();
  let status = 'idle', errorShown = false;
  const dirty = new Set(readPending());

  target.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === store && syncing && SYNC_KEYS.includes(k)) markDirty(k);
  };
  target.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === store && syncing && SYNC_KEYS.includes(k)) markDirty(k);
  };

  function readPending() {
    try { return JSON.parse(store.getItem(PENDING_KEY) || '[]').filter(k => SYNC_KEYS.includes(k)); }
    catch (e) { return []; }
  }
  function writePending() {
    if (dirty.size) setRaw(PENDING_KEY, JSON.stringify([...dirty]));
    else removeRaw(PENDING_KEY);
  }
  function markDirty(k) {
    dirty.add(k);
    writePending();
    setStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }
  const toJson = raw => { try { return JSON.parse(raw); } catch (e) { return raw; } };
  const fromJson = v => (typeof v === 'string' ? v : JSON.stringify(v));

  function flush() {
    clearTimeout(timer);
    queue = queue.then(pushDirty);
    return queue;
  }

  async function pushDirty() {
    if (!user || !dirty.size) return;
    const keys = [...dirty];
    dirty.clear();
    const upserts = [], deletes = [];
    for (const k of keys) {
      const raw = store.getItem(k);
      if (raw == null) deletes.push(k);
      else upserts.push({ user_id: user.id, key: k, value: toJson(raw), updated_at: new Date().toISOString() });
    }
    try {
      if (upserts.length) {
        const { error } = await client.from('user_data').upsert(upserts);
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await client.from('user_data').delete().eq('user_id', user.id).in('key', deletes);
        if (error) throw error;
      }
      writePending();
      setStatus(dirty.size ? 'saving' : 'saved');
    } catch (e) {
      keys.forEach(k => dirty.add(k));
      writePending();
      setStatus('error');
      console.warn('SolarIQ cloud save failed, will retry:', e);
      if (!errorShown && window.showToast) { errorShown = true; showToast('Cloud save failed — changes are kept on this device and will retry', 'warn'); }
      clearTimeout(timer);
      timer = setTimeout(flush, 15000);
    }
  }

  async function pull() {
    const { data, error } = await client.from('user_data').select('key,value');
    if (error) throw error;
    if (store.getItem(OWNER_KEY) !== user.id) {
      // The local copy belongs to another account (or predates sign-in)
      const migrate = !store.getItem(OWNER_KEY) && !data.length;
      if (!migrate) { SYNC_KEYS.forEach(removeRaw); dirty.clear(); }
      else SYNC_KEYS.forEach(k => { if (store.getItem(k) != null) dirty.add(k); });
    }
    for (const row of data) {
      if (SYNC_KEYS.includes(row.key) && !dirty.has(row.key)) setRaw(row.key, fromJson(row.value));
    }
    setRaw(OWNER_KEY, user.id);
    writePending();
  }

  async function start(u) {
    user = u;
    showOverlay('loading');
    try {
      await pull();
    } catch (e) {
      console.warn('SolarIQ cloud load failed:', e);
      if (store.getItem(OWNER_KEY) !== user.id) { SYNC_KEYS.forEach(removeRaw); dirty.clear(); setRaw(OWNER_KEY, user.id); writePending(); }
      setTimeout(() => window.showToast && showToast('Could not reach the cloud — showing data saved on this device', 'warn'), 500);
    }
    hideOverlay();
    window.getCurrentUser = () => ({ uid: u.id, name: u.email, email: u.email, role: 'admin' });
    syncing = true;
    window._appInitialized = false;
    window.init();
    addAccountCard();
    setStatus(dirty.size ? 'saving' : 'saved');
    if (dirty.size) flush();
  }

  async function signOut() {
    await flush();
    if (dirty.size && !confirm('Some changes have not been saved to the cloud yet. Sign out anyway and lose them on this device?')) return;
    syncing = false;
    await client.auth.signOut();
    SYNC_KEYS.forEach(removeRaw);
    removeRaw(OWNER_KEY);
    removeRaw(PENDING_KEY);
    location.replace(APP_URL);
  }

  // ---------------- UI ----------------
  const css = `
#siq-auth { position: fixed; inset: 0; z-index: 10000; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
#siq-auth .siq-box { width: 100%; max-width: 380px; }
#siq-auth .siq-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
#siq-auth .siq-brand-name { font-family: var(--font-display); font-size: 22px; font-weight: 800; color: var(--text); }
#siq-auth .siq-sub { font-size: 13px; color: var(--text2); margin-bottom: 18px; }
#siq-auth .btn { width: 100%; justify-content: center; margin-top: 6px; }
#siq-auth .siq-links { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; font-size: 12px; }
#siq-auth .siq-links a { color: var(--accent); cursor: pointer; text-decoration: none; }
#siq-auth .siq-msg { font-size: 12px; margin-top: 12px; min-height: 16px; color: var(--text2); }
#siq-auth .siq-msg.err { color: #f04545; }
#siq-auth .siq-msg.ok { color: #10d97a; }
.siq-account-line { font-size: 13px; color: var(--text2); margin-bottom: 12px; word-break: break-all; }
.siq-account-line strong { color: var(--text); }
`;
  const titles = {
    signin:  ['Sign in to your installer account', 'Sign in'],
    signup:  ['Create your installer account', 'Create account'],
    reset:   ['We will email you a link to set a new password', 'Send reset link'],
    newpass: ['Choose a new password', 'Save password'],
    loading: ['Loading your data…', '']
  };
  let overlay = null, mode = 'signin', recoveryUser = null;

  function showOverlay(m) {
    mode = m;
    if (!overlay) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      overlay = document.createElement('div');
      overlay.id = 'siq-auth';
      overlay.innerHTML = `
<form class="siq-box card" novalidate>
  <div class="siq-brand"><div class="logo-icon">⚡</div><div class="siq-brand-name">SolarIQ</div></div>
  <div class="siq-sub"></div>
  <div class="form-group siq-email"><label class="form-label" for="siq-email">Email</label><input class="form-input" id="siq-email" type="email" autocomplete="email" required></div>
  <div class="form-group siq-pass"><label class="form-label" for="siq-pass">Password</label><input class="form-input" id="siq-pass" type="password" autocomplete="current-password" minlength="6" required></div>
  <button class="btn btn-primary" type="submit"></button>
  <div class="siq-msg" role="status"></div>
  <div class="siq-links"><a data-go="signup"></a><a data-go="reset">Forgot password?</a></div>
</form>`;
      document.body.appendChild(overlay);
      overlay.querySelector('form').addEventListener('submit', onSubmit);
      overlay.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', () => showOverlay(a.dataset.go)));
    }
    if (window.localStorage.getItem('solariq_theme') === 'light') document.body.classList.add('light-theme');
    const [sub, btn] = titles[m];
    const q = s => overlay.querySelector(s);
    q('.siq-sub').textContent = sub;
    q('button[type=submit]').textContent = btn;
    q('button[type=submit]').style.display = m === 'loading' ? 'none' : '';
    q('.siq-email').style.display = (m === 'newpass' || m === 'loading') ? 'none' : '';
    q('.siq-pass').style.display = (m === 'reset' || m === 'loading') ? 'none' : '';
    q('#siq-pass').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    q('.siq-links').style.display = (m === 'newpass' || m === 'loading') ? 'none' : '';
    const swap = q('[data-go]');
    swap.dataset.go = m === 'signin' ? 'signup' : 'signin';
    swap.textContent = m === 'signin' ? 'Create an account' : 'Back to sign in';
    q('[data-go="reset"]').style.display = m === 'signin' ? '' : 'none';
    msg('');
    overlay.style.display = '';
  }
  function hideOverlay() { if (overlay) overlay.style.display = 'none'; }
  function msg(text, kind) {
    const el = overlay.querySelector('.siq-msg');
    el.textContent = text;
    el.className = 'siq-msg' + (kind ? ' ' + kind : '');
  }

  async function onSubmit(e) {
    e.preventDefault();
    const email = overlay.querySelector('#siq-email').value.trim();
    const password = overlay.querySelector('#siq-pass').value;
    const btn = overlay.querySelector('button[type=submit]');
    if (mode !== 'newpass' && !email) return msg('Enter your email address.', 'err');
    if (mode !== 'reset' && password.length < 6) return msg('Password must be at least 6 characters.', 'err');
    btn.disabled = true;
    msg('Please wait…');
    try {
      if (mode === 'signin') {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return start(data.user);
      }
      if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: APP_URL } });
        if (error) throw error;
        if (data.session) return start(data.user);
        showOverlay('signin');
        overlay.querySelector('#siq-email').value = email;
        return msg('Check your email and click the link to confirm your account, then sign in.', 'ok');
      }
      if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
        if (error) throw error;
        return msg('If that email has an account, a reset link is on its way.', 'ok');
      }
      if (mode === 'newpass') {
        const { data, error } = await client.auth.updateUser({ password });
        if (error) throw error;
        return start(data.user || recoveryUser);
      }
    } catch (err) {
      msg(err.message || 'Something went wrong. Please try again.', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function setStatus(s) {
    status = s;
    document.querySelectorAll('.siq-sync-status').forEach(el => {
      el.textContent = { saving: 'Saving to cloud…', saved: 'All changes saved to the cloud', error: 'Cloud save failed — will retry', idle: '' }[s];
      el.style.color = s === 'error' ? '#f59e0b' : '';
    });
  }

  // Account card (who's signed in, sync status, Sign out) on the Profile and Settings pages
  function addAccountCard() {
    ['page-profile', 'page-settings'].forEach(pageId => {
      const page = document.getElementById(pageId);
      if (!page || page.querySelector('.siq-account')) return;
      const card = document.createElement('div');
      card.className = 'card siq-account';
      card.style.marginBottom = '16px';
      card.innerHTML = `
<div class="card-title">Account</div>
<div class="siq-account-line">Signed in as <strong></strong></div>
<div class="siq-account-line siq-sync-status"></div>
<button class="btn btn-secondary siq-signout" type="button">Sign out</button>`;
      card.querySelector('strong').textContent = user.email;
      card.querySelector('button').addEventListener('click', signOut);
      const header = page.querySelector('.page-header');
      header ? header.after(card) : page.prepend(card);
    });
    setStatus(status);
  }

  // ---------------- startup ----------------
  const domReady = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r());
  const sdkReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Supabase library'));
    document.head.appendChild(s);
  });
  const recovering = /type=recovery/.test(location.hash);

  Promise.all([domReady, sdkReady]).then(async () => {
    client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    showOverlay('loading');
    const { data: { session } } = await client.auth.getSession();
    if (recovering && session) { recoveryUser = session.user; showOverlay('newpass'); }
    else if (session) start(session.user);
    else showOverlay('signin');
    if (location.hash.includes('access_token') || location.hash.includes('error')) history.replaceState(null, '', APP_URL);
  }).catch(e => {
    // Library or network failure: run the app with this device's data so it stays usable
    console.warn('SolarIQ cloud sync unavailable:', e);
    hideOverlay();
    window._appInitialized = false;
    domReady.then(() => { window.init(); window.showToast && showToast('Offline mode — data is saved on this device only', 'warn'); });
  });

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();
