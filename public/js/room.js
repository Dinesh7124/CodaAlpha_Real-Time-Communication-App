import { Captions } from './captions.js';
import { Mesh, loadIceServers } from './webrtc.js';
import { Whiteboard } from './whiteboard.js';
import { toast, initTheme, toggleTheme, fmtSize, fmtTime, apiJson } from './ui.js';

initTheme();
const $ = (s) => document.querySelector(s);

const roomId = new URLSearchParams(location.search).get('id');
if (!roomId) location.href = '/app.html';

let me = null;
let room = null;
let socket = null;
let mesh = null;
let board = null;
let isHost = false;
let recorder = null;
let recordingChunks = [];
const peerNames = new Map();
const peerState = new Map();

/* ================= theme ================= */
const themeToggleEl = $('#themeToggle');
if (themeToggleEl) {
  themeToggleEl.textContent =
    document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
  themeToggleEl.addEventListener('click', () => {
    const next = toggleTheme();
    themeToggleEl.textContent = next === 'dark' ? '🌙' : '☀️';
  });
}

/* ================= helpers ================= */
function setConn(text, kind = '') {
  const el = $('#connState');
  if (!el) return;
  el.className = `pill ${kind}`;
  el.innerHTML = `<span class="dot"></span> ${text}`;
}

function fmtBytes(b) { return fmtSize(b); }

/* ================= tiles ================= */
function ensureTile(peerId, label, isLocal = false) {
  let tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.peer = peerId;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const labelEl = document.createElement('div');
    labelEl.className = 'tile-label';

    const badges = document.createElement('div');
    badges.className = 'tile-badges';

    const conn = document.createElement('div');
    conn.className = 'conn';
    conn.textContent = isLocal ? '' : 'connecting…';

    const reactionsLayer = document.createElement('div');
    reactionsLayer.className = 'reactions-layer';

    tile.appendChild(video);
    tile.appendChild(reactionsLayer);
    tile.appendChild(labelEl);
    tile.appendChild(badges);
    tile.appendChild(conn);

    video.addEventListener('dblclick', () => {
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    });

    const grid = $('#videoGrid');
    if (grid) grid.appendChild(tile);
  }
  const labelEl = tile.querySelector('.tile-label');
  if (labelEl) labelEl.textContent = label + (isLocal ? ' (you)' : '');
  return tile;
}

function attachStream(peerId, stream) {
  const tile = ensureTile(peerId, peerNames.get(peerId) || 'Guest');
  const video = tile.querySelector('video');
  if (video && video.srcObject !== stream) {
    video.srcObject = stream;
    video.play().catch(() => {});
  }
  const conn = tile.querySelector('.conn');
  if (conn) conn.textContent = '';
}

function removeTile(peerId) {
  const tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
  if (tile) tile.remove();
}

function updateBadges(peerId) {
  const tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
  if (!tile) return;
  const state = peerState.get(peerId) || { audio: true, video: true, screen: false, hand: false, stats: null };
  const badges = tile.querySelector('.tile-badges');
  if (!badges) return;
  badges.innerHTML = '';

  if (!state.audio) {
    const b = document.createElement('span');
    b.className = 'badge muted';
    b.textContent = '🔇';
    badges.appendChild(b);
  }
  if (!state.video && !state.screen) {
    const b = document.createElement('span');
    b.className = 'badge muted';
    b.textContent = '📷✕';
    badges.appendChild(b);
  }
  if (state.screen) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = '🖥️';
    badges.appendChild(b);
  }
  if (state.hand) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = '✋';
    badges.appendChild(b);
  }
  if (state.stats && state.stats.quality) {
    const b = document.createElement('span');
    b.className = `badge quality-${state.stats.quality}`;
    b.textContent = state.stats.quality === 'good' ? '●' : state.stats.quality === 'mid' ? '◐' : '○';
    b.title = `Quality: ${state.stats.quality}, RTT ${state.stats.rtt}ms, ${state.stats.bitrate} kbps`;
    badges.appendChild(b);
  }
  tile.classList.toggle('screen', Boolean(state.screen));
}

