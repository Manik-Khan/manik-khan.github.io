/* ═══════════════════════════════════════════════════════════════════════════
   Shruti — Tanpura Tuning Trainer  |  main.js
═══════════════════════════════════════════════════════════════════════════ */

/* ── Audio context ─────────────────────────────────────────────────────── */
const AC = new (window.AudioContext || window.webkitAudioContext)();
const analyser = AC.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(AC.destination);
function resume() { if (AC.state === 'suspended') AC.resume(); }

/* ── Helpers ───────────────────────────────────────────────────────────── */
function noteFromHz(f) {
  const n = Math.round(12 * Math.log2(f / 440) + 69);
  const names = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
  const oct = Math.floor(n / 12) - 1;
  return names[((n % 12) + 12) % 12] + oct;
}
function applyFine(hz, cents) { return hz * Math.pow(2, cents / 1200); }
function randBetween(a, b)    { return a + Math.random() * (b - a); }
function randInt(a, b)        { return Math.floor(randBetween(a, b + 1)); }

/* ── Tuning definitions ────────────────────────────────────────────────── */
// Pa, Ma#, Ni are the lower octave (ratio < 1 relative to Sa)
const TUNINGS = {
  Pa: [
    { name: 'Pa',       ratio: 3 / 4   },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa (low)', ratio: 0.5     },
  ],
  Ma: [
    { name: 'Ma#',      ratio: 45 / 64 },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa (low)', ratio: 0.5     },
  ],
  Ni: [
    { name: 'Ni',       ratio: 15 / 16 },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa',       ratio: 1       },
    { name: 'Sa (low)', ratio: 0.5     },
  ],
};

/* ── Difficulty config ─────────────────────────────────────────────────── */
// halfRange: total slider range in cents on each side of the TARGET
//   (target lands at a random position within the slider, never at center)
// startMaxOffset: how far from target the slider can start (in cents)
const DIFF = {
  beginner:     { halfRange: 150, startMinOffset: 40,  startMaxOffset: 100, showNote: true,  showHz: true,  showCents: true,  liveStatus: true  },
  intermediate: { halfRange: 250, startMinOffset: 100, startMaxOffset: 220, showNote: true,  showHz: false, showCents: false, liveStatus: true  },
  advanced:     { halfRange: 400, startMinOffset: 200, startMaxOffset: 380, showNote: false, showHz: false, showCents: false, liveStatus: false },
};

/* ── Drone envelope constants ──────────────────────────────────────────── */
const OFFSETS    = [0, 1.1, 2.2, 3.5];
const CYCLE_LEN  = 6.0;
const ATK        = 0.04;
const SPEAK      = 0.28;
const SLEN_SOLO  = 2.8;
const SLEN_MULTI = 0.9;
const DEC_SOLO   = 1.8;
const DEC_MULTI  = 1.3;

/* ── State ─────────────────────────────────────────────────────────────── */
let difficulty = 'beginner';
let baseSaHz   = 261.63;
let fineCents  = 0;
let tuning     = 'Pa';

let dronePlaying  = false;
let droneSchedId  = null;
let droneNodes    = [];
let pulseTimeouts = [];
const refOn       = [true, true, true, true];

const pracOsc   = [null, null, null, null];
const pracGain  = [null, null, null, null];
const pracOn    = [false, false, false, false];

// Per-string slider setup — randomized each round
// sliderMin/Max: absolute Hz bounds of the slider
// targetHz: the correct in-tune frequency (somewhere inside the slider range)
// currentHz: what the slider is currently set to
const stringState = [0,1,2,3].map(() => ({
  sliderMin:  200,
  sliderMax:  500,
  targetHz:   440,
  currentHz:  440,
}));

const sliderTouched = [false, false, false, false];

// Shruti lives (advanced)
let shrutiLives = 3;

let animId = null;

/* ── Derived ───────────────────────────────────────────────────────────── */
function getSa()       { return applyFine(baseSaHz, fineCents); }
function getRefFreqs() { return TUNINGS[tuning].map(s => getSa() * s.ratio); }
function activeRefCount() { return refOn.filter(Boolean).length; }

