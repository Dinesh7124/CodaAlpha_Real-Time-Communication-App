/**
 * Shared whiteboard.
 *
 * Strokes are stored in a fixed 1600x900 logical space and scaled to whatever
 * size the canvas happens to be. That way a stroke drawn on a 27" monitor
 * lands in the same relative place on a phone.
 */

const W = 1600;
const H = 900;

export class Whiteboard {
  constructor({ canvas, socket }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.socket = socket;

    this.strokes = [];
    this.color = '#ffffff';
    this.lineWidth = 4;
    this.erasing = false;
    this.drawing = false;
    this.last = null;
    this.enabled = false;

    this.sx = 1;
    this.sy = 1;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', (e) => this.onUp(e));

    window.addEventListener('resize', () => this.resize());

    socket.on('wb:stroke', (stroke) => {
      if (stroke && stroke.type === 'clear') {
        this.strokes = [];
        this.redraw();
        return;
      }
      this.strokes.push(stroke);
      this.drawStroke(stroke);
    });

    socket.on('wb:clear', () => {
      this.strokes = [];
      this.redraw();
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      // The canvas has zero size while hidden — measure once it is visible.
      requestAnimationFrame(() => this.resize());
    }
  }

  setStrokes(strokes) {
    this.strokes = Array.isArray(strokes) ? strokes.slice() : [];
    this.resize();
  }

  setColor(color) {
    this.color = color;
    this.erasing = false;
  }

  setEraser(on) {
    this.erasing = Boolean(on);
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.socket.emit('wb:clear');
  }

  /* ---------------- geometry ---------------- */

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);

    this.sx = this.canvas.width / W;
    this.sy = this.canvas.height / H;

    this.redraw();
  }

  pointFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return {
      x: Math.min(W, Math.max(0, x)),
      y: Math.min(H, Math.max(0, y)),
    };
  }

  /* ---------------- drawing ---------------- */

  applyTransform() {
    this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
  }

  redraw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyTransform();
    for (const s of this.strokes) this.drawStroke(s);
  }

  drawStroke(s) {
    if (!s || s.type === 'clear') return;
    const ctx = this.ctx;

    this.applyTransform();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.color;
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';

    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- input ---------------- */

  onDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.drawing = true;
    this.last = this.pointFromEvent(e);
  }

  onMove(e) {
    if (!this.enabled || !this.drawing || !this.last) return;
    e.preventDefault();

    const p = this.pointFromEvent(e);

    const stroke = {
      x0: this.last.x,
      y0: this.last.y,
      x1: p.x,
      y1: p.y,
      color: this.erasing ? '#000000' : this.color,
      width: this.erasing ? this.lineWidth * 5 : this.lineWidth,
      erase: this.erasing,
    };

    this.last = p;
    this.strokes.push(stroke);
    this.drawStroke(stroke);
    this.socket.emit('wb:stroke', stroke);
  }

  onUp(e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.last = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }
}