/* ================= people ================= */
function renderPeople() {
  const list = $('#peopleList');
  if (!list) return;
  list.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'person owner';
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = `${me ? me.name : 'You'} (you)`;
  const ic = document.createElement('span');
  ic.className = 'icons';
  const myMic = document.createElement('span');
  myMic.textContent = '🎤';
  myMic.className = mesh && mesh.audioEnabled ? '' : 'off';
  const myCam = document.createElement('span');
  myCam.textContent = '📷';
  myCam.className = mesh && mesh.videoEnabled ? '' : 'off';
  ic.appendChild(myMic);
  ic.appendChild(myCam);
  row.appendChild(n);
  row.appendChild(ic);
  list.appendChild(row);

  for (const [peerId, name] of peerNames) {
    const state = peerState.get(peerId) || { audio: true, video: true, screen: false, hand: false };
    const r = document.createElement('div');
    r.className = 'person';

    const nn = document.createElement('span');
    nn.className = 'name';
    nn.textContent = name;

    const icons = document.createElement('span');
    icons.className = 'icons';

    const m = document.createElement('span');
    m.textContent = '🎤';
    m.className = state.audio ? '' : 'off';

    const c = document.createElement('span');
    c.textContent = '📷';
    c.className = state.video || state.screen ? '' : 'off';

    icons.appendChild(m);
    icons.appendChild(c);

    if (state.hand) {
      const h = document.createElement('span');
      h.textContent = '✋';
      icons.appendChild(h);
    }

    if (isHost && socket) {
      const kick = document.createElement('button');
      kick.className = 'icon-btn';
      kick.style.width = '30px';
      kick.style.height = '30px';
      kick.textContent = '✕';
      kick.title = 'Kick';
      kick.addEventListener('click', () => {
        if (confirm(`Kick ${name}?`)) socket.emit('host:kick', { peerId });
      });
      icons.appendChild(kick);
    }

    r.appendChild(nn);
    r.appendChild(icons);
    list.appendChild(r);
  }

  const hc = $('#hostControls');
  if (hc) hc.classList.toggle('hidden', !isHost);
}

/* ================= waiting ================= */
function renderWaitingList(waiting) {
  let el = document.getElementById('waitingList');
  if (!el) {
    el = document.createElement('div');
    el.id = 'waitingList';
    el.style.cssText = 'padding: 12px; border-bottom: 1px solid var(--line);';
    const peopleTab = document.getElementById('tab-people');
    if (peopleTab) peopleTab.insertBefore(el, peopleTab.firstChild);
  }

  el.innerHTML = '';
  if (!waiting.length) return;

  const header = document.createElement('div');
  header.style.cssText = 'font-size: 12px; color: var(--muted); margin-bottom: 8px;';
  header.textContent = `⏳ Waiting (${waiting.length})`;
  el.appendChild(header);

  waiting.forEach((w) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg-3); border-radius: 8px; margin-bottom: 6px; font-size: 13px;';

    const n = document.createElement('span');
    n.textContent = w.name;

    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '6px';

    const admit = document.createElement('button');
    admit.className = 'btn';
    admit.textContent = '✓';
    admit.style.padding = '4px 10px';
    admit.addEventListener('click', () => socket.emit('waiting:admit', { targetId: w.socketId }));

    const deny = document.createElement('button');
    deny.className = 'btn btn-ghost';
    deny.textContent = '✕';
    deny.style.padding = '4px 10px';
    deny.addEventListener('click', () => socket.emit('waiting:deny', { targetId: w.socketId }));

    btns.appendChild(admit);
    btns.appendChild(deny);
    row.appendChild(n);
    row.appendChild(btns);
    el.appendChild(row);
  });
}

/* ================= breakouts ================= */
function renderBreakouts(list) {
  const el = document.getElementById('breakoutList');
  if (!el) return;
  el.innerHTML = '';

  if (!list || !list.length) {
    el.innerHTML = '<div class="empty">No breakout rooms yet</div>';
    return;
  }

  for (const b of list) {
    const card = document.createElement('div');
    card.className = 'poll-card';

    const title = document.createElement('div');
    title.className = 'q';
    title.textContent = `${b.name} (${b.participants.length})`;
    card.appendChild(title);

    for (const sid of b.participants) {
      const p = document.createElement('div');
      p.style.cssText = 'font-size: 13px; color: var(--muted);';
      p.textContent = `• ${peerNames.get(sid) || sid}`;
      card.appendChild(p);
    }

    if (isHost) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-ghost';
      closeBtn.textContent = 'Close room';
      closeBtn.style.marginTop = '8px';
      closeBtn.addEventListener('click', () => socket.emit('breakout:close', { breakoutId: b.id }));
      card.appendChild(closeBtn);
    }

    el.appendChild(card);
  }
}

