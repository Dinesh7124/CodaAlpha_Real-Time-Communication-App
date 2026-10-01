import { toast, initTheme, toggleTheme, apiJson } from './ui.js';

initTheme();
const $ = (s) => document.querySelector(s);

$('#themeToggle').textContent =
  document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
$('#themeToggle').addEventListener('click', () => {
  const next = toggleTheme();
  $('#themeToggle').textContent = next === 'dark' ? '🌙' : '☀️';
});

/* ---------------- form ---------------- */

$('#scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const title = $('#mTitle').value.trim();
    const description = $('#mDescription').value.trim();
    const startLocal = $('#mStart').value;
    const durationMin = Number($('#mDuration').value);
    const recurrence = $('#mRecurrence').value;
    const password = $('#mPassword').value;
    const invitesRaw = $('#mInvites').value.trim();

    if (!title) throw new Error('Title is required');
    if (!startLocal) throw new Error('Start time is required');

    // Parse datetime-local as local time
    const startAt = new Date(startLocal).getTime();
    if (!Number.isFinite(startAt)) throw new Error('Invalid start time');
    if (startAt < Date.now() - 60000) throw new Error('Start time must be in the future');

    const invites = invitesRaw
      ? invitesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // Basic email validation client-side
    for (const email of invites) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new Error(`Invalid email: ${email}`);
      }
    }

    const { meeting, recurrences } = await apiJson('/api/schedule/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        startAt,
        durationMin,
        recurrence,
        password,
        invites,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });

    const recMsg = recurrences && recurrences.length
      ? ` + ${recurrences.length} recurring instances`
      : '';
    toast(`Meeting scheduled: ${meeting.title}${recMsg}`, 'ok');

    e.target.reset();
    loadUpcoming();
  } catch (err) {
    toast(err.message, 'error', 5000);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- list ---------------- */

function formatDateTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today · ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (isTomorrow) return `Tomorrow · ${time}`;

  return d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeUntil(ts) {
  const diff = ts - Date.now();
  if (diff < 0) return 'Started';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

async function loadUpcoming() {
  const list = $('#upcomingList');
  try {
    const { meetings } = await apiJson('/api/schedule/meetings/upcoming');
    list.innerHTML = '';

    if (!meetings.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No upcoming meetings. Schedule one above.';
      list.appendChild(empty);
      return;
    }

    for (const m of meetings) {
      const item = document.createElement('div');
      item.className = 'room-item';

      const meta = document.createElement('div');
      meta.className = 'meta';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = m.title;
      if (m.hasPassword) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = '🔑';
        title.appendChild(b);
      }
      if (m.recurrence !== 'none') {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = '🔄';
        b.title = `Repeats ${m.recurrence}`;
        title.appendChild(b);
      }

      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${formatDateTime(m.startAt)} · ${timeUntil(m.startAt)} · ${m.durationMin}min · host: ${m.hostName}`;

      meta.appendChild(title);
      meta.appendChild(sub);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';

      const joinBtn = document.createElement('button');
      joinBtn.className = 'btn';
      joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', () => {
        location.href = `/room.html?id=${encodeURIComponent(m.roomId)}`;
      });

      const inviteBtn = document.createElement('a');
      inviteBtn.className = 'btn btn-ghost';
      inviteBtn.textContent = '📅 ICS';
      inviteBtn.href = `/api/schedule/meetings/${m.id}/invite`;
      inviteBtn.title = 'Download calendar invite';

      actions.appendChild(joinBtn);
      actions.appendChild(inviteBtn);

      // Only host can cancel
      if (m.hostId === (JSON.parse(sessionStorage.getItem('rtc_user') || '{}')).id) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-ghost';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancel meeting';
        cancelBtn.addEventListener('click', async () => {
          if (!confirm(`Cancel "${m.title}"?`)) return;
          try {
            await apiJson(`/api/schedule/meetings/${m.id}`, { method: 'DELETE' });
            toast('Meeting cancelled', 'ok');
            loadUpcoming();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
        actions.appendChild(cancelBtn);
      }

      item.appendChild(meta);
      item.appendChild(actions);
      list.appendChild(item);
    }
  } catch (err) {
    toast('Failed to load meetings: ' + err.message, 'error');
    list.innerHTML = '<div class="empty">Error loading meetings</div>';
  }
}

/* ---------------- reminder listener ---------------- */

if (typeof io !== 'undefined') {
  const socket = io({ withCredentials: true });

  socket.on('meeting:reminder', ({ title, roomId, message }) => {
    toast(message, 'info', 8000);

    // Show native browser notification if allowed
    if (Notification.permission === 'granted') {
      const n = new Notification('Meeting starting soon', {
        body: message,
        tag: `meeting-${roomId}`,
      });
      n.onclick = () => {
        window.focus();
        location.href = `/room.html?id=${encodeURIComponent(roomId)}`;
      };
    }
  });

  // Request notification permission once
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* ---------------- init ---------------- */

// Load current user into sessionStorage for host checks
(async () => {
  try {
    const { user } = await apiJson('/api/auth/me');
    sessionStorage.setItem('rtc_user', JSON.stringify(user));
    // Set default start time to next hour
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000);
    $('#mStart').value = local.toISOString().slice(0, 16);
  } catch {
    location.href = '/';
    return;
  }
  loadUpcoming();
})();