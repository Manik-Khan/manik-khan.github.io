/* ── Audio context ───────────────────────────────────────────────────────── */
const AC = new (window.AudioContext || window.webkitAudioContext)();
const analyser = AC.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(AC.destination);

function resume() {
  if (AC.state === 'suspended') AC.resume();
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function noteFromHz(f) {
  const n = Math.round(12 * Math.log2(f / 440) + 69);
  const names = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
  const oct = Math.floor(n / 12) - 1;
  return names[((n % 12) + 12) % 12] + oct;
}

function applyFine(hz, cents) {
  return hz * Math.pow(2, cents / 1200);
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

/* ── Tuning definitions ──────────────────────────────────────────────────── */
const TUNINGS = {
  Pa: [
    { name: 'Pa',      ratio: 3 / 2 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa (low)',ratio: 0.5 },
  ],
  Ma: [
    { name: 'Ma#',     ratio: 45 / 32 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa (low)',ratio: 0.5 },
  ],
  Ni: [
    { name: 'Ni',      ratio: 15 / 8 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa',      ratio: 1 },
    { name: 'Sa (low)',ratio: 0.5 },
  ],
};

/* ── Difficulty config ───────────────────────────────────────────────────── */
// minCents / maxCents = how far off the student strings start
// showNote / showHz / showCents = what labels are visible
const DIFF = {
  beginner:     { minCents: 50,  maxCents: 100, showNote: true,  showHz: true,  showCents: true  },
  intermediate: { minCents: 150, maxCents: 300, showNote: true,  showHz: false, showCents: false },
  advanced:     { minCents: 300, maxCents: 600, showNote: false, showHz: false, showCents: false },
};

/* ── State ───────────────────────────────────────────────────────────────── */
let difficulty  = 'beginner';
let baseSaHz    = 261.63;
let fineCents   = 0;
let tuning      = 'Pa';

// Drone / reference
let dronePlaying   = false;
let droneSchedId   = null;
let droneNodes     = [];
let pulseTimeouts  = [];
const refOn        = [true, true, true, true];

// Practice oscillators
const pracOsc   = [null, null, null, null];
const pracGain  = [null, null, null, null];
const pracOn    = [false, false, false, false];
const pracCents = [0, 0, 0, 0];   // current cents offset from reference
const pracRange = [200, 200, 200, 200]; // slider ± range (adapts to diff)

/* ── Derived helpers ─────────────────────────────────────────────────────── */
function getSa()       { return applyFine(baseSaHz, fineCents); }
function getRefFreqs() { const sa = getSa(); return TUNINGS[tuning].map(s => sa * s.ratio); }

/* ── Difficulty ──────────────────────────────────────────────────────────── */
function setDifficulty(d) {
  difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === d)
  );
  rerandomize();
}

/* ── Randomize student starting positions ────────────────────────────────── */
function randomOffsetForDiff() {
  const cfg = DIFF[difficulty];
  const mag  = randBetween(cfg.minCents, cfg.maxCents);
  const sign = Math.random() < 0.5 ? 1 : -1;
  return Math.round(mag * sign);
}

function rerandomize() {
  [0, 1, 2, 3].forEach(i => {
    if (pracOn[i]) stopPrac(i);
    const offset   = randomOffsetForDiff();
    const range    = Math.max(Math.abs(offset) + 60, 160);
    pracRange[i]   = range;
    pracCents[i]   = offset;
  });
  buildPracGrid();
}

/* ── Setup change ────────────────────────────────────────────────────────── */
function onSetupChange() {
  baseSaHz  = parseFloat(document.getElementById('saCoarse').value);
  fineCents = parseInt(document.getElementById('saFine').value);
  tuning    = document.getElementById('tuningSelect').value;

  const actual = getSa();
  document.getElementById('saDisplay').textContent =
    noteFromHz(actual) + ' · ' + actual.toFixed(1) + ' Hz';
  const fc = fineCents;
  document.getElementById('saFineDisplay').textContent =
    (fc >= 0 ? '+' : '') + fc + ' cents';

  if (dronePlaying) stopDrone();
  [0, 1, 2, 3].forEach(i => { if (pracOn[i]) stopPrac(i); });
  buildRefGrid();
  rerandomize();
}

/* ── Build reference grid ────────────────────────────────────────────────── */
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

/* ── Build practice grid ─────────────────────────────────────────────────── */
function buildPracGrid() {
  const grid = document.getElementById('pracGrid');
  grid.innerHTML = '';
  const cfg   = DIFF[difficulty];
  const freqs = getRefFreqs();

  freqs.forEach((refHz, i) => {
    const yourHz = applyFine(refHz, pracCents[i]);
    const range  = pracRange[i];

    const card = document.createElement('div');
    card.className = 'prac-card';
    card.innerHTML = `
      <button class="tog-btn ${pracOn[i] ? 'on' : ''}" id="pracBtn${i}">${pracOn[i] ? 'On' : 'Off'}</button>
      <div class="p-note" id="pNote${i}">${cfg.showNote ? noteFromHz(yourHz) : '—'}</div>
      <div class="p-hz"   id="pHz${i}">${cfg.showHz ? yourHz.toFixed(1) + ' Hz' : ''}</div>
      <input type="range" class="prac-slider"
        min="${-range}" max="${range}" value="${pracCents[i]}" step="1" id="pSlider${i}">
      <div class="beat-mini"><div class="beat-fill" id="pBeat${i}"></div></div>
      <div class="beat-cents" id="pBeatVal${i}">${cfg.showCents ? pracCents[i] + ' ¢' : ''}</div>
      <div class="prac-badge" id="pBadge${i}"></div>
    `;
    grid.appendChild(card);

    card.querySelector(`#pracBtn${i}`).addEventListener('click', () => togglePrac(i));
    card.querySelector(`#pSlider${i}`).addEventListener('input', e => onPracSlider(i, e.target.value));

    updatePracCard(i);
  });
}

/* ── Update a practice card's meters and labels ──────────────────────────── */
function updatePracCard(i) {
  const cfg    = DIFF[difficulty];
  const refHz  = getRefFreqs()[i];
  const yourHz = applyFine(refHz, pracCents[i]);
  const abs    = Math.abs(pracCents[i]);

  const noteEl    = document.getElementById('pNote'   + i);
  const hzEl      = document.getElementById('pHz'     + i);
  const beatEl    = document.getElementById('pBeat'   + i);
  const beatValEl = document.getElementById('pBeatVal'+ i);
  const badgeEl   = document.getElementById('pBadge'  + i);

  if (noteEl)    noteEl.textContent    = cfg.showNote  ? noteFromHz(yourHz) : '—';
  if (hzEl)      hzEl.textContent      = cfg.showHz    ? yourHz.toFixed(1) + ' Hz' : '';
  if (beatValEl) beatValEl.textContent = cfg.showCents
    ? (pracCents[i] >= 0 ? '+' : '') + pracCents[i] + ' ¢' : '';

  if (beatEl) {
    const pct = Math.min(abs / pracRange[i], 1) * 100;
    beatEl.style.width      = pct + '%';
    beatEl.style.background = abs < 5  ? 'var(--green)'
                            : abs < 20 ? 'var(--amber)'
                            :            'var(--red)';
  }

  if (badgeEl) {
    if      (abs < 5)  { badgeEl.textContent = 'In tune'; badgeEl.className = 'prac-badge in-tune'; }
    else if (abs < 20) { badgeEl.textContent = 'Close';   badgeEl.className = 'prac-badge close';   }
    else               { badgeEl.textContent = '';         badgeEl.className = 'prac-badge';          }
  }

  if (pracOsc[i]) pracOsc[i].frequency.value = yourHz;
}

/* ── Practice oscillators ────────────────────────────────────────────────── */
function togglePrac(i) {
  resume();
  pracOn[i] ? stopPrac(i) : startPrac(i);
}

function startPrac(i) {
  if (pracOn[i]) return;
  const refHz  = getRefFreqs()[i];
  const yourHz = applyFine(refHz, pracCents[i]);

  const osc = AC.createOscillator();
  const g   = AC.createGain();
  osc.type           = 'triangle';
  osc.frequency.value = yourHz;
  g.gain.value        = 0;
  osc.connect(g);
  g.connect(analyser);
  osc.start();
  g.gain.setTargetAtTime(0.3, AC.currentTime, 0.04);

  pracOsc[i]  = osc;
  pracGain[i] = g;
  pracOn[i]   = true;

  const btn = document.getElementById('pracBtn' + i);
  if (btn) { btn.textContent = 'On'; btn.className = 'tog-btn on'; }
}

function stopPrac(i) {
  if (!pracOn[i]) return;
  pracGain[i].gain.setTargetAtTime(0, AC.currentTime, 0.04);
  const o = pracOsc[i];
  setTimeout(() => { try { o.stop(); } catch (e) {} }, 300);
  pracOsc[i]  = null;
  pracGain[i] = null;
  pracOn[i]   = false;

  const btn = document.getElementById('pracBtn' + i);
  if (btn) { btn.textContent = 'Off'; btn.className = 'tog-btn'; }
}

function onPracSlider(i, v) {
  pracCents[i] = parseInt(v);
  updatePracCard(i);
}

/* ── Reference toggles ───────────────────────────────────────────────────── */
function toggleRef(i) {
  refOn[i] = !refOn[i];
  const btn = document.getElementById('refBtn' + i);
  if (btn) {
    btn.textContent = refOn[i] ? 'On' : 'Off';
    btn.className   = 'tog-btn' + (refOn[i] ? ' on' : '');
  }
}

function allRefOn() {
  [0, 1, 2, 3].forEach(i => {
    refOn[i] = true;
    const b = document.getElementById('refBtn' + i);
    if (b) { b.textContent = 'On'; b.className = 'tog-btn on'; }
  });
}

function allRefOff() {
  [0, 1, 2, 3].forEach(i => {
    refOn[i] = false;
    const b = document.getElementById('refBtn' + i);
    if (b) { b.textContent = 'Off'; b.className = 'tog-btn'; }
  });
}

function allPracOn()  { [0, 1, 2, 3].forEach(i => { if (!pracOn[i]) startPrac(i); }); }
function allPracOff() { [0, 1, 2, 3].forEach(i => { if  (pracOn[i]) stopPrac(i);  }); }

/* ── Drone engine ────────────────────────────────────────────────────────── */
// Each string plucked in sequence with an envelope: attack → sustain → decay
const OFFSETS   = [0, 1.1, 2.2, 3.5];  // seconds within cycle
const CYCLE_LEN = 6.0;                  // full cycle length in seconds
const ATK       = 0.04;                 // attack time
const SPEAK     = 0.28;                 // peak gain
const SLEN      = 0.9;                  // sustain length
const DEC       = 1.3;                  // decay time

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
  scheduleCycle(AC.currentTime + 0.05);
  startAnim();
}

function scheduleCycle(t0) {
  if (!dronePlaying) return;
  const freqs = getRefFreqs();

  OFFSETS.forEach((off, i) => {
    if (!refOn[i]) return;

    const t   = t0 + off;
    const osc = AC.createOscillator();
    const g   = AC.createGain();
    osc.type           = 'triangle';
    osc.frequency.value = freqs[i];

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(SPEAK, t + ATK);
    g.gain.setValueAtTime(SPEAK, t + ATK + SLEN);
    g.gain.exponentialRampToValueAtTime(0.001, t + ATK + SLEN + DEC);

    osc.connect(g);
    g.connect(analyser);
    osc.start(t);
    osc.stop(t + ATK + SLEN + DEC + 0.15);
    droneNodes.push({ osc, g });

    // visual pulse
    const delay = Math.max(0, (t - AC.currentTime) * 1000);
    const tid = setTimeout(() => {
      const el = document.getElementById('pulse' + i);
      if (el) {
        el.classList.add('lit');
        setTimeout(() => el.classList.remove('lit'), 280);
      }
    }, delay);
    pulseTimeouts.push(tid);
  });

  // schedule next cycle slightly before this one ends
  const nextStart = t0 + CYCLE_LEN;
  const msUntil   = (nextStart - 0.4 - AC.currentTime) * 1000;
  droneSchedId = setTimeout(() => scheduleCycle(nextStart), Math.max(0, msUntil));
}

function stopDrone() {
  dronePlaying = false;
  clearTimeout(droneSchedId);
  pulseTimeouts.forEach(clearTimeout);
  pulseTimeouts = [];

  droneNodes.forEach(({ g, osc }) => {
    try {
      g.gain.setTargetAtTime(0, AC.currentTime, 0.06);
      osc.stop(AC.currentTime + 0.35);
    } catch (e) {}
  });
  droneNodes = [];

  const btn = document.getElementById('droneBtn');
  btn.querySelector('.drone-icon').textContent = '▶';
  btn.querySelector('.drone-text').textContent = 'Start Drone';
  btn.classList.remove('playing');

  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById('pulse' + i);
    if (el) el.classList.remove('lit');
  });
}

/* ── Waveform animation ──────────────────────────────────────────────────── */
let animId = null;

function startAnim() {
  if (animId) cancelAnimationFrame(animId);
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');

  function draw() {
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
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

    // warm amber waveform line
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.65)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    animId = requestAnimationFrame(draw);
  }

  draw();
}

/* ── Wire up static controls ─────────────────────────────────────────────── */
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

/* ── Init ────────────────────────────────────────────────────────────────── */
buildRefGrid();
rerandomize();   // also calls buildPracGrid
startAnim();
