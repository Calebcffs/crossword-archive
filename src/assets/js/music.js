/*
 * music.js — "The Study Radio"
 *
 * Generative background music for the Constructor's Study. Instead of
 * shipping big MP3 files, this composes gentle ambient music live in the
 * browser with the Web Audio API (the same idea as make-art.js generating
 * the pixel art: the "recording" is code).
 *
 * The feel we're after: calm, warm, a little nostalgic — closer to
 * Minecraft's ambient soundtrack than to arcade chiptune. Long soft chords,
 * sparse simple melodies, plenty of near-silence. Music to think to.
 *
 * How it's organised:
 *   - MOODS: one recipe per mood (welcome / browse / solve / seasonal-*).
 *     Each page picks its mood via <body data-music-mood="...">.
 *   - The "solve" mood is special: it holds several variations ("thinking
 *     tracks") and one is chosen at random on every page load, so solving
 *     never sounds exactly the same twice.
 *   - A tiny scheduler composes one "phrase" (a chord + a few melody notes,
 *     or sometimes just silence) every ~8-12 seconds, always a couple of
 *     seconds ahead of the clock.
 *   - Instruments are small functions that wire up oscillators: a soft pad,
 *     a felt-piano pluck, a music-box bell, and a warm sub bass. Everything
 *     runs through a generated reverb so it feels like a real room.
 *   - Solving a puzzle fires Exolve's completion event; if the radio is on,
 *     we play a short congratulatory jingle.
 *
 * Music is OFF by default and only ever starts from a click on the toggle
 * (browsers require a user gesture before audio anyway). The choice is
 * remembered in localStorage.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Music theory helpers
   *
   * Notes are written as MIDI numbers (60 = middle C, +1 per semitone)
   * because arithmetic on them is easy. hz() converts to a frequency.
   * ---------------------------------------------------------------- */
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chance = (p) => Math.random() < p;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /* ---------------------------------------------------------------- *
   * The moods
   *
   * Each mood recipe has:
   *   chords     — sets of MIDI notes for the sustained pad (low-mid range)
   *   scale      — melody notes to sprinkle on top (higher range)
   *   phrase     — seconds per phrase (one chord = one phrase)
   *   restChance — probability a whole phrase is silence ("breathing room")
   *   notesMin/notesMax — how many melody notes per non-silent phrase
   *   lead       — which instrument plays the melody
   *   level      — overall loudness of this mood (solve is quietest)
   * ---------------------------------------------------------------- */

  const MOODS = {
    /* First impression: warm and a little magical. C major with soft
       colour tones, bells answering the piano. */
    welcome: {
      chords: [
        [48, 55, 59, 64], // Cmaj7
        [45, 52, 60, 64], // Am add b3... (A2 E3 C4 E4)
        [41, 48, 57, 64], // Fmaj7
        [43, 50, 59, 62], // G add B
      ],
      scale: [72, 74, 76, 79, 81, 83, 84, 88],
      phrase: 8,
      restChance: 0.15,
      notesMin: 2,
      notesMax: 5,
      lead: 'mix', // piano and bells take turns
      level: 0.9,
    },

    /* Browsing the archive: wandering a cosy library. A minor, mostly
       piano, a touch quieter and sparser than the welcome mat. */
    browse: {
      chords: [
        [45, 52, 59, 64], // Am9 (open voicing)
        [41, 48, 57, 64], // Fmaj7
        [48, 55, 64, 67], // Cmaj7
        [40, 47, 55, 62], // Em7
      ],
      scale: [69, 72, 74, 76, 79, 81, 84],
      phrase: 9,
      restChance: 0.25,
      notesMin: 1,
      notesMax: 4,
      lead: 'piano',
      level: 0.75,
    },

    /* Optional seasonal flavour: assign it to a page or a puzzle by
       putting `musicMood: seasonal-winter` in its front matter. Icy
       music-box bells over slow, hushed chords. More seasons can be
       added by copying this block and tweaking the recipe. */
    'seasonal-winter': {
      chords: [
        [45, 52, 60, 67], // Am add9, tall and airy
        [41, 48, 57, 64], // Fmaj7
        [43, 50, 62, 67], // G
        [40, 47, 59, 64], // Em add b6 colour
      ],
      scale: [76, 79, 81, 84, 88, 91],
      phrase: 10,
      restChance: 0.3,
      notesMin: 1,
      notesMax: 4,
      lead: 'bell',
      level: 0.7,
    },
  };

  /* The "thinking tracks": variations used on puzzle pages. One is picked
     at random per visit, so the solve mood stays fresh over many visits.
     These are the calmest recipes — minimal, ambient, for concentration. */
  const SOLVE_VARIATIONS = [
    {
      name: 'Rainlight', // C lydian: bright but unresolved, like daydreaming
      chords: [
        [48, 55, 59, 64], // Cmaj7
        [50, 57, 62, 66], // D (lydian colour)
        [45, 52, 59, 64], // Am9
        [43, 54, 59, 62], // G add #4
      ],
      scale: [71, 72, 74, 76, 78, 79, 83],
      phrase: 11, restChance: 0.35, notesMin: 1, notesMax: 3,
      lead: 'piano', level: 0.6,
    },
    {
      name: 'Music box', // A minor, tiny distant music-box phrases
      chords: [
        [45, 52, 59, 64], // Am9
        [41, 48, 57, 60], // Fmaj7
        [40, 47, 55, 59], // Em
        [48, 55, 62, 64], // Cadd9
      ],
      scale: [81, 84, 86, 88, 91, 93],
      phrase: 12, restChance: 0.4, notesMin: 1, notesMax: 3,
      lead: 'bell', level: 0.55,
    },
    {
      name: 'Lamplight', // F major: the warmest of the set
      chords: [
        [41, 48, 57, 64], // Fmaj7
        [46, 53, 62, 65], // Bbmaj7
        [45, 52, 60, 64], // Am7
        [43, 50, 58, 65], // Gm7
      ],
      scale: [69, 72, 74, 77, 79, 81, 84],
      phrase: 10, restChance: 0.3, notesMin: 1, notesMax: 4,
      lead: 'mix', level: 0.6,
    },
    {
      name: 'Midnight', // E minor: deepest and stillest — mostly just pads
      chords: [
        [40, 47, 54, 62], // Em9
        [36, 43, 52, 59], // Cmaj7 (low)
        [45, 52, 55, 62], // Am7
        [38, 45, 54, 57], // Dsus
      ],
      scale: [64, 66, 67, 71, 74, 76, 79],
      phrase: 13, restChance: 0.45, notesMin: 0, notesMax: 2,
      lead: 'piano', level: 0.55,
    },
  ];

  /* ---------------------------------------------------------------- *
   * Audio engine state
   * ---------------------------------------------------------------- */
  let ctx = null;        // AudioContext, created on first play
  let master = null;     // final volume knob
  let musicBus = null;   // everything except the jingle (so we can duck it)
  let dry = null;        // straight-to-speakers path
  let reverbSend = null; // path into the reverb
  let playing = false;   // is the radio on?
  let phraseTimer = 0;   // setTimeout id for the composer loop
  let nextPhraseAt = 0;  // AudioContext time the next phrase starts
  let chordIndex = 0;
  let mood = null;       // the active mood recipe

  const STORAGE_KEY = 'study-music';

  /* Build the shared plumbing: master volume, a compressor as a safety
     net against clipping, and a soft 3.5-second reverb whose impulse
     response we generate from decaying noise (no file needed). */
  function initAudio() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -20;
    limiter.knee.value = 20;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0; // faded in by setRadio()
    master.connect(limiter);

    musicBus = ctx.createGain();
    musicBus.connect(master);

    dry = ctx.createGain();
    dry.gain.value = 0.75;
    dry.connect(musicBus);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeReverbImpulse(3.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    convolver.connect(wet);
    wet.connect(musicBus);

    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver);
  }

  /* A reverb impulse response is just "what a clap sounds like in the
     room". Decaying random noise makes a perfectly nice imaginary room. */
  function makeReverbImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
    }
    return buf;
  }

  /* Every instrument sends its output here: mostly dry, partly reverb. */
  function toSpeakers(node, reverbAmount) {
    node.connect(dry);
    const send = ctx.createGain();
    send.gain.value = reverbAmount;
    node.connect(send);
    send.connect(reverbSend);
  }

  /* ---------------------------------------------------------------- *
   * Instruments
   *
   * Each takes (when, midiNote, ...) and schedules sound at an absolute
   * AudioContext time. All envelopes end at 0.0001 (not 0) because
   * exponential ramps can't reach zero.
   * ---------------------------------------------------------------- */

  /* Soft synth pad: two barely-detuned triangle waves through a gentle
     low-pass filter, swelling in over a few seconds. The bed everything
     else rests on. */
  function pad(when, midi, dur, peak) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 750;
    filter.Q.value = 0.4;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + dur * 0.35);
    amp.gain.setValueAtTime(peak, when + dur * 0.6);
    amp.gain.linearRampToValueAtTime(0.0001, when + dur);
    filter.connect(amp);
    toSpeakers(amp, 0.9);

    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
  }

  /* Warm sub bass: a plain sine an octave down, hugging the pad. */
  function bass(when, midi, dur, peak) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz(midi - 12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + 1.2);
    amp.gain.setValueAtTime(peak, when + dur * 0.55);
    amp.gain.linearRampToValueAtTime(0.0001, when + dur);
    osc.connect(amp);
    toSpeakers(amp, 0.3);
    osc.start(when);
    osc.stop(when + dur + 0.1);
  }

  /* Felt piano: a mellow triangle pluck with a quiet octave shimmer,
     filtered dark and left to ring out. */
  function piano(when, midi, peak) {
    const decay = 2.8;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    filter.connect(amp);
    toSpeakers(amp, 0.65);

    const notes = [[midi, 1], [midi + 12, 0.18]]; // fundamental + shimmer
    for (const [m, g] of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(m);
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og);
      og.connect(filter);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  /* Music-box bell: pure sine partials with a fast strike and a long
     glassy tail. The slightly out-of-tune high partial is what makes it
     sound like metal instead of a synth. */
  function bell(when, midi, peak) {
    const decay = 3.5;
    const partials = [[1, 1], [2.0, 0.25], [3.01, 0.1]];
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    toSpeakers(amp, 0.85);
    for (const [ratio, g] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(midi) * ratio;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og);
      og.connect(amp);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  /* ---------------------------------------------------------------- *
   * The composer
   *
   * Composes one phrase at a time, a couple of seconds before it is due,
   * then sets a timer to come back for the next one.
   * ---------------------------------------------------------------- */
  function schedulePhrase() {
    if (!playing) return;

    const t = nextPhraseAt;
    const dur = mood.phrase * rand(0.9, 1.15);

    /* Some phrases are deliberately silent — the music breathing. */
    if (!chance(mood.restChance)) {
      /* Mostly walk forward through the progression; occasionally linger. */
      if (!chance(0.25)) chordIndex = (chordIndex + 1) % mood.chords.length;
      const chord = mood.chords[chordIndex];

      for (const note of chord) pad(t + rand(0, 0.4), note, dur, 0.05 * mood.level);
      bass(t, chord[0], dur, 0.11 * mood.level);

      /* Sprinkle a few melody notes at loose, unhurried moments. */
      const count = Math.round(rand(mood.notesMin, mood.notesMax));
      for (let i = 0; i < count; i++) {
        const noteAt = t + rand(0.8, dur - 2.5);
        const note = pick(mood.scale);
        const inst = mood.lead === 'mix' ? (chance(0.6) ? piano : bell)
                   : mood.lead === 'bell' ? bell : piano;
        inst(noteAt, note, rand(0.05, 0.09) * mood.level);
      }
    }

    nextPhraseAt = t + dur;
    /* Wake up again ~2s before the next phrase is due. */
    const waitMs = Math.max(250, (nextPhraseAt - ctx.currentTime - 2) * 1000);
    phraseTimer = setTimeout(schedulePhrase, waitMs);
  }

  /* A short, gentle "puzzle finished!" jingle: a rising arpeggio with a
     warm chord underneath. Plays on the master bus while the background
     music ducks out of the way for a few seconds. */
  function playJingle() {
    const t = ctx.currentTime + 0.05;

    /* Duck the ambient music, then let it swell back. */
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0.15, t + 0.3);
    musicBus.gain.setValueAtTime(0.15, t + 3.5);
    musicBus.gain.linearRampToValueAtTime(1, t + 6);

    /* Jingle gets its own little bus straight into master. */
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(master);

    const arpeggio = [64, 67, 71, 72, 76]; // E G B C E — hopeful, not brash
    arpeggio.forEach((note, i) => {
      const when = t + i * 0.16;
      jingleBell(bus, when, note, 0.09);
      if (i === arpeggio.length - 1) jingleBell(bus, when, note + 12, 0.04);
    });
  }

  /* Same recipe as bell() but wired into the jingle's own bus. */
  function jingleBell(bus, when, midi, peak) {
    const decay = 3;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    amp.connect(bus);
    for (const [ratio, g] of [[1, 1], [2, 0.2]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(midi) * ratio;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og);
      og.connect(amp);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  /* ---------------------------------------------------------------- *
   * Radio on / off
   * ---------------------------------------------------------------- */
  function setRadio(on) {
    playing = on;
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    updateButton();

    if (on) {
      if (!ctx) initAudio();
      ctx.resume();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.5, t + 2); // gentle fade in
      nextPhraseAt = t + 0.3;
      chordIndex = Math.floor(Math.random() * mood.chords.length);
      clearTimeout(phraseTimer);
      schedulePhrase();
    } else if (ctx) {
      clearTimeout(phraseTimer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + 1);
      /* Fully suspend the audio engine once the fade-out is done, so an
         idle tab uses zero audio CPU. */
      setTimeout(() => { if (!playing && ctx) ctx.suspend(); }, 1200);
    }
  }

  function updateButton() {
    const btn = document.getElementById('music-toggle');
    if (!btn) return;
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.textContent = playing ? '♪ music on' : '♪ music off';
  }

  /* ---------------------------------------------------------------- *
   * Wiring it all up
   * ---------------------------------------------------------------- */
  function start() {
    /* Which mood does this page want? Set in <body data-music-mood>. */
    const name = document.body.dataset.musicMood || 'browse';
    if (name === 'solve') {
      mood = pick(SOLVE_VARIATIONS); // a random "thinking track" per visit
    } else {
      mood = MOODS[name] || MOODS.browse;
    }

    const btn = document.getElementById('music-toggle');
    if (!btn) return;
    btn.hidden = false;
    updateButton();
    btn.addEventListener('click', () => setRadio(!playing));

    /* If the radio was on last visit, resume it at the visitor's first
       interaction with the page (browsers block sound before a gesture). */
    if (localStorage.getItem(STORAGE_KEY) === 'on') {
      const resume = (e) => {
        /* If that first interaction is the toggle button itself, do
           nothing here — its own click handler decides what happens. */
        if (e.target === btn) return;
        if (!playing) setRadio(true);
      };
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    }

    /* Pause politely when the tab is hidden; pick up again on return. */
    document.addEventListener('visibilitychange', () => {
      if (!ctx || localStorage.getItem(STORAGE_KEY) !== 'on') return;
      if (document.hidden) {
        clearTimeout(phraseTimer);
        playing = false;
        ctx.suspend();
      } else if (!playing) {
        playing = true;
        ctx.resume();
        nextPhraseAt = ctx.currentTime + 0.3;
        schedulePhrase();
      }
    });

    /* Exolve fires this bubbling event when the grid is completely filled.
       If it isn't known to be wrong, celebrate (only when the radio is on —
       no surprise sounds for people who kept music off). */
    document.addEventListener('exolve', (e) => {
      if (playing && ctx && e.detail && !e.detail.knownIncorrect) {
        playJingle();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
