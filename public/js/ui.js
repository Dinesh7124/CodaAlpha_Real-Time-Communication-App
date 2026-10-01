/* Toasts, theme, keyboard, misc helpers */

export function toast(message, kind = 'info', duration = 3500) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(60px)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export function initTheme() {
  const saved = localStorage.getItem('rtc_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  return saved;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('rtc_theme', next);
  return next;
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString();
}

export async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });

  if (res.status === 401 && !url.includes('/auth/')) {
    // Try refreshing once
    const refresh = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (refresh.ok) {
      return fetch(url, { credentials: 'same-origin', ...options });
    }
    location.href = '/';
    throw new Error('Session expired');
  }

  return res;
}

export async function apiJson(url, options = {}) {
  const res = await api(url, options);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ============ XSS-safe helpers ============ */

/**
 * Escape a string for safe insertion into HTML.
 * Prefer textContent, but if you must use innerHTML, escape first.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate a URL before navigating to it.
 * Blocks javascript:, data:, vbscript: schemes.
 */
export function isSafeUrl(url) {
  try {
    const parsed = new URL(url, location.origin);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Safe set of text — never parses HTML.
 */
export function setText(el, text) {
  if (el) el.textContent = String(text ?? '');
}