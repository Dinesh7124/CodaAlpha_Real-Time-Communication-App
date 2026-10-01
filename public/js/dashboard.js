import { toast, initTheme, toggleTheme, apiJson, fmtDateTime } from './ui.js';

initTheme();
const $ = (s) => document.querySelector(s);

/* ---------------- theme ---------------- */
const tt = $('#themeToggle');
if (tt) {
  tt.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
  tt.addEventListener('click', () => {
    const next = toggleTheme();
    tt.textContent = next === 'dark' ? '🌙' : '☀️';
  });
}

/* ---------------- rooms list ---------------- */
function renderRooms(rooms) {
  const list = $('#roomList');
  if (!list) return;
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

    if (room.locked) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '🔒';
      b.title = 'Locked';
      title.appendChild(b);
    }
    if (room.hasPassword) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '🔑';
      b.title = 'Password protected';
      title.appendChild(b);
    }
    if (room.waitingRoom) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '🚪';
      b.title = 'Waiting room enabled';
      title.appendChild(b);
    }

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `Code ${room.id} · ${room.participants} in room · by ${room.ownerName} · ${fmtDateTime(room.createdAt)}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn';
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', () => {
      location.href = `/room.html?id=${encodeURIComponent(room.id)}`;
    });

    const analyticsBtn = document.createElement('button');
    analyticsBtn.className = 'btn btn-ghost';
    analyticsBtn.textContent = '📊';
    analyticsBtn.title = 'View analytics';
    analyticsBtn.addEventListener('click', () => {
      window.open(`/analytics.html?id=${encodeURIComponent(room.id)}`, '_blank');
    });

    actions.appendChild(joinBtn);
    actions.appendChild(analyticsBtn);

    item.appendChild(meta);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

async function refreshRooms() {
  try {
    const { rooms } = await apiJson('/api/rooms');
    renderRooms(rooms);
  } catch {
    renderRooms([]);
  }
}

/* ---------------- create room ---------------- */
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

/* ---------------- join by code ---------------- */
$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#joinCode').value.trim();
  if (!raw) return;

  let code = raw;
  try {
    const url = new URL(raw);
    code = url.searchParams.get('id') || raw;
  } catch { /* not a URL */ }

  code = code.replace(/[^a-zA-Z0-9]/g, '');
  if (!code) return toast('Invalid room code', 'error');
  location.href = `/room.html?id=${encodeURIComponent(code)}`;
});

/* ---------------- analytics by ID ---------------- */
const analyticsForm = $('#analyticsForm');
if (analyticsForm) {
  analyticsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = ($('#analyticsRoomId') || {}).value || '';
    const clean = id.trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return toast('Enter a room ID', 'error');
    window.open(`/analytics.html?id=${encodeURIComponent(clean)}`, '_blank');
    if ($('#analyticsRoomId')) $('#analyticsRoomId').value = '';
  });
}

/* ---------------- logout ---------------- */
$('#logoutBtn').addEventListener('click', async () => {
  try { await apiJson('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/';
});

/* ---------------- boot ---------------- */
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