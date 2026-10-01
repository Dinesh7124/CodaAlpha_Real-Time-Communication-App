/**
 * Virtual backgrounds using MediaPipe Selfie Segmentation.
 * Runs entirely in the browser — no server cost.
 */

export class VirtualBackground {
  constructor() {
    this.segmenter = null;
    this.mode = 'none'; // 'none' | 'blur' | 'color'
    this.color = '#1e293b';
    this.outputStream = null;
    this.raf = 0;
  }

  async init() {
    if (this.segmenter) return;
    if (!window.SelfieSegmentation) {
      await this._loadScript(
        'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'
      );
    }

    this.segmenter = new window.SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    this.segmenter.setOptions({ modelSelection: 1 });
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /**
   * Process a video track and return a new video track with the effect applied.
   */
  async process(inputTrack, mode = 'blur', color = '#1e293b') {
    this.mode = mode;
    this.color = color;

    if (mode === 'none') {
      return inputTrack;
    }

    await this.init();

    const inputStream = new MediaStream([inputTrack]);
    const video = document.createElement('video');
    video.srcObject = inputStream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const outStream = canvas.captureStream(25);

    const settings = inputTrack.getSettings();
    canvas.width = settings.width || 1280;
    canvas.height = settings.height || 720;

    const bgCanvas = document.createElement('canvas');
    const bgCtx = bgCanvas.getContext('2d');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;

    this.segmenter.onResults((results) => {
      if (!this.mode || this.mode === 'none') return;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background
      if (this.mode === 'blur') {
        ctx.filter = 'blur(16px)';
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';
      } else if (this.mode === 'color') {
        ctx.fillStyle = this.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Draw person mask
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    });

    const loop = async () => {
      if (video.paused || video.ended) return;
      try {
        await this.segmenter.send({ image: video });
      } catch { /* ignore */ }
      this.raf = requestAnimationFrame(loop);
    };
    loop();

    const outputTrack = outStream.getVideoTracks()[0];
    this.outputStream = outStream;
    return outputTrack;
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.mode = 'none';
    if (this.outputStream) {
      this.outputStream.getTracks().forEach((t) => t.stop());
      this.outputStream = null;
    }
  }
}