/* ── Difficulty ────────────────────────────────────────────────────────── */
function setDifficulty(d) {
  difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === d)
  );
  if (d === 'advanced') {
    shrutiLives = 3;
    updateLivesDisplay();
  }
  document.getElementById('livesRow').style.display = d === 'advanced' ? 'flex' : 'none';
  rerandomize();
}

/* ── Lives ─────────────────────────────────────────────────────────────── */
function updateLivesDisplay() {
  const el = document.getElementById('shrutiLives');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += `<span class="shruti-dot ${i < shrutiLives ? 'alive' : 'lost'}">◉</span>`;
  }
  el.innerHTML = html;
}

/* ── Randomize ─────────────────────────────────────────────────────────── */
function rerandomize() {
  const cfg   = DIFF[difficulty];
  const freqs = getRefFreqs();

  [0,1,2,3].forEach(i => {
    if (pracOn[i]) stopPrac(i);
    sliderTouched[i] = false;

    const targetHz = freqs[i];

    // Place target at a random position within the slider, not at center.
    // targetOffset is how far (in cents) the target sits from slider center.
    // We ensure the target is never within 30 cents of either end.
    const margin = 30; // cents from edge
    const usableRange = cfg.halfRange - margin;
    const targetOffsetCents = randBetween(-usableRange, usableRange);

    // Slider absolute Hz bounds
    const sliderMin = applyFine(targetHz, -cfg.halfRange - targetOffsetCents);
    const sliderMax = applyFine(targetHz,  cfg.halfRange - targetOffsetCents);

    // Starting position: offset from target by startMinOffset..startMaxOffset cents
    // in a random direction, but clamped so slider value stays within range
    const startOffsetMag  = randBetween(cfg.startMinOffset, cfg.startMaxOffset);
    const startOffsetSign = Math.random() < 0.5 ? 1 : -1;
    let   startOffsetCents = startOffsetMag * startOffsetSign;

    // Clamp: start must be within slider range
    const targetPosInSlider = (targetHz - sliderMin) / (sliderMax - sliderMin); // 0..1
    const startHz_unclamped = applyFine(targetHz, startOffsetCents);
    const startHz = Math.max(sliderMin * 1.001, Math.min(sliderMax * 0.999, startHz_unclamped));

    stringState[i] = { sliderMin, sliderMax, targetHz, currentHz: startHz };
  });

  buildPracGrid();
}

/* ── Setup ─────────────────────────────────────────────────────────────── */
function onSetupChange() {
  baseSaHz  = parseFloat(document.getElementById('saCoarse').value);
  fineCents = parseInt(document.getElementById('saFine').value);
  tuning    = document.getElementById('tuningSelect').value;

  const actual = getSa();
  document.getElementById('saDisplay').textContent =
    noteFromHz(actual) + ' · ' + actual.toFixed(1) + ' Hz';
  document.getElementById('saFineDisplay').textContent =
    (fineCents >= 0 ? '+' : '') + fineCents + ' cents';

  if (dronePlaying) stopDrone();
  [0,1,2,3].forEach(i => { if (pracOn[i]) stopPrac(i); });
  buildRefGrid();
  rerandomize();
}

/* ── sliderValue <-> Hz conversion ────────────────────────────────────── */
// Slider runs 0..1000 (integer steps for smooth movement)
const SLIDER_STEPS = 1000;

function hzToSlider(hz, min, max) {
  // Use logarithmic mapping so steps feel even across the range
  return Math.round((Math.log(hz / min) / Math.log(max / min)) * SLIDER_STEPS);
}

function sliderToHz(val, min, max) {
  return min * Math.pow(max / min, val / SLIDER_STEPS);
}

/* ── Build reference grid ──────────────────────────────────────────────── */
function buildRefGrid() {
  const grid  = document.getElementById('refGrid');
  grid.innerHTML = '';
  const freqs = getRefFreqs();

  freqs.forEach((hz, i) => {
    const name = TUNINGS[tuning][i].name;
    const card = document.createElement('div');
    card.className = 'ref-card';
    card.innerHTML = `
      <div class="pulse-dot" id="pulse${i}"></div>
      <div class="s-name">${name}</div>
      <div class="s-meta">${noteFromHz(hz)}</div>
      <div class="s-meta">${hz.toFixed(1)} Hz</div>
      <button class="tog-btn on" id="refBtn${i}">On</button>
    `;
    grid.appendChild(card);
    card.querySelector(`#refBtn${i}`).addEventListener('click', () => toggleRef(i));
  });
}