/* ================= agenda ================= */
function renderAgenda(list) {
  const el = document.getElementById('agendaList');
  if (!el) return;
  el.innerHTML = '';

  if (!list.length) {
    el.innerHTML = '<div class="empty">No agenda items yet</div>';
    return;
  }

  list.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'poll-card';
    card.style.cssText = 'padding: 10px; margin-bottom: 6px;';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const num = document.createElement('span');
    num.style.cssText = 'font-weight: 700; color: var(--accent); min-width: 24px;';
    num.textContent = `${i + 1}.`;

    const text = document.createElement('span');
    text.style.flex = '1';
    text.textContent = item.text;

    const min = document.createElement('span');
    min.style.cssText = 'font-size: 12px; color: var(--muted);';
    if (item.minutes) min.textContent = `${item.minutes}m`;

    row.appendChild(num);
    row.appendChild(text);
    row.appendChild(min);

    if (item.done) {
      text.style.textDecoration = 'line-through';
      text.style.opacity = '0.5';
    }

    card.appendChild(row);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 6px; margin-top: 6px;';

    const done = document.createElement('button');
    done.className = 'btn btn-ghost';
    done.style.cssText = 'font-size: 11px; padding: 3px 8px;';
    done.textContent = item.done ? '↺' : '✓';
    done.addEventListener('click', () => socket.emit('agenda:toggle', { index: i }));

    actions.appendChild(done);

    if (isHost) {
      const del = document.createElement('button');
      del.className = 'btn btn-ghost';
      del.style.cssText = 'font-size: 11px; padding: 3px 8px;';
      del.textContent = '✕';
      del.addEventListener('click', () => socket.emit('agenda:remove', { index: i }));
      actions.appendChild(del);
    }

    card.appendChild(actions);
    el.appendChild(card);
  });
}

/* ================= chat ================= */
function addChatMessage({ from, text, at, system }) {
  const log = $('#chatLog');
  if (!log) return;
  const wrap = document.createElement('div');
  wrap.className = system ? 'msg system' : 'msg';
  if (!system) {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${from} · ${fmtTime(at)}`;
    wrap.appendChild(who);
  }
  const body = document.createElement('span');
  body.textContent = text;
  wrap.appendChild(body);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

/* ================= files ================= */
function addFileEntry(file) {
  const list = $('#fileList');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'file-item';
  const name = document.createElement('div');
  name.className = 'fname';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'fmeta';
  meta.textContent = `${fmtSize(file.size)} · ${file.by} · ${fmtTime(file.at)}`;
  const link = document.createElement('a');
  link.href = `/api/files/${encodeURIComponent(file.id)}`;
  link.textContent = 'Download';
  item.appendChild(name);
  item.appendChild(meta);
  item.appendChild(link);
  list.prepend(item);
}

/* ================= polls ================= */
function renderPoll(poll) {
  const list = $('#pollList');
  if (!list) return;
  let card = document.getElementById(`poll-${poll.id}`);
  if (!card) {
    card = document.createElement('div');
    card.id = `poll-${poll.id}`;
    card.className = 'poll-card';
    list.prepend(card);
  }
  card.innerHTML = '';

  const q = document.createElement('div');
  q.className = 'q';
  q.textContent = poll.question;
  card.appendChild(q);

  const total = Object.keys(poll.votes).length;
  const myVote = me ? poll.votes[me.id] : null;

  poll.options.forEach((opt, idx) => {
    const count = Object.values(poll.votes).filter((v) => v === idx).length;
    const pct = total ? Math.round((count / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'opt' + (myVote === idx ? ' chosen' : '');
    row.addEventListener('click', () => {
      if (socket) socket.emit('poll:vote', { pollId: poll.id, choice: idx });
    });

    const label = document.createElement('span');
    label.textContent = opt;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const inner = document.createElement('div');
    inner.style.width = pct + '%';
    bar.appendChild(inner);

    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = count;

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(cnt);
    card.appendChild(row);
  });

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size: 11px; color: var(--muted); margin-top: 8px;';
  meta.textContent = `by ${poll.createdBy} · ${total} vote${total !== 1 ? 's' : ''}`;
  card.appendChild(meta);
}

/* ================= reactions ================= */
function showReaction(peerId, emoji) {
  const tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
  if (!tile) return;
  const layer = tile.querySelector('.reactions-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + '%';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ================= tabs ================= */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = $(`#tab-${tab.dataset.tab}`);
    if (panel) panel.classList.add('active');
  });
});

/* ================= whiteboard ================= */
function openBoard() {
  const va = $('#videoArea');
  const ba = $('#boardArea');
  const bb = $('#btnBoard');
  if (va) va.classList.add('hidden');
  if (ba) ba.classList.remove('hidden');
  if (bb) bb.classList.add('active');
  if (board) { board.setEnabled(true); board.resize(); }
}
function closeBoard() {
  const va = $('#videoArea');
  const ba = $('#boardArea');
  const bb = $('#btnBoard');
  if (ba) ba.classList.add('hidden');
  if (va) va.classList.remove('hidden');
  if (bb) bb.classList.remove('active');
  if (board) board.setEnabled(false);
}

