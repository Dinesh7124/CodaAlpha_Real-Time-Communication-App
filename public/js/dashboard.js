import { toast, initTheme, toggleTheme, apiJson, fmtDateTime } from './ui.js';

initTheme();
const $ = (s) => document.querySelector(s);

$('#themeToggle').addEventListener('click', () => {
  const next = toggleTheme();
  $('#themeToggle').textContent = next === 'dark' ? '🌙' : '☀️';
});
$('#themeToggle').textContent =
  document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';

function renderRooms(rooms) {
  const list = $('#roomList');
  list.innerHTML = '';
  if (!rooms.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No active rooms yet. Create one above.';
    list.appendChild(empty);
    return;
  }
  for (const room of rooms) {
    const item = document.createElement('div');
    item.className = 'room-item';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = room.name;
    if (room.locked) title.appendChild(Object.assign(document.createElement('span'), { className: 'badge', textContent: '🔒' }));
    if (room.hasPassword) title.appendChild(Object.assign(document.createElement('span'), { className: 'badge', textContent: '🔑' }));

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `Code ${room.id} · ${room.participants} in room · by ${room.ownerName} · ${fmtDateTime(room.createdAt)}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Join';
    btn.addEventListener('click', () => {
      location.href = `/room.html?id=${encodeURIComponent(room.id)}`;
    });

    item.appendChild(meta);
    item.appendChild(btn);
    list.appendChild(item);
  }
}

async function refreshRooms() {
  try {
    const { rooms } = await apiJson('/api/rooms');
    renderRooms(rooms);
  } catch { renderRooms([]); }
}

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const { room } = await apiJson('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#roomName').value,
        password: $('#roomPassword').value,
      }),
    });
    toast('Room created', 'ok');
    location.href = `/room.html?id=${encodeURIComponent(room.id)}`;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
});

$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#joinCode').value.trim();
  if (!raw) return;
  let code = raw;
  try {
    const url = new URL(raw);
    code = url.searchParams.get('id') || raw;
  } catch { /* not URL */ }
  code = code.replace(/[^a-zA-Z0-9]/g, '');
  if (!code) return toast('Invalid room code', 'error');
  location.href = `/room.html?id=${encodeURIComponent(code)}`;
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await apiJson('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/';
});

(async function boot() {
  try {
    const { user } = await apiJson('/api/auth/me');
    $('#whoami').textContent = user.name;
  } catch {
    location.href = '/';
    return;
  }
  refreshRooms();
  setInterval(refreshRooms, 10000);
})();