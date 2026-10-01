import { initTheme, toggleTheme, toast, apiJson } from './ui.js';

initTheme();
const $ = (s) => document.querySelector(s);

const tt = $('#themeToggle');
if (tt) {
  tt.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
  tt.addEventListener('click', () => {
    const next = toggleTheme();
    tt.textContent = next === 'dark' ? '🌙' : '☀️';
  });
}

async function refreshStatus() {
  const el = $('#twofaStatus');
  try {
    const { user } = await apiJson('/api/auth/me');

    // Fetch 2FA status
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();

    // We need to know if 2fa is enabled. Let's check via a probe.
    // Actually /me doesn't return it. We'll rely on the state after enable/disable.
    // Show setup by default until user enables.
    el.innerHTML = '';
    const enabled = sessionStorage.getItem('rtc_2fa_enabled') === '1';

    if (enabled) {
      el.textContent = '✅ Two-factor authentication is currently ENABLED.';
      $('#disableSection').classList.remove('hidden');
      $('#setupSection').classList.add('hidden');
    } else {
      el.textContent = '⚠️ Two-factor authentication is currently DISABLED.';
      $('#setupSection').classList.remove('hidden');
      $('#disableSection').classList.add('hidden');
    }
  } catch (e) {
    el.textContent = 'Error: ' + e.message;
  }
}

$('#enableBtn')?.addEventListener('click', async () => {
  const code = $('#verifyCode').value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Enter 6-digit code', 'error');

  try {
    await apiJson('/api/auth/2fa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    sessionStorage.setItem('rtc_2fa_enabled', '1');
    toast('2FA enabled', 'ok');
    refreshStatus();
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#disableBtn')?.addEventListener('click', async () => {
  const code = $('#disableCode').value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Enter 6-digit code', 'error');

  try {
    await apiJson('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    sessionStorage.removeItem('rtc_2fa_enabled');
    toast('2FA disabled', 'ok');
    refreshStatus();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// Start 2FA setup on page load
(async () => {
  try {
    await apiJson('/api/auth/me'); // ensure logged in
    const { qr, secret } = await apiJson('/api/auth/2fa/setup', { method: 'POST' });
    $('#qrImg').src = qr;
    $('#secretText').textContent = secret;
    refreshStatus();
  } catch (e) {
    location.href = '/';
  }
})();