document.querySelectorAll('.swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
    sw.classList.add('active');
    if (board) { board.setColor(sw.dataset.color); board.setEraser(false); }
    const eb = $('#eraserBtn');
    if (eb) eb.textContent = 'Eraser: off';
  });
});

const eraserBtn = $('#eraserBtn');
if (eraserBtn) {
  eraserBtn.addEventListener('click', () => {
    if (!board) return;
    const on = !board.erasing;
    board.setEraser(on);
    eraserBtn.textContent = `Eraser: ${on ? 'on' : 'off'}`;
  });
}
const clearBoardBtn = $('#clearBoard');
if (clearBoardBtn) clearBoardBtn.addEventListener('click', () => board && board.clear());
const closeBoardBtn = $('#closeBoard');
if (closeBoardBtn) closeBoardBtn.addEventListener('click', () => closeBoard());
const btnBoardEl = $('#btnBoard');
if (btnBoardEl) {
  btnBoardEl.addEventListener('click', () => {
    const ba = $('#boardArea');
    if (ba && ba.classList.contains('hidden')) openBoard();
    else closeBoard();
  });
}

/* ================= QR ================= */
const qrBtnEl = $('#qrBtn');
if (qrBtnEl) {
  qrBtnEl.addEventListener('click', () => {
    const url = location.href;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
    const w = window.open('', 'qr', 'width=300,height=340');
    if (!w) return;
    w.document.write(`
      <html><head><title>QR — Room</title>
      <style>body{background:#0a0e16;color:#e8eef7;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;}
      img{background:#fff;padding:10px;border-radius:12px;}</style></head>
      <body><div style="text-align:center"><img src="${qrUrl}" alt="QR" /><p style="font-size:12px;color:#94a3b8;margin-top:12px;max-width:240px;word-break:break-all">${url}</p></div></body></html>
    `);
  });
}

/* ================= captions ================= */
let captions = null;
let captionTimer = null;

function renderCaption(text, interim) {
  const overlay = $('#captionsOverlay');
  const el = $('#captionsText');
  if (!overlay || !el) return;
  overlay.classList.remove('hidden');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  if (interim) span.className = 'interim';
  el.appendChild(span);
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => overlay.classList.add('hidden'), 4000);
}

const btnCaptionsEl = $('#btnCaptions');
if (btnCaptionsEl) {
  btnCaptionsEl.addEventListener('click', () => {
    if (!captions) {
      captions = new Captions({
                onTranscript: (text) => {
          if (socket) {
            socket.emit('caption', text);
            socket.emit('transcript:append', text);
          }
          renderCaption(text, false);
        },
        onInterim: (text) => renderCaption(text, true),
      });
    }
    if (!captions.supported) {
      toast('Live captions need Chrome or Edge', 'error');
      return;
    }
    const on = !btnCaptionsEl.classList.contains('active');
    btnCaptionsEl.classList.toggle('active', on);
    if (on) {
      captions.start();
      toast('Captions on — speak clearly', 'info');
    } else {
      captions.stop();
      const ov = $('#captionsOverlay');
      if (ov) ov.classList.add('hidden');
    }
  });
}