/* ── Build practice grid ───────────────────────────────────────────────── */
function buildPracGrid() {
  const grid  = document.getElementById('pracGrid');
  grid.innerHTML = '';
  const cfg   = DIFF[difficulty];
  const isAdv = difficulty === 'advanced';

  [0,1,2,3].forEach(i => {
    const { sliderMin, sliderMax, targetHz, currentHz } = stringState[i];
    const sliderVal = hzToSlider(currentHz, sliderMin, sliderMax);

    const card = document.createElement('div');
    card.className = 'prac-card';
    card.innerHTML = `
      <button class="tog-btn ${pracOn[i] ? 'on' : ''}" id="pracBtn${i}">${pracOn[i] ? 'On' : 'Off'}</button>
      <div class="p-note" id="pNote${i}">${cfg.showNote ? noteFromHz(currentHz) : '—'}</div>
      <div class="p-hz"   id="pHz${i}">${cfg.showHz ? currentHz.toFixed(1) + ' Hz' : ''}</div>
      <input type="range" class="prac-slider"
        min="0" max="${SLIDER_STEPS}" value="${sliderVal}" step="1" id="pSlider${i}">
      <div class="beat-mini"><div class="beat-fill" id="pBeat${i}"></div></div>
      <div class="beat-cents" id="pBeatVal${i}"></div>
      ${isAdv
        ? `<button class="check-btn" id="checkBtn${i}" disabled>Check</button>`
        : ''
      }
      <div class="prac-badge" id="pBadge${i}"></div>
    `;
    grid.appendChild(card);

    card.querySelector(`#pracBtn${i}`).addEventListener('click', () => togglePrac(i));
    card.querySelector(`#pSlider${i}`).addEventListener('input', e => onPracSlider(i, e.target.value));
    if (isAdv) {
      card.querySelector(`#checkBtn${i}`).addEventListener('click', () => checkTuning(i));
    }

    updatePracCard(i);
  });
}

/* ── Update practice card ──────────────────────────────────────────────── */
function updatePracCard(i) {
  const cfg    = DIFF[difficulty];
  const { sliderMin, sliderMax, targetHz, currentHz } = stringState[i];
  const isAdv  = difficulty === 'advanced';

  // Cents difference from target (for meters)
  const centsDiff = 1200 * Math.log2(currentHz / targetHz);
  const absCents  = Math.abs(centsDiff);

  const noteEl    = document.getElementById('pNote'    + i);
  const hzEl      = document.getElementById('pHz'      + i);
  const beatEl    = document.getElementById('pBeat'    + i);
  const beatValEl = document.getElementById('pBeatVal' + i);
  const badgeEl   = document.getElementById('pBadge'   + i);
  const checkBtn  = document.getElementById('checkBtn' + i);

  if (noteEl) noteEl.textContent = cfg.showNote ? noteFromHz(currentHz) : '—';
  if (hzEl)   hzEl.textContent   = cfg.showHz   ? currentHz.toFixed(1) + ' Hz' : '';

  // Beat meter — always shown (reflects what you hear)
  if (beatEl) {
    const maxCents = DIFF[difficulty].halfRange;
    const pct = Math.min(absCents / maxCents, 1) * 100;
    beatEl.style.width      = pct + '%';
    beatEl.style.background = absCents < 5  ? 'var(--green)'
                            : absCents < 20 ? 'var(--amber)'
                            :                 'var(--red)';
  }

  // Cents readout (beginner only)
  if (beatValEl) {
    beatValEl.textContent = cfg.showCents
      ? (centsDiff >= 0 ? '+' : '') + Math.round(centsDiff) + ' ¢'
      : '';
  }

  // Live status badge (beginner + intermediate)
  if (badgeEl && !isAdv) {
    if      (absCents < 5)  { badgeEl.textContent = 'In tune'; badgeEl.className = 'prac-badge in-tune'; }
    else if (absCents < 20) { badgeEl.textContent = 'Close';   badgeEl.className = 'prac-badge close';   }
    else                    { badgeEl.textContent = '';         badgeEl.className = 'prac-badge';          }
  }

  // Check button enabled only after slider is touched
  if (checkBtn) checkBtn.disabled = !sliderTouched[i];

  // Update live oscillator
  if (pracOsc[i]) pracOsc[i].frequency.value = currentHz;
}

