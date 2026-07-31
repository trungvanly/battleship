// Audio layer: every effect is synthesised with the Web Audio API, so the game
// stays a dependency-free static page (no asset files, no network requests).
// Environments without Web Audio (jsdom, older browsers) get a silent no-op.

const SOUND_STORAGE_KEY = "battleship.muted";

const sound = (() => {
  const AudioCtor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  let ctx = null;
  let muted = readMuted();

  function readMuted() {
    try {
      return window.localStorage.getItem(SOUND_STORAGE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function persistMuted() {
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, muted ? "1" : "0");
    } catch (err) {
      /* private mode or a file:// origin without storage — the setting is just not remembered */
    }
  }

  // Browsers only allow audio after a user gesture, so the context is created on
  // the first effect and resumed if it was suspended in the meantime.
  function audio() {
    if (!AudioCtor) return null;
    if (!ctx) ctx = new AudioCtor();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function envelope(ac, gain, start, duration) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    return g;
  }

  // A single pitched note, optionally sweeping from `freq` to `to`.
  function tone(ac, { freq, to, type = "sine", gain = 0.2, duration = 0.2, delay = 0 }) {
    const start = ac.currentTime + delay;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    const g = envelope(ac, gain, start, duration);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  // Filtered white noise: splashes and explosions.
  function noise(ac, { duration = 0.3, gain = 0.2, filter = "lowpass", freq = 1000, delay = 0 }) {
    const start = ac.currentTime + delay;
    const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const bp = ac.createBiquadFilter();
    bp.type = filter;
    bp.frequency.setValueAtTime(freq, start);
    const g = envelope(ac, gain, start, duration);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(start);
    src.stop(start + duration);
  }

  const EFFECTS = {
    place: (ac) => tone(ac, { freq: 320, to: 480, type: "triangle", gain: 0.15, duration: 0.12 }),
    invalid: (ac) => tone(ac, { freq: 200, to: 110, type: "square", gain: 0.12, duration: 0.18 }),
    fire: (ac) => {
      tone(ac, { freq: 900, to: 120, type: "sawtooth", gain: 0.12, duration: 0.22 });
      noise(ac, { duration: 0.18, gain: 0.1, filter: "highpass", freq: 900 });
    },
    miss: (ac) => noise(ac, { duration: 0.35, gain: 0.18, filter: "lowpass", freq: 700, delay: 0.05 }),
    hit: (ac) => {
      noise(ac, { duration: 0.45, gain: 0.3, filter: "lowpass", freq: 380, delay: 0.05 });
      tone(ac, { freq: 160, to: 45, type: "square", gain: 0.2, duration: 0.4, delay: 0.05 });
    },
    sunk: (ac) => {
      noise(ac, { duration: 0.7, gain: 0.32, filter: "lowpass", freq: 300, delay: 0.05 });
      tone(ac, { freq: 220, to: 40, type: "sawtooth", gain: 0.25, duration: 0.8, delay: 0.05 });
      tone(ac, { freq: 90, to: 35, type: "sine", gain: 0.2, duration: 0.9, delay: 0.25 });
    },
    win: (ac) => [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      tone(ac, { freq, type: "triangle", gain: 0.2, duration: 0.28, delay: i * 0.14 })),
    lose: (ac) => [392, 329.63, 261.63, 196].forEach((freq, i) =>
      tone(ac, { freq, type: "triangle", gain: 0.2, duration: 0.35, delay: i * 0.18 })),
  };

  function play(name) {
    if (muted) return;
    const effect = EFFECTS[name];
    if (!effect) {
      console.warn(`Unknown sound effect "${name}".`);
      return;
    }
    const ac = audio();
    if (!ac) return;
    try {
      effect(ac);
    } catch (err) {
      // Audio is a nicety: a failure here must never interrupt the game.
      console.warn(`Could not play the "${name}" sound:`, err);
    }
  }

  return {
    play,
    get muted() { return muted; },
    get available() { return !!AudioCtor; },
    setMuted(value) {
      muted = !!value;
      persistMuted();
      return muted;
    },
    toggle() { return this.setMuted(!muted); },
  };
})();
