import { toast, initTheme, apiJson } from './ui.js';

initTheme();

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const roomId = params.get('id');

if (!roomId) location.href = '/app.html';

let localStream = null;
let audioCtx = null;
let analyser = null;
let micRaf = 0;
let camEnabled = true;
let micEnabled = true;

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput');

  const camSel = $('#cameraSelect');
  const micSel = $('#micSelect');
  camSel.innerHTML = '';
  micSel.innerHTML = '';

  cams.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = c.deviceId;
    opt.textContent = c.label || `Camera ${i + 1}`;
    camSel.appendChild(opt);
  });
  mics.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = m.deviceId;
    opt.textContent = m.label || `Microphone ${i + 1}`;
    micSel.appendChild(opt);
  });

  if (localStream) {
    const vt = localStream.getVideoTracks()[0];
    const at = localStream.getAudioTracks()[0];
    if (vt && vt.getSettings().deviceId) camSel.value = vt.getSettings().deviceId;
    if (at && at.getSettings().deviceId) micSel.value = at.getSettings().deviceId;
  }
}

function startMicMeter() {
  if (!localStream) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(localStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(100, (sum / data.length) * 2.2);
      $('#micLevel').style.width = level + '%';
      micRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* ignore */ }
}

async function startPreview() {
  try {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    const videoId = $('#cameraSelect').value;
    const audioId = $('#micSelect').value;

    localStream = await navigator.mediaDevices.getUserMedia({
      video: videoId ? { deviceId: { exact: videoId } } : { width: 1280, height: 720 },
      audio: audioId ? { deviceId: { exact: audioId } } : true,
    });

    $('#previewVideo').srcObject = localStream;
    $('#permHint').textContent = 'Permissions granted. Looking good!';

    localStream.getVideoTracks().forEach((t) => { t.enabled = camEnabled; });
    localStream.getAudioTracks().forEach((t) => { t.enabled = micEnabled; });

    $('#camOff').classList.toggle('hidden', camEnabled);
    if (!audioCtx) startMicMeter();
    await listDevices();
  } catch (err) {
    $('#permHint').textContent = 'Could not access camera/mic: ' + err.message;
    toast('Camera/mic error: ' + err.message, 'error', 6000);
  }
}

$('#cameraSelect').addEventListener('change', startPreview);
$('#micSelect').addEventListener('change', startPreview);

$('#toggleCam').addEventListener('click', () => {
  camEnabled = !camEnabled;
  if (localStream) localStream.getVideoTracks().forEach((t) => { t.enabled = camEnabled; });
  $('#toggleCam').textContent = `📷 Camera ${camEnabled ? 'on' : 'off'}`;
  $('#camOff').classList.toggle('hidden', camEnabled);
});

$('#toggleMic').addEventListener('click', () => {
  micEnabled = !micEnabled;
  if (localStream) localStream.getAudioTracks().forEach((t) => { t.enabled = micEnabled; });
  $('#toggleMic').textContent = `🎤 Mic ${micEnabled ? 'on' : 'off'}`;
});

$('#joinBtn').addEventListener('click', async () => {
  const password = $('#roomPassword').value;
  sessionStorage.setItem('rtc_lobby_password', password);
  sessionStorage.setItem('rtc_lobby_cam', camEnabled ? '1' : '0');
  sessionStorage.setItem('rtc_lobby_mic', micEnabled ? '1' : '0');

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (micRaf) cancelAnimationFrame(micRaf);
  if (audioCtx) audioCtx.close().catch(() => {});

  location.href = `/room.html?id=${encodeURIComponent(roomId)}`;
});

(async function boot() {
  // Check whether the room requires a password.
  try {
    const { room } = await apiJson(`/api/rooms/${encodeURIComponent(roomId)}`);
    if (room.hasPassword) $('#passwordWrap').classList.remove('hidden');
  } catch {
    toast('Room not found', 'error');
    setTimeout(() => (location.href = '/app.html'), 1200);
    return;
  }

  try {
    // Request permissions first so device labels are available.
    const temp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    temp.getTracks().forEach((t) => t.stop());
  } catch { /* ignore */ }

  await startPreview();
})();