/* ── Check tuning (advanced) ───────────────────────────────────────────── */
function checkTuning(i) {
  if (!sliderTouched[i]) return;
  const { targetHz, currentHz } = stringState[i];
  const absCents = Math.abs(1200 * Math.log2(currentHz / targetHz));
  const isGood   = absCents < 5;
  const badgeEl  = document.getElementById('pBadge' + i);

  if (badgeEl) {
    if (isGood) {
      badgeEl.textContent = 'In tune ✓'; badgeEl.className = 'prac-badge in-tune';
      shrutiLives = Math.min(3, shrutiLives + 1);
    } else {
      badgeEl.textContent = absCents < 20 ? 'Not quite ✗' : 'Off ✗';
      badgeEl.className   = 'prac-badge wrong';
      shrutiLives = Math.max(0, shrutiLives - 1);
    }
  }

  updateLivesDisplay();

  const checkBtn = document.getElementById('checkBtn' + i);
  if (checkBtn) { checkBtn.disabled = true; sliderTouched[i] = false; }

  setTimeout(() => {
    if (badgeEl) { badgeEl.textContent = ''; badgeEl.className = 'prac-badge'; }
  }, 2500);
}

/* ── Practice oscillators ──────────────────────────────────────────────── */
function togglePrac(i) {
  resume();
  pracOn[i] ? stopPrac(i) : startPrac(i);
}

function startPrac(i) {
  if (pracOn[i]) return;
  const osc = AC.createOscillator();
  const g   = AC.createGain();
  osc.type            = 'triangle';
  osc.frequency.value = stringState[i].currentHz;
  g.gain.value        = 0;
  osc.connect(g); g.connect(analyser); osc.start();
  g.gain.setTargetAtTime(0.3, AC.currentTime, 0.04);
  pracOsc[i] = osc; pracGain[i] = g; pracOn[i] = true;
  const btn = document.getElementById('pracBtn' + i);
  if (btn) { btn.textContent = 'On'; btn.className = 'tog-btn on'; }
}

function stopPrac(i) {
  if (!pracOn[i]) return;
  pracGain[i].gain.setTargetAtTime(0, AC.currentTime, 0.04);
  const o = pracOsc[i];
  setTimeout(() => { try { o.stop(); } catch(e) {} }, 300);
  pracOsc[i] = null; pracGain[i] = null; pracOn[i] = false;
  const btn = document.getElementById('pracBtn' + i);
  if (btn) { btn.textContent = 'Off'; btn.className = 'tog-btn'; }
}

function onPracSlider(i, v) {
  const { sliderMin, sliderMax } = stringState[i];
  stringState[i].currentHz = sliderToHz(parseInt(v), sliderMin, sliderMax);
  sliderTouched[i] = true;

  // Clear previous check result when student moves slider again
  const badgeEl = document.getElementById('pBadge' + i);
  if (badgeEl && difficulty === 'advanced') {
    badgeEl.textContent = ''; badgeEl.className = 'prac-badge';
  }

  updatePracCard(i);
}

/* ── Reference toggles ─────────────────────────────────────────────────── */
function toggleRef(i) {
  refOn[i] = !refOn[i];
  const btn = document.getElementById('refBtn' + i);
  if (btn) { btn.textContent = refOn[i] ? 'On' : 'Off'; btn.className = 'tog-btn' + (refOn[i] ? ' on' : ''); }
}

function allRefOn() {
  [0,1,2,3].forEach(i => {
    refOn[i] = true;
    const b = document.getElementById('refBtn' + i);
    if (b) { b.textContent = 'On'; b.className = 'tog-btn on'; }
  });
}

function allRefOff() {
  [0,1,2,3].forEach(i => {
    refOn[i] = false;
    const b = document.getElementById('refBtn' + i);
    if (b) { b.textContent = 'Off'; b.className = 'tog-btn'; }
  });
}

function allPracOn()  { [0,1,2,3].forEach(i => { if (!pracOn[i]) startPrac(i); }); }
function allPracOff() { [0,1,2,3].forEach(i => { if  (pracOn[i]) stopPrac(i);  }); }

