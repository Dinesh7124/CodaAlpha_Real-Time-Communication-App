/**
 * Live captions using Web Speech API.
 * Chrome/Edge: works out of the box.
 * Firefox/Safari: not supported — we degrade gracefully.
 */

export class Captions {
  constructor({ onTranscript, onInterim, lang = 'en-US' }) {
    this.onTranscript = onTranscript || (() => {});
    this.onInterim = onInterim || (() => {});
    this.lang = lang;
    this.recognition = null;
    this.running = false;
    this.supported = false;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    this.supported = true;
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = lang;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          this.onTranscript(text.trim(), this.lang);
        } else {
          interim += text;
        }
      }
      if (interim) this.onInterim(interim);
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      console.warn('[captions]', e.error);
      if (e.error === 'not-allowed') this.running = false;
    };

    this.recognition.onend = () => {
      if (this.running) {
        try { this.recognition.start(); } catch { /* ignore */ }
      }
    };
  }

  start() {
    if (!this.supported || this.running) return false;
    try {
      this.recognition.start();
      this.running = true;
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (!this.supported || !this.running) return;
    this.running = false;
    try { this.recognition.stop(); } catch { /* ignore */ }
  }

  setLang(lang) {
    this.lang = lang;
    if (this.recognition) this.recognition.lang = lang;
  }
}