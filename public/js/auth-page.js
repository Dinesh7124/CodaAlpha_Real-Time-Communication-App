import { toast, initTheme, apiJson } from './ui.js';

initTheme();

const $ = (s) => document.querySelector(s);

const alertBox = $('#alert');
const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const switchLink = $('#switchLink');
const switchText = $('#switchText');

let mode = 'login';

function showAlert(message, kind = 'error') {
  alertBox.textContent = message;
  alertBox.className = `alert ${kind}`;
  alertBox.classList.remove('hidden');
}
function hideAlert() { alertBox.classList.add('hidden'); }

function setMode(next) {
  mode = next;
  hideAlert();
  if (mode === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    switchText.textContent = 'No account yet?';
    switchLink.textContent = 'Create one';
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    switchText.textContent = 'Already registered?';
    switchLink.textContent = 'Sign in';
  }
}

switchLink.addEventListener('click', (e) => {
  e.preventDefault();
  setMode(mode === 'login' ? 'register' : 'login');
});

function validateName(name) {
  return /^[\p{L}\p{N} ._-]{1,40}$/u.test(name);
}

function validatePassword(pw) {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  let score = 0;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score < 3) return 'Password must include 3 of: uppercase, lowercase, digit, symbol.';
  if (/^(password|12345678|qwerty)/i.test(pw)) return 'Password is too common. Choose something stronger.';
  return null;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const btn = loginForm.querySelector('button');
  btn.disabled = true;
  try {
    await apiJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#loginEmail').value,
        password: $('#loginPassword').value,
      }),
    });
    toast('Signed in', 'ok');
    location.href = '/app.html';
  } catch (err) {
    showAlert(err.message);
    btn.disabled = false;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const name = $('#regName').value.trim();
  const email = $('#regEmail').value.trim();
  const password = $('#regPassword').value;

  if (!validateName(name)) {
    showAlert('Name may only contain letters, numbers, spaces, dot, dash, underscore (max 40).');
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showAlert('Please enter a valid email address.');
    return;
  }
  const pwErr = validatePassword(password);
  if (pwErr) {
    showAlert(pwErr);
    return;
  }

  const btn = registerForm.querySelector('button');
  btn.disabled = true;
  try {
    await apiJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    toast('Account created', 'ok');
    location.href = '/app.html';
  } catch (err) {
    showAlert(err.message);
    btn.disabled = false;
  }
});

(async () => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) location.href = '/app.html';
  } catch { /* ignore */ }
})();