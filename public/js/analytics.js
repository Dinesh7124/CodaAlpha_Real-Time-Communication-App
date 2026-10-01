import { initTheme, toggleTheme, apiJson, fmtDateTime } from './ui.js';

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

const roomId = new URLSearchParams(location.search).get('id');
if (!roomId) location.href = '/app.html';

(async () => {
  try {
    const { analytics } = await apiJson(`/api/rooms/${encodeURIComponent(roomId)}/analytics`);

    $('#roomTitle').textContent = analytics.name;
    $('#roomSub').textContent = `Room ${analytics.roomId} · Created ${fmtDateTime(analytics.createdAt)}`;

    const stats = [
      { label: 'Current participants', value: analytics.currentParticipants, icon: '👥' },
      { label: 'Total joined', value: analytics.totalJoined, icon: '📈' },
      { label: 'Messages', value: analytics.totalMessages, icon: '💬' },
      { label: 'Files shared', value: analytics.totalFiles, icon: '📁' },
      { label: 'Whiteboard strokes', value: analytics.totalStrokes, icon: '✏️' },
      { label: 'Polls', value: analytics.polls, icon: '📊' },
    ];

    const container = $('#stats');
    container.innerHTML = '';
    for (const s of stats) {
      const card = document.createElement('div');
      card.style.cssText = 'padding: 18px; background: var(--bg-3); border-radius: 12px; border: 1px solid var(--line);';

      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 22px; margin-bottom: 6px;';
      icon.textContent = s.icon;

      const v = document.createElement('div');
      v.style.cssText = 'font-size: 32px; font-weight: 800; color: var(--accent);';
      v.textContent = s.value;

      const l = document.createElement('div');
      l.style.cssText = 'font-size: 13px; color: var(--muted); margin-top: 4px;';
      l.textContent = s.label;

      card.appendChild(icon);
      card.appendChild(v);
      card.appendChild(l);
      container.appendChild(card);
    }

    const pl = $('#participants');
    pl.innerHTML = '';
    if (!analytics.participants.length) {
      pl.innerHTML = '<div class="empty">No session data yet</div>';
    } else {
      for (const p of analytics.participants) {
        const row = document.createElement('div');
        row.className = 'room-item';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const t = document.createElement('div');
        t.className = 'title';
        t.textContent = p.name;
        const s = document.createElement('div');
        s.className = 'sub';
        s.textContent = `${p.durationMin} minute${p.durationMin !== 1 ? 's' : ''} in meeting`;
        meta.appendChild(t);
        meta.appendChild(s);
        row.appendChild(meta);
        pl.appendChild(row);
      }
    }

    // Load AI summary
    try {
      const s = await apiJson(`/api/rooms/${encodeURIComponent(roomId)}/summary`);
      const summaryEl = $('#summary');
      if (summaryEl) {
        summaryEl.textContent = s.summary || 'No transcript available yet. Enable captions during a meeting to generate a summary.';
      }
      const metaEl = $('#summaryMeta');
      if (metaEl) {
        metaEl.textContent = `${s.lines} transcript lines · ${s.wordCount} words`;
      }
    } catch (e) {
      const summaryEl = $('#summary');
      if (summaryEl) summaryEl.textContent = 'Could not load summary: ' + e.message;
    }

  } catch (err) {
    $('#roomTitle').textContent = 'Error';
    $('#roomSub').textContent = err.message;
  }
})();