/* ================= boot ================= */
async function boot() {
  try {
    const { user } = await apiJson('/api/auth/me');
    me = user;
  } catch { location.href = '/'; return; }

  try {
    const { room: r } = await apiJson(`/api/rooms/${encodeURIComponent(roomId)}`);
    room = r;
    if (room.hasPassword && !sessionStorage.getItem('rtc_lobby_password')) {
      location.href = `/lobby.html?id=${encodeURIComponent(roomId)}`;
      return;
    }
  } catch {
    toast('Room not found', 'error');
    setTimeout(() => (location.href = '/app.html'), 1200);
    return;
  }

  document.title = `${room.name} — RTC`;
  const rn = $('#roomName'); if (rn) rn.textContent = room.name;
  const rl = $('#roomLink'); if (rl) rl.value = location.href;

  await loadIceServers();

  const startMuted = sessionStorage.getItem('rtc_lobby_mic') === '0';
  const startCamOff = sessionStorage.getItem('rtc_lobby_cam') === '0';

  mesh = new Mesh({
    socket: null,
    onRemoteStream: (peerId, stream) => attachStream(peerId, stream),
    onPeerLeft: (peerId) => {
      peerNames.delete(peerId);
      peerState.delete(peerId);
      removeTile(peerId);
      renderPeople();
    },
    onPeerState: (peerId, state) => {
      const tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
      if (!tile) return;
      const conn = tile.querySelector('.conn');
      if (!conn) return;
      if (state === 'connected') conn.textContent = '';
      else if (state === 'connecting' || state === 'new') conn.textContent = 'connecting…';
      else if (state === 'disconnected') conn.textContent = 'reconnecting…';
      else if (state === 'failed') conn.textContent = 'connection failed';
    },
    onPeerMedia: (peerId, state) => {
      const prev = peerState.get(peerId) || {};
      peerState.set(peerId, { ...prev, ...state });
      updateBadges(peerId);
      renderPeople();
    },
    onPeerStats: (peerId, stats) => {
      const prev = peerState.get(peerId) || {};
      peerState.set(peerId, { ...prev, stats });
      updateBadges(peerId);
    },
    onSpeaking: (peerId, speaking) => {
      const tile = document.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
      if (tile) tile.classList.toggle('speaking', speaking);
    },
  });

  try {
    const stream = await mesh.startLocal({ startMuted, startCamOff });
    const tile = ensureTile('local', me.name, true);
    const video = tile.querySelector('video');
    if (video) { video.srcObject = stream; video.play().catch(() => {}); }
    const bm = $('#btnMic'); if (bm) bm.className = 'ctrl ' + (mesh.audioEnabled ? 'on' : 'off');
    const bc = $('#btnCam'); if (bc) bc.className = 'ctrl ' + (mesh.videoEnabled ? 'on' : 'off');
  } catch (err) {
    toast('Camera/mic error: ' + err.message, 'error', 6000);
    setTimeout(() => (location.href = '/app.html'), 1500);
    return;
  }

  socket = io({ withCredentials: true });
  mesh.socket = socket;
  board = new Whiteboard({ canvas: $('#board'), socket });

  /* ---------- SOCKET LISTENERS (all at top level of boot) ---------- */
  socket.on('connect_error', () => setConn('auth failed', 'bad'));

  socket.on('connect', () => {
    setConn('connected', 'ok');
    const lobbyPassword = sessionStorage.getItem('rtc_lobby_password') || '';
    socket.emit('room:join', { roomId, password: lobbyPassword }, (res) => {
      if (!res) return;
      if (res.waiting) {
        setConn('waiting for host', '');
        toast('Waiting for host approval…', 'info', 10000);
        return;
      }
      if (res.error) {
        toast(res.error, 'error');
        setTimeout(() => (location.href = '/app.html'), 1200);
        return;
      }

      isHost = res.isOwner;
      sessionStorage.removeItem('rtc_lobby_password');

      for (const peer of res.peers) {
        peerNames.set(peer.socketId, peer.name);
        peerState.set(peer.socketId, {
          audio: peer.audio, video: peer.video, screen: peer.screen, hand: peer.hand,
        });
        ensureTile(peer.socketId, peer.name);
        updateBadges(peer.socketId);
      }
      if (board) board.setStrokes(res.strokes);
      (res.files || []).forEach(addFileEntry);
      (res.messages || []).forEach((m) => addChatMessage({ from: m.from, text: m.text, at: m.at }));
      (res.polls || []).forEach(renderPoll);
      if (res.agenda) renderAgenda(res.agenda);
      (res.transcript || []).forEach(appendTranscriptLine);
      if (res.breakouts) renderBreakouts(res.breakouts);

      const ne = $('#notesEditor'); if (ne) ne.value = res.notes || '';
      const lb = $('#lockBadge'); if (lb) lb.classList.toggle('hidden', !res.locked);
      const lr = $('#lockRoom'); if (lr) lr.textContent = res.locked ? 'Unlock room' : 'Lock room';
      const wt = $('#waitingToggle'); if (wt && res.waitingRoom !== undefined) wt.classList.toggle('active', res.waitingRoom);
      const hbc = $('#hostBreakoutControls'); if (hbc) hbc.classList.toggle('hidden', !isHost);

      // Request timer
      socket.emit('timer:ping');

      renderPeople();
    });
  });

  socket.on('disconnect', () => setConn('disconnected', 'bad'));

  socket.on('signal', ({ from, data }) => mesh.handleSignal(from, data));

  socket.on('peer:joined', ({ peerId, name }) => {
    peerNames.set(peerId, name);
    peerState.set(peerId, { audio: true, video: true, screen: false, hand: false });
    ensureTile(peerId, name);
    renderPeople();
    addChatMessage({ from: name, text: 'joined the meeting', at: Date.now(), system: true });
    mesh.addPeer(peerId);
  });

  socket.on('peer:left', ({ peerId }) => {
    const name = peerNames.get(peerId) || 'Someone';
    peerNames.delete(peerId);
    peerState.delete(peerId);
    mesh.removePeer(peerId);
    removeTile(peerId);
    renderPeople();
    addChatMessage({ from: name, text: 'left the meeting', at: Date.now(), system: true });
  });

  socket.on('peer:media', ({ peerId, ...state }) => {
    const prev = peerState.get(peerId) || {};
    peerState.set(peerId, { ...prev, ...state });
    updateBadges(peerId);
    renderPeople();
  });

  socket.on('peer:hand', ({ peerId, hand }) => {
    const prev = peerState.get(peerId) || {};
    peerState.set(peerId, { ...prev, hand });
    updateBadges(peerId);
    renderPeople();
  });

  socket.on('chat:message', (msg) => addChatMessage(msg));
  socket.on('file:shared', (f) => addFileEntry(f));
  socket.on('notes:update', (text) => { const ne = $('#notesEditor'); if (ne) ne.value = text; });
  socket.on('poll:created', (poll) => renderPoll(poll));
  socket.on('poll:updated', (poll) => renderPoll(poll));
  socket.on('reaction', ({ peerId, emoji }) => showReaction(peerId, emoji));

  /* -------- Waiting room events -------- */
  socket.on('waiting:list', ({ waiting }) => renderWaitingList(waiting || []));
  socket.on('waiting:admitted', () => {
    toast('You have been admitted', 'ok');
    setConn('connected', 'ok');
    socket.emit('room:join', {
      roomId,
      password: sessionStorage.getItem('rtc_lobby_password') || '',
    }, () => {});
  });
  socket.on('waiting:denied', () => {
    toast('Host denied your request', 'error');
    setTimeout(() => (location.href = '/app.html'), 1500);
  });
  socket.on('host:waiting-toggled', ({ enabled }) => {
    toast(enabled ? 'Waiting room ON' : 'Waiting room OFF', 'info');
    const wt = $('#waitingToggle');
    if (wt) wt.classList.toggle('active', enabled);
  });

  /* -------- Breakout events -------- */
  socket.on('breakout:list', (list) => renderBreakouts(list));
  socket.on('breakout:assigned', ({ name }) => {
    toast(`Assigned to breakout: ${name}`, 'info', 5000);
  });
  socket.on('breakout:closed', () => toast('Breakout room closed', 'info'));

  /* -------- Timer -------- */
  let timerRaf = 0;
  socket.on('timer:update', (timer) => {
    let el = document.getElementById('sharedTimer');
    if (!el) {
      el = document.createElement('span');
      el.id = 'sharedTimer';
      el.className = 'pill';
      el.style.cssText = 'font-variant-numeric: tabular-nums; font-weight: 700; margin-right: 8px;';
      const topbarRight = document.querySelector('.topbar-right');
      if (topbarRight) topbarRight.insertBefore(el, topbarRight.firstChild);
    }
    if (timerRaf) cancelAnimationFrame(timerRaf);
    if (!timer) { el.remove(); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.floor((timer.endsAt - Date.now()) / 1000));
      const min = Math.floor(remaining / 60);
      const sec = remaining % 60;
      el.textContent = `⏱ ${timer.label}: ${min}:${String(sec).padStart(2, '0')}`;
      if (remaining <= 0) {
        el.className = 'pill bad';
        el.textContent = `⏱ ${timer.label}: TIME UP`;
        return;
      }
      timerRaf = requestAnimationFrame(tick);
    };
    tick();
  });

  /* -------- Transcript download -------- */
  const dtBtn = $('#downloadTranscript');
  if (dtBtn) {
    dtBtn.addEventListener('click', () => {
      const el = $('#transcriptList');
      if (!el) return;
      const blob = new Blob([el.innerText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const ctBtn = $('#copyTranscript');
  if (ctBtn) {
    ctBtn.addEventListener('click', async () => {
      const el = $('#transcriptList');
      if (!el) return;
      try {
        await navigator.clipboard.writeText(el.innerText);
        toast('Transcript copied', 'ok');
      } catch { /* ignore */ }
    });
  }


  /* -------- Agenda -------- */
  socket.on('agenda:list', (list) => renderAgenda(list || []));

  /* -------- Transcript -------- */
  function appendTranscriptLine(line) {
    const el = $('#transcriptList');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${line.speaker} · ${fmtTime(line.at)}`;
    d.appendChild(who);
    const t = document.createElement('span');
    t.textContent = line.text;
    d.appendChild(t);
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  socket.on('transcript:line', appendTranscriptLine);


  /* -------- Host actions -------- */
  socket.on('host:force-mute', () => {
    const state = mesh.forceMute();
    const bm = $('#btnMic'); if (bm) bm.className = 'ctrl off';
    socket.emit('media:state', state);
    renderPeople();
    toast('Host muted you', 'info');
  });
  socket.on('host:kicked', () => {
    toast('You were removed from the room', 'error');
    mesh.destroy();
    socket.disconnect();
    setTimeout(() => (location.href = '/app.html'), 1200);
  });
  socket.on('host:locked', ({ locked }) => {
    const lb = $('#lockBadge'); if (lb) lb.classList.toggle('hidden', !locked);
    const lr = $('#lockRoom'); if (lr) lr.textContent = locked ? 'Unlock room' : 'Lock room';
    toast(locked ? 'Room locked' : 'Room unlocked', 'info');
  });

  /* -------- Captions -------- */
  socket.on('caption', ({ name, text }) => {
    const overlay = $('#captionsOverlay');
    const el = $('#captionsText');
    if (!overlay || !el) return;
    overlay.classList.remove('hidden');
    el.innerHTML = '';
    const who = document.createElement('strong');
    who.textContent = `${name}: `;
    who.style.color = 'var(--accent)';
    el.appendChild(who);
    el.appendChild(document.createTextNode(text));
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => overlay.classList.add('hidden'), 5000);
  });

  /* -------- CHAT input -------- */
  const chatForm = $('#chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chatInput');
      if (!input || !input.value.trim()) return;
      socket.emit('chat:send', { text: input.value });
      input.value = '';
    });
  }

  /* -------- Notes -------- */
  let notesTimer = null;
  const ne = $('#notesEditor');
  if (ne) {
    ne.addEventListener('input', (e) => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => socket.emit('notes:update', e.target.value), 250);
    });
  }

  /* -------- Polls -------- */
  const createPollBtn = $('#createPoll');
  if (createPollBtn) {
    createPollBtn.addEventListener('click', () => {
      const q = ($('#pollQuestion') || {}).value || '';
      const opts = [$('#pollOption1'), $('#pollOption2'), $('#pollOption3')]
        .map((el) => (el ? el.value.trim() : ''))
        .filter(Boolean);
      if (!q.trim() || opts.length < 2) return toast('Need question + at least 2 options', 'error');
      socket.emit('poll:create', { question: q.trim(), options: opts });
      ['#pollQuestion', '#pollOption1', '#pollOption2', '#pollOption3'].forEach((sel) => {
        const el = $(sel);
        if (el) el.value = '';
      });
    });
  }

  /* -------- Waiting room button -------- */
  const wt = $('#waitingToggle');
  if (wt) {
    wt.addEventListener('click', () => {
      const enabled = !wt.classList.contains('active');
      socket.emit('host:toggle-waiting', enabled);
    });
  }

  /* -------- Breakout controls -------- */
  const cb = $('#createBreakout');
  if (cb) {
    cb.addEventListener('click', () => {
      const name = ($('#breakoutName') || {}).value || '';
      socket.emit('breakout:create', { name: name.trim() });
      if ($('#breakoutName')) $('#breakoutName').value = '';
    });
  }

  /* -------- Timer button -------- */
  const st = $('#startTimer');
  if (st) {
    st.addEventListener('click', () => {
      const seconds = Number(prompt('Timer duration (seconds):', '300'));
      if (!seconds) return;
      const label = prompt('Label:', 'Break') || 'Timer';
      socket.emit('timer:start', { seconds, label });
    });
  }

  /* -------- Agenda -------- */
  const addAg = $('#addAgenda');
  if (addAg) {
    addAg.addEventListener('click', () => {
      const text = ($('#agendaItem') || {}).value || '';
      const minutes = Number(($('#agendaMinutes') || {}).value) || 0;
      if (!text.trim()) return;
      socket.emit('agenda:add', { text: text.trim(), minutes });
      if ($('#agendaItem')) $('#agendaItem').value = '';
      if ($('#agendaMinutes')) $('#agendaMinutes').value = '';
    });
  }

  /* -------- Reactions -------- */
  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => socket.emit('reaction', btn.dataset.emoji));
  });

  /* -------- Files -------- */
  const fileInput = $('#fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const label = $('#uploadText');
      const prog = $('#uploadProgress');
      const bar = prog ? prog.querySelector('div') : null;
      if (prog) prog.classList.add('show');
      if (bar) bar.style.width = '0%';
      if (label) label.textContent = `Uploading ${file.name}…`;

      const form = new FormData();
      form.append('file', file);
      form.append('roomId', roomId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && bar) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          bar.style.width = pct + '%';
        }
      };
      xhr.onload = () => {
        if (prog) prog.classList.remove('show');
        if (label) label.textContent = 'Click to upload (max 100 MB)';
        e.target.value = '';
        if (xhr.status >= 400) {
          try {
            const err = JSON.parse(xhr.responseText);
            toast(err.error || 'Upload failed', 'error');
          } catch { toast('Upload failed', 'error'); }
          return;
        }
        toast('File shared', 'ok');
      };
      xhr.onerror = () => {
        if (prog) prog.classList.remove('show');
        if (label) label.textContent = 'Click to upload (max 100 MB)';
        e.target.value = '';
        toast('Upload failed', 'error');
      };
      xhr.send(form);
    });
  }

  /* -------- Controls -------- */
  const btnMic = $('#btnMic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      const state = mesh.toggleAudio();
      btnMic.className = 'ctrl ' + (state.audio ? 'on' : 'off');
      socket.emit('media:state', state);
      renderPeople();
    });
  }
  const btnCam = $('#btnCam');
  if (btnCam) {
    btnCam.addEventListener('click', () => {
      const state = mesh.toggleVideo();
      btnCam.className = 'ctrl ' + (state.video ? 'on' : 'off');
      socket.emit('media:state', state);
      renderPeople();
    });
  }
  const btnHand = $('#btnHand');
  if (btnHand) {
    btnHand.addEventListener('click', () => {
      const raised = !btnHand.classList.contains('active');
      btnHand.classList.toggle('active', raised);
      socket.emit('hand:raise', raised);
    });
  }
  const btnScreen = $('#btnScreen');
  if (btnScreen) {
    btnScreen.addEventListener('click', async () => {
      try {
        if (mesh.screenSharing) {
          await mesh.stopScreenShare();
          btnScreen.classList.remove('active');
          socket.emit('media:state', { audio: mesh.audioEnabled, video: mesh.videoEnabled, screen: false });
        } else {
          await mesh.startScreenShare();
          btnScreen.classList.add('active');
          socket.emit('media:state', { audio: mesh.audioEnabled, video: mesh.videoEnabled, screen: true });
        }
      } catch (err) {
        if (err && err.name !== 'NotAllowedError') console.warn(err);
      }
    });
  }
  const copyLinkBtn = $('#copyLink');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast('Link copied', 'ok');
      } catch {
        const rl = $('#roomLink');
        if (rl) { rl.select(); document.execCommand('copy'); }
      }
    });
  }

  /* -------- Recording -------- */
  const btnRecord = $('#btnRecord');
  if (btnRecord) {
    btnRecord.addEventListener('click', () => {
      if (!recorder) {
        const combined = new MediaStream();
        mesh.localStream.getTracks().forEach((t) => combined.addTrack(t));
        try {
          recorder = new MediaRecorder(combined, { mimeType: 'video/webm;codecs=vp9,opus' });
        } catch {
          recorder = new MediaRecorder(combined);
        }
        recordingChunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(recordingChunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recording-${Date.now()}.webm`;
          a.click();
          URL.revokeObjectURL(url);
          toast('Recording saved', 'ok');
        };
        recorder.start();
        btnRecord.classList.add('active');
        toast('Recording started (local)', 'info');
      } else {
        recorder.stop();
        recorder = null;
        btnRecord.classList.remove('active');
      }
    });
  }

  /* -------- Host controls -------- */
  const muteAllBtn = $('#muteAll');
  if (muteAllBtn) muteAllBtn.addEventListener('click', () => socket.emit('host:mute-all'));
  const lockRoomBtn = $('#lockRoom');
  if (lockRoomBtn) {
    lockRoomBtn.addEventListener('click', () => {
      const locked = lockRoomBtn.textContent.includes('Lock');
      socket.emit('host:lock', locked);
    });
  }

  /* -------- Analytics button -------- */
  const btnAnalytics = $('#btnAnalytics');
  if (btnAnalytics) {
    btnAnalytics.addEventListener('click', () => {
      window.open(`/analytics.html?id=${encodeURIComponent(roomId)}`, '_blank');
    });
  }


  /* -------- Leave -------- */
  const btnLeave = $('#btnLeave');
  if (btnLeave) {
    btnLeave.addEventListener('click', () => {
      if (!confirm('Leave the meeting?')) return;
      mesh.destroy();
      socket.disconnect();
      location.href = '/app.html';
    });
  }

  /* -------- Keyboard shortcuts -------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'm') btnMic && btnMic.click();
    else if (k === 'v') btnCam && btnCam.click();
    else if (k === 's') btnScreen && btnScreen.click();
    else if (k === 'w') btnBoardEl && btnBoardEl.click();
    else if (k === 'h') btnHand && btnHand.click();
    else if (k === 'k') btnCaptionsEl && btnCaptionsEl.click();
  });

  window.addEventListener('beforeunload', () => {
    try { mesh.destroy(); } catch {}
    try { socket.disconnect(); } catch {}
  });
}

boot();