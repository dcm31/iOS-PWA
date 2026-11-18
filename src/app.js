const themeMedia = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  let saved;
  try { saved = localStorage.getItem('charlie-color-theme'); } catch {}
  const theme = saved === 'light' || saved === 'dark' ? saved : themeMedia.matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101010' : '#ffffff';
}
applyTheme();
themeMedia.addEventListener('change', applyTheme);
const $ = id => document.getElementById(id);
const status = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
const base = document.documentElement.dataset.base;
const storageKey = 'ios-pwa-session-v1' + (base === '/' ? '' : ':' + base);
let token = localStorage.getItem(storageKey);
let session;
let registration;
let busy = false;
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function bytes(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function api(path, body = {}) {
  const response = await fetch(base + 'api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed'); error.status = response.status; throw error; }
  return data;
}

async function prepareSession() {
  try { session = await api('session'); }
  catch (error) {
    if (error.status !== 410) throw error;
    token = null;
    localStorage.removeItem(storageKey);
    const old = await registration.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    session = await api('session');
  }
  if (session.token) { token = session.token; localStorage.setItem(storageKey, token); }
}

function buttons(subscribed) {
  $('enable').disabled = busy || !registration || !session || subscribed;
  $('send').disabled = busy || !subscribed;
  $('reset').disabled = busy;
}

async function start() {
  if (!ios || standalone) $('install').classList.add('hidden');
  if (ios && !standalone) { status('Add to Home Screen, then open the installed app to continue.'); return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status('Web Push is not supported in this browser.', true); return;
  }
  try {
    registration = await navigator.serviceWorker.register(base + 'service-worker.js', { scope: base });
    const worker = registration.installing || registration.waiting || registration.active;
    if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); }
        if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(new Error('Could not activate the notification service worker. Reload to try again.')); }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
    await prepareSession();
    const sub = await registration.pushManager.getSubscription();
    const subscribed = !!sub && session.subscribed && Notification.permission === 'granted';
    buttons(subscribed);
    status(subscribed ? 'Notifications enabled. You can send a test notification.' : 'Select Enable notifications to request permission.');
  } catch (error) { status(error.message, true); }
}

$('enable').addEventListener('click', async () => {
  // Ask immediately in the user's tap handler; Safari requires a user gesture.
  const permissionPromise = Notification.requestPermission();
  busy = true; buttons(false);
  let subscribed = false;
  try {
    if (await permissionPromise !== 'granted') throw new Error('Permission was not granted. Check this app in Settings under Notifications.');
    if (session.expires <= Date.now()) await prepareSession();
    let sub = await registration.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(session.publicKey) });
    await api('subscribe', { subscription: sub.toJSON() });
    subscribed = true;
    status('Notifications enabled. You can send a test notification.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; buttons(subscribed); }
});

$('send').addEventListener('click', async () => {
  busy = true; buttons(true);
  let subscribed = true;
  try {
    await api('send', { message: $('message').value });
    status('Accepted by the push service. Check Notification Center; Focus settings may silence it.');
  } catch (error) {
    subscribed = error.status !== 410 && error.status !== 409;
    status(error.message, true);
  } finally { busy = false; buttons(subscribed); }
});

$('reset').addEventListener('click', async () => {
  busy = true; buttons(false);
  try {
    if (token) await api('reset');
    const sub = await registration?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    localStorage.removeItem(storageKey);
    token = null; session = null;
    busy = false;
    await start();
  } catch (error) { busy = false; status(error.message, true); buttons(false); }
});
start();
