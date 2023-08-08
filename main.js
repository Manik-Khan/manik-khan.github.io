
// Create AudioContext and nodes
const audioCtx = new AudioContext();
const oscillator1 = audioCtx.createOscillator();
const oscillator2 = audioCtx.createOscillator();
const gainNode1 = audioCtx.createGain();
const gainNode2 = audioCtx.createGain();

// Connect nodes to AudioContext destination
oscillator1.connect(gainNode1).connect(audioCtx.destination);
oscillator2.connect(gainNode2).connect(audioCtx.destination);

// Set initial frequencies and gains
oscillator1.frequency.value = 440;
oscillator2.frequency.value = 440;
gainNode1.gain.value = 0;
gainNode2.gain.value = 0;

// Initialize oscillator state
let oscillator1Started = false;
let oscillator2Started = false;

// Create a random frequency for oscillator2
let randomFrequency = Math.floor(Math.random() * (880 - 440 + 1) + 440); // Generates a random number between 440 and 880 Hz
oscillator2.frequency.setValueAtTime(randomFrequency, audioCtx.currentTime);


function updateFrequencyDisplay() {
  const freq1 = oscillator1.frequency.value.toFixed(2);
  const freq2 = oscillator2.frequency.value.toFixed(2);
  freqDisplay1.textContent = `${getNoteName(freq1)} (${freq1} Hz)`;
  freqDisplay2.textContent = `${getNoteName(freq2)} (${freq2} Hz)`;
}

function getNoteName(frequency) {
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B"
  ];
  const n = Math.round(12 * (Math.log(frequency / 440) / Math.log(2)) + 69);
  const octave = Math.floor((n - 12) / 12);
  const noteName = noteNames[n % 12];
  return `${noteName}${octave}`;
}

function getNoteFromFrequency(freq) {
  const A4 = 440;
  const semitoneRatio = 2**(1/12);
  const noteNum = 12 * (Math.log2(freq / A4)) + 49;
  const noteNames = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
  const octave = Math.floor(noteNum / 12) - 1;
  const noteName = noteNames[noteNum % 12];
  return noteName + octave;
}


// Update canvas and oscillator frequency when knob is turned
range1.addEventListener("input", function() {
const freq1 = this.value * 10 + 220;
oscillator1.frequency.setValueAtTime(freq1, audioCtx.currentTime);
updateCanvas1();
});

range2.addEventListener("input", function() {
const freq2 = this.value * 10 + 220;
oscillator2.frequency.setValueAtTime(freq2, audioCtx.currentTime);
updateCanvas2();
});

// Play/pause oscillator when play button is clicked
play1.addEventListener("click", function() {
if (audioCtx.state === "suspended") {
audioCtx.resume();
}
if (this.textContent === "Play") {
this.textContent = "Pause";
gainNode1.gain.setValueAtTime(0.5, audioCtx.currentTime);
if (oscillator1.state !== "running") {
oscillator1.start();
}
} else {
this.textContent = "Play";
gainNode1.gain.setValueAtTime(0, audioCtx.currentTime);
if (oscillator1.state === "running") {
oscillator1.stop();
}
}
});

play2.addEventListener("click", function() {
if (audioCtx.state === "suspended") {
audioCtx.resume();
}
if (this.textContent === "Play") {
this.textContent = "Pause";
gainNode2.gain.setValueAtTime(0.5, audioCtx.currentTime);
if (oscillator2.state !== "running") {
oscillator2.start();
}
} else {
this.textContent = "Play";
gainNode2.gain.setValueAtTime(0, audioCtx.currentTime);
if (oscillator2.state === "running") {
oscillator2.stop();
}
}
});

// Update canvas when page is loaded
updateCanvas1();
updateCanvas2();

// Function to update canvas1
function updateCanvas1() {
  const canvas1 = document.getElementById("canvas1");
  const ctx1 = canvas1.getContext("2d");
  const width1 = canvas1.width;
  const height1 = canvas1.height;
  const freq1 = oscillator1.frequency.value;
  const maxAmp1 = 0.5;
  const x1 = 0;
  const y1 = height1 / 2;
  ctx1.clearRect(0, 0, width1, height1);
  ctx1.beginPath();
  ctx1.moveTo(x1, y1);
  for (let i = x1; i <= width1; i++) {
    const amp1 = maxAmp1 * Math.sin(2 * Math.PI * freq1 * (i / width1));
    const y1 = height1 / 2 - height1 / 2 * amp1;
    ctx1.lineTo(i, y1);
  }
  ctx1.strokeStyle = "blue";
  ctx1.lineWidth = 2;
  ctx1.stroke();

  // Update frequency display
  updateFrequencyDisplay();
}

// Function to update canvas2
function updateCanvas2() {
  const canvas2 = document.getElementById("canvas2");
  const ctx2 = canvas2.getContext("2d");
  const width2 = canvas2.width;
  const height2 = canvas2.height;
  const freq2 = oscillator2.frequency.value;
  const maxAmp2 = 0.5;
  const x2 = 0;
  const y2 = height2 / 2;
  ctx2.clearRect(0, 0, width2, height2);
  ctx2.beginPath();
  ctx2.moveTo(x2, y2);
  for (let i = x2; i <= width2; i++) {
    const amp2 = maxAmp2 * Math.sin(2 * Math.PI * freq2 * (i / width2));
    const y2 = height2 / 2 - height2 / 2 * amp2;
    ctx2.lineTo(i, y2);
  }
  ctx2.strokeStyle = "red";
  ctx2.lineWidth = 2;
  ctx2.stroke();

  // Update frequency display
  updateFrequencyDisplay();
}

const toggleButton = document.getElementById("toggle-button");
toggleButton.addEventListener("click", function() {
  if (freqDisplay1.textContent === "") {
    freqDisplay1.textContent = oscillator1.frequency.value.toFixed(2) + " Hz";
    freqDisplay2.textContent = oscillator2.frequency.value.toFixed(2) + " Hz";
  } else {
    freqDisplay1.textContent = "";
    freqDisplay2.textContent = "";
  }
});



// Add event listeners to waveform dropdowns
const waveform1 = document.getElementById("waveform1");
const waveform2 = document.getElementById("waveform2");

waveform1.addEventListener("change", function() {
  oscillator1.type = this.value;
});

waveform2.addEventListener("change", function() {
  oscillator2.type = this.value;
});

// Add event listeners to difficulty buttons
const easy = document.getElementById("easy");
const medium = document.getElementById("medium");
const hard = document.getElementById("hard");

easy.addEventListener("click", function() {
  toggleFrequencyDisplay(true);
  toggleCanvasDisplay(true);
});

medium.addEventListener("click", function() {
  toggleFrequencyDisplay(false);
  toggleCanvasDisplay(true);
});

hard.addEventListener("click", function() {
  toggleFrequencyDisplay(false);
  toggleCanvasDisplay(false);
});

// Utility functions to toggle frequency and canvas display
function toggleFrequencyDisplay(show) {
  if (show) {
    updateFrequencyDisplay();
  } else {
    freqDisplay1.textContent = "";
    freqDisplay2.textContent = "";
  }
}

function toggleCanvasDisplay(show) {
  canvas1.style.display = show ? "block" : "none";
  canvas2.style.display = show ? "block" : "none";
}