/* ── Drone engine ──────────────────────────────────────────────────────── */
function toggleDrone() {
  resume();
  dronePlaying ? stopDrone() : startDrone();
}

function startDrone() {
  dronePlaying = true;
  const btn = document.getElementById('droneBtn');
  btn.querySelector('.drone-icon').textContent = '⏹';
  btn.querySelector('.drone-text').textContent = 'Stop Drone';
  btn.classList.add('playing');
  document.getElementById('waveLabel').classList.add('hidden');
  scheduleCycle(AC.currentTime + 0.05);
  startAnim();
}

function scheduleCycle(t0) {
  if (!dronePlaying) return;
  const freqs  = getRefFreqs();
  const active = activeRefCount();
  const sLen   = active <= 1 ? SLEN_SOLO  : SLEN_MULTI;
  const dec    = active <= 1 ? DEC_SOLO   : DEC_MULTI;

  OFFSETS.forEach((off, i) => {
    if (!refOn[i]) return;
    const t   = t0 + off;
    const osc = AC.createOscillator();
    const g   = AC.createGain();
    osc.type            = 'triangle';
    osc.frequency.value = freqs[i];

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(SPEAK, t + ATK);
    g.gain.setValueAtTime(SPEAK, t + ATK + sLen);
    g.gain.exponentialRampToValueAtTime(0.001, t + ATK + sLen + dec);

    osc.connect(g); g.connect(analyser);
    osc.start(t); osc.stop(t + ATK + sLen + dec + 0.15);
    droneNodes.push({ osc, g });

    const delay = Math.max(0, (t - AC.currentTime) * 1000);
    const tid = setTimeout(() => {
      const el = document.getElementById('pulse' + i);
      if (el) { el.classList.add('lit'); setTimeout(() => el.classList.remove('lit'), 280); }
    }, delay);
    pulseTimeouts.push(tid);
  });

  const nextStart = t0 + CYCLE_LEN;
  droneSchedId = setTimeout(() => scheduleCycle(nextStart),
    Math.max(0, (nextStart - 0.4 - AC.currentTime) * 1000));
}

function stopDrone() {
  dronePlaying = false;
  clearTimeout(droneSchedId);
  pulseTimeouts.forEach(clearTimeout); pulseTimeouts = [];
  droneNodes.forEach(({ g, osc }) => {
    try { g.gain.setTargetAtTime(0, AC.currentTime, 0.06); osc.stop(AC.currentTime + 0.35); } catch(e) {}
  });
  droneNodes = [];
  const btn = document.getElementById('droneBtn');
  btn.querySelector('.drone-icon').textContent = '▶';
  btn.querySelector('.drone-text').textContent = 'Start Drone';
  btn.classList.remove('playing');
  [0,1,2,3].forEach(i => { const el = document.getElementById('pulse'+i); if(el) el.classList.remove('lit'); });
}

/* ── Waveform ──────────────────────────────────────────────────────────── */
function startAnim() {
  if (animId) cancelAnimationFrame(animId);
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  function draw() {
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    if (canvas.width  !== W) canvas.width  = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const buf  = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const step = Math.max(1, Math.floor(buf.length / W));
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const v = buf[x * step] || 0;
      const y = H / 2 - v * H * 0.4;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(201,168,76,0.65)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    animId = requestAnimationFrame(draw);
  }
  draw();
}

/* ── Wire up static controls ───────────────────────────────────────────── */
document.getElementById('saCoarse').addEventListener('input', onSetupChange);
document.getElementById('saFine').addEventListener('input', onSetupChange);
document.getElementById('tuningSelect').addEventListener('change', onSetupChange);
document.getElementById('droneBtn').addEventListener('click', toggleDrone);
document.getElementById('rerandomBtn').addEventListener('click', rerandomize);
document.getElementById('allRefOn').addEventListener('click', allRefOn);
document.getElementById('allRefOff').addEventListener('click', allRefOff);
document.getElementById('allPracOn').addEventListener('click', allPracOn);
document.getElementById('allPracOff').addEventListener('click', allPracOff);
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
});

/* ── Init ──────────────────────────────────────────────────────────────── */
buildRefGrid();
rerandomize();
startAnim();
