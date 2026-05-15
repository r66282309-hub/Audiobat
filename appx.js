// Audiobat Web - application logic
(() => {
  const fileInput = document.getElementById('fileInput');
  const playBtn = document.getElementById('playBtn');
  const stopBtn = document.getElementById('stopBtn');
  const loopBtn = document.getElementById('loopBtn');
  const clearSelBtn = document.getElementById('clearSelBtn');
  const autoIdBtn = document.getElementById('autoIdBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const autoIdResults = document.getElementById('autoIdResults');
  const gainSlider = document.getElementById('gainSlider');
  const contrastSlider = document.getElementById('contrastSlider');
  const paletteSelect = document.getElementById('paletteSelect');
  const highPassInput = document.getElementById('highPassInput');
  const highPassValue = document.getElementById('highPassValue');
  const sensitivitySlider = document.getElementById('sensitivitySlider');
  const showCallNumbers = document.getElementById('showCallNumbers');
  const statusEl = document.getElementById('status');
  const specCanvas = document.getElementById('spectrogram');
  const specCtx = specCanvas.getContext('2d');
  const zoomCanvas = document.getElementById('zoomSpectrogram');
  const zoomCtx = zoomCanvas.getContext('2d');
  const segmentCanvas = document.getElementById('segmentedSpectrogram');
  const segmentCtx = segmentCanvas.getContext('2d');

  let audioCtx = null;
  let gainNode = null;
  let sourceNode = null;
  let playStartAudioTime = 0;
  let playStartOriginalTime = 0;
  let animationId = null;

  let fileName = '';
  let samples = null;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let duration = 0;
  let playbackRate = 0.1;
  let playbackSampleRate = 0;

  let spectrogramCols = [];
  let fftSize = 2048;
  let hopSize = 512;
  let maxFreqDisplay = 160000;

  let cursorTime = 0;
  let selStart = null;
  let selEnd = null;
  let isSelecting = false;
  let dragStartTime = 0;
  let loop = false;
  let lastAutoIdResults = null;
  let trainingExamples = [];
  let trainingLoaded = false;

  const SUPABASE_URL = 'https://wbmdusjmsblxhkhqnaiy.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndibWR1c2ptc2JseGhraHFuYWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTc4NDIsImV4cCI6MjA5NDQzMzg0Mn0.0t1Qdl6xxgx9TrcAKSO95oTq9Gi3MBNtLviSEb5RCto';
  const TRAINING_TABLE = 'bat_training_examples';
  const correctionLabels = [
    '',
    'Confermo suggerimento',
    'Pipistrellus pipistrellus-like',
    'Pipistrellus pygmaeus-like',
    'Pipistrellus kuhlii / nathusii-like',
    'Hypsugo savii-like',
    'Eptesicus / Nyctalus-like',
    'Miniopterus schreibersii-like',
    'Myotis-like',
    'Rhinolophus ferrumequinum-like',
    'Rhinolophus hipposideros-like',
    'Human / bird / noise-like',
    'Non classificabile'
  ];

  // Profili morfo-acustici europei semplificati.
  // Non è un vero database: serve a ordinare i candidati più plausibili per gruppi/specie comuni.
  const europeanBatProfiles = [
    { label: 'Pipistrellus pipistrellus-like', group: 'Pipistrellus', peak:[42,49], dur:[3,13], bw:[4,28], note:'Picco tipico attorno a 45 kHz; forte sovrapposizione con altri Pipistrellus.' },
    { label: 'Pipistrellus pygmaeus-like', group: 'Pipistrellus', peak:[52,60], dur:[3,12], bw:[4,30], note:'Picco alto, spesso vicino a 55 kHz; verificare habitat e sequenza.' },
    { label: 'Pipistrellus kuhlii / nathusii-like', group: 'Pipistrellus basso', peak:[34,42], dur:[4,18], bw:[3,25], note:'Gruppo a frequenza più bassa; P. kuhlii e P. nathusii possono sovrapporsi.' },
    { label: 'Hypsugo savii-like', group: 'Hypsugo', peak:[30,38], dur:[5,20], bw:[3,22], note:'Compatibile con frequenze medio-basse; attenzione alla sovrapposizione con Pipistrellus kuhlii.' },
    { label: 'Eptesicus / Nyctalus-like', group: 'Open-space basso', peak:[18,32], dur:[8,35], bw:[1,16], note:'Chiamate più basse e spesso più strette; gruppo da verificare manualmente.' },
    { label: 'Miniopterus schreibersii-like', group: 'Miniopterus', peak:[48,57], dur:[4,12], bw:[12,45], note:'FM piuttosto ampia con picco alto; può confondersi con Pipistrellus alto.' },
    { label: 'Myotis-like', group: 'Myotis', peak:[38,95], dur:[2,10], bw:[25,90], note:'FM ampia e ripida; di solito meglio fermarsi al gruppo Myotis.' },
    { label: 'Rhinolophus ferrumequinum-like', group: 'Rhinolophus CF basso', peak:[76,86], dur:[18,80], bw:[0,8], note:'Componente quasi costante; controllare se la traccia è orizzontale.' },
    { label: 'Rhinolophus hipposideros-like', group: 'Rhinolophus CF alto', peak:[105,115], dur:[18,80], bw:[0,8], note:'CF alta; richiede file pulito e campionamento adeguato.' }
  ];

  function setStatus(extra = '') {
    if (!samples) {
      statusEl.innerHTML = '<div><b>File:</b> nessun file caricato</div>';
      return;
    }
    const selText = hasSelection()
      ? `${fmtTime(selectionMin())} – ${fmtTime(selectionMax())} (${fmtTime(selectionMax() - selectionMin())})`
      : 'nessuna';
    statusEl.innerHTML = `
      <div><b>File:</b> ${escapeHtml(fileName)}</div>
      <div><b>Formato:</b> ${channels} canale/i, ${bitDepth} bit, ${sampleRate.toLocaleString('it-IT')} Hz</div>
      <div><b>Durata originale:</b> ${fmtTime(duration)}</div>
      <div><b>Playback:</b> ${(sampleRate/10).toLocaleString('it-IT')} Hz apparenti, 10× più lento</div>
      <div><b>Cursore:</b> ${fmtTime(cursorTime)}</div>
      <div><b>Selezione:</b> ${selText}</div>
      ${extra ? `<div><b>Stato:</b> ${extra}</div>` : ''}
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function fmtTime(t) {
    if (!isFinite(t)) return '—';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function hasSelection() {
    return selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.005;
  }
  function selectionMin() { return Math.max(0, Math.min(selStart, selEnd)); }
  function selectionMax() { return Math.min(duration, Math.max(selStart, selEnd)); }

  function parseHighPassKhz(rawValue) {
    const raw = String(rawValue ?? '').trim().replace(',', '.');
    if (!raw) return 0;
    const n = Number(raw);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(160, n));
  }

  function formatKhzValue(khz) {
    return khz.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function getHighPassHz() {
    return parseHighPassKhz(highPassInput ? highPassInput.value : 0) * 1000;
  }

  function normalizeHighPassInput() {
    if (!highPassInput) return 0;
    const khz = parseHighPassKhz(highPassInput.value);
    highPassInput.value = formatKhzValue(khz);
    return khz;
  }

  function updateHighPassLabel(normalizeField = false) {
    if (!highPassValue) return;
    const khz = normalizeField ? normalizeHighPassInput() : parseHighPassKhz(highPassInput ? highPassInput.value : 0);
    highPassValue.textContent = khz === 0 ? 'OFF' : `${formatKhzValue(khz)} kHz`;
  }

  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    fileName = f.name;
    setStatus('lettura file...');
    const buf = await f.arrayBuffer();
    try {
      const wav = parseWav(buf);
      samples = wav.channelData[0];
      sampleRate = wav.sampleRate;
      channels = wav.channels;
      bitDepth = wav.bitDepth;
      duration = samples.length / sampleRate;
      playbackSampleRate = sampleRate / 10;
      cursorTime = 0;
      selStart = selEnd = null;
      lastAutoIdResults = null;
      maxFreqDisplay = Math.min(sampleRate / 2, 160000);
      stopPlayback();
      playBtn.disabled = false;
      stopBtn.disabled = false;
      loopBtn.disabled = false;
      clearSelBtn.disabled = false;
      autoIdBtn.disabled = false;
      exportCsvBtn.disabled = false;
      setStatus('calcolo spettrogramma...');
      await new Promise(r => setTimeout(r, 20));
      computeSpectrogram();
      drawAll();
      setStatus('pronto');
      loadTrainingExamples().catch(err => console.warn('Training non caricato', err));
    } catch (err) {
      console.error(err);
      alert('Errore apertura WAV: ' + err.message);
      samples = null;
      setStatus('errore');
    }
  });

  playBtn.addEventListener('click', () => {
    if (!samples) return;
    const start = hasSelection() ? selectionMin() : cursorTime;
    const end = hasSelection() ? selectionMax() : duration;
    startPlayback(start, end);
  });

  stopBtn.addEventListener('click', stopPlayback);

  loopBtn.addEventListener('click', () => {
    loop = !loop;
    loopBtn.textContent = `Loop selezione: ${loop ? 'ON' : 'OFF'}`;
  });

  clearSelBtn.addEventListener('click', () => {
    selStart = selEnd = null;
    lastAutoIdResults = null;
    drawAll();
    setStatus('selezione cancellata');
  });

  autoIdBtn.addEventListener('click', () => {
    if (!samples || spectrogramCols.length === 0) return;
    const results = runAutoIdHeuristic();
    enrichWithTraining(results);
    lastAutoIdResults = results;
    renderAutoIdResults(results);
    drawAll();
  });

  exportCsvBtn.addEventListener('click', () => {
    if (!lastAutoIdResults) {
      lastAutoIdResults = runAutoIdHeuristic();
      enrichWithTraining(lastAutoIdResults);
      renderAutoIdResults(lastAutoIdResults);
    }
    exportAutoIdCsv(lastAutoIdResults);
  });

  autoIdResults.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-save-dominant-example]');
    if (!btn || !lastAutoIdResults) return;

    const select = autoIdResults.querySelector('[data-dominant-correction]');
    const notes = autoIdResults.querySelector('[data-dominant-notes]');
    let corrected = select ? select.value : '';
    if (!corrected) {
      btn.textContent = 'Scegli correzione';
      setTimeout(() => btn.textContent = 'Salva dominante', 1200);
      return;
    }

    const dominantCall = buildDominantTrainingCall(lastAutoIdResults);
    if (!dominantCall) return;
    if (corrected === 'Confermo suggerimento') corrected = dominantCall.suggestion.label;

    btn.disabled = true;
    btn.textContent = 'Salvo...';
    try {
      await saveTrainingExample(dominantCall, corrected, notes ? notes.value : '');
      btn.textContent = 'Inserimento salvato';
      await loadTrainingExamples(true);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Errore salvataggio';
      alert('Errore salvataggio Supabase: ' + err.message);
    }
  });

  gainSlider.addEventListener('input', () => {
    if (gainNode) gainNode.gain.value = Number(gainSlider.value);
  });

  contrastSlider.addEventListener('input', () => drawAll());
  paletteSelect.addEventListener('change', () => drawAll());
  if (showCallNumbers) showCallNumbers.addEventListener('change', () => drawAll());
  sensitivitySlider.addEventListener('input', () => {
    lastAutoIdResults = null;
    drawAll();
  });
  highPassInput.addEventListener('input', () => {
    updateHighPassLabel(false);
    drawAll();
    if (lastAutoIdResults) lastAutoIdResults = null;
  });
  highPassInput.addEventListener('change', () => {
    updateHighPassLabel(true);
    drawAll();
    if (lastAutoIdResults) lastAutoIdResults = null;
  });
  updateHighPassLabel(true);

  function startPlayback(startTime, endTime) {
    stopPlayback(false);
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(gainSlider.value);
    gainNode.connect(audioCtx.destination);

    const s0 = Math.max(0, Math.floor(startTime * sampleRate));
    const s1 = Math.min(samples.length, Math.floor(endTime * sampleRate));
    const segment = samples.subarray(s0, s1);

    // Crea un AudioBuffer con lo stesso numero di campioni, ma sampleRate 10 volte più basso.
    // Così 384 kHz diventa 38,4 kHz e il playback dura 10 volte di più.
    const safeRate = Math.max(3000, Math.min(192000, playbackSampleRate));
    const buffer = audioCtx.createBuffer(1, segment.length, safeRate);
    buffer.copyToChannel(segment, 0);

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(gainNode);
    playStartAudioTime = audioCtx.currentTime;
    playStartOriginalTime = startTime;
    sourceNode.onended = () => {
      if (loop && hasSelection()) {
        startPlayback(selectionMin(), selectionMax());
      } else {
        sourceNode = null;
        cancelAnimationFrame(animationId);
        animationId = null;
        drawAll();
      }
    };
    sourceNode.start();
    animateCursor();
  }

  function stopPlayback(redraw = true) {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (_) {}
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null;
    }
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    if (redraw) drawAll();
  }

  function animateCursor() {
    if (!audioCtx) return;
    const elapsedPlayback = audioCtx.currentTime - playStartAudioTime;
    cursorTime = playStartOriginalTime + elapsedPlayback * playbackRate;
    if (hasSelection() && loop) {
      if (cursorTime > selectionMax()) cursorTime = selectionMin();
    }
    cursorTime = Math.min(duration, Math.max(0, cursorTime));
    drawAll();
    setStatus('in riproduzione');
    animationId = requestAnimationFrame(animateCursor);
  }

  function parseWav(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const text = (off, len) => Array.from({length: len}, (_, i) => String.fromCharCode(dv.getUint8(off+i))).join('');
    if (text(0,4) !== 'RIFF' || text(8,4) !== 'WAVE') throw new Error('Non sembra un file WAV RIFF/WAVE.');

    let offset = 12;
    let fmt = null;
    let dataOffset = 0;
    let dataSize = 0;

    while (offset + 8 <= dv.byteLength) {
      const id = text(offset, 4);
      const size = dv.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (id === 'fmt ') {
        fmt = {
          audioFormat: dv.getUint16(chunkStart, true),
          channels: dv.getUint16(chunkStart + 2, true),
          sampleRate: dv.getUint32(chunkStart + 4, true),
          byteRate: dv.getUint32(chunkStart + 8, true),
          blockAlign: dv.getUint16(chunkStart + 12, true),
          bitDepth: dv.getUint16(chunkStart + 14, true)
        };
      } else if (id === 'data') {
        dataOffset = chunkStart;
        dataSize = size;
        break;
      }
      offset = chunkStart + size + (size % 2);
    }
    if (!fmt) throw new Error('Chunk fmt mancante.');
    if (!dataOffset) throw new Error('Chunk data mancante.');
    if (![1,3].includes(fmt.audioFormat)) throw new Error('Supportati solo PCM integer o float 32 bit non compressi.');

    const bytesPerSample = fmt.bitDepth / 8;
    const frames = Math.floor(dataSize / fmt.blockAlign);
    const channelData = Array.from({ length: fmt.channels }, () => new Float32Array(frames));

    let p = dataOffset;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < fmt.channels; ch++) {
        channelData[ch][i] = readSample(dv, p, fmt.bitDepth, fmt.audioFormat);
        p += bytesPerSample;
      }
    }
    return { channelData, sampleRate: fmt.sampleRate, channels: fmt.channels, bitDepth: fmt.bitDepth };
  }

  function readSample(dv, p, bits, format) {
    if (format === 3 && bits === 32) return dv.getFloat32(p, true);
    if (bits === 8) return (dv.getUint8(p) - 128) / 128;
    if (bits === 16) return dv.getInt16(p, true) / 32768;
    if (bits === 24) {
      let x = dv.getUint8(p) | (dv.getUint8(p+1) << 8) | (dv.getUint8(p+2) << 16);
      if (x & 0x800000) x |= 0xff000000;
      return x / 8388608;
    }
    if (bits === 32) return dv.getInt32(p, true) / 2147483648;
    throw new Error(bits + ' bit non supportati.');
  }

  function computeSpectrogram() {
    spectrogramCols = [];
    const n = samples.length;
    fftSize = n > sampleRate * 60 ? 4096 : 2048;
    hopSize = Math.floor(fftSize / 4);
    const window = hann(fftSize);
    const maxFrames = 1600;
    const naturalFrames = Math.max(1, Math.floor((n - fftSize) / hopSize));
    const frameStep = Math.max(1, Math.ceil(naturalFrames / maxFrames));

    for (let frame = 0; frame < naturalFrames; frame += frameStep) {
      const start = frame * hopSize;
      const re = new Float64Array(fftSize);
      const im = new Float64Array(fftSize);
      for (let i = 0; i < fftSize; i++) re[i] = (samples[start + i] || 0) * window[i];
      fft(re, im);
      const bins = Math.floor(fftSize / 2);
      const mag = new Float32Array(bins);
      for (let k = 0; k < bins; k++) {
        mag[k] = 20 * Math.log10(Math.sqrt(re[k]*re[k] + im[k]*im[k]) + 1e-9);
      }
      spectrogramCols.push({ time: start / sampleRate, mag });
    }
  }

  function runAutoIdHeuristic() {
    const tMin = hasSelection() ? selectionMin() : 0;
    const tMax = hasSelection() ? selectionMax() : duration;
    const minFreq = 15000;
    const maxFreq = Math.min(sampleRate / 2, maxFreqDisplay);
    const sensitivity = Number(sensitivitySlider.value);

    // Analisi diretta sul segnale originale, non sullo spettrogramma ridotto.
    // L'Auto-ID è volutamente conservativo: segmenti troppo lunghi o troppo bassi vengono marcati come non-bat-like.
    const n = 1024;
    const hop = 96;
    const window = hann(n);
    const startSample = Math.max(0, Math.floor(tMin * sampleRate));
    const endSample = Math.min(samples.length, Math.floor(tMax * sampleRate));
    const available = endSample - startSample;
    if (available < n) {
      return {
        calls: [],
        rejected: [],
        summary: { dominant: 'Selezione troppo corta', counts: {}, meanPeak: 0 },
        range: [tMin, tMax],
        debug: `Selezione troppo corta: ${(available / sampleRate * 1000).toFixed(1)} ms. Serve almeno ${(n / sampleRate * 1000).toFixed(1)} ms.`
      };
    }

    const framePeaks = [];
    const frameCount = Math.max(1, Math.floor((available - n) / hop));
    for (let frame = 0; frame < frameCount; frame++) {
      const s = startSample + frame * hop;
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) re[i] = (samples[s + i] || 0) * window[i];
      fft(re, im);
      const peak = peakInBandForSize(re, im, n, minFreq, maxFreq);
      if (peak) framePeaks.push({ time: s / sampleRate, ...peak });
    }

    if (framePeaks.length === 0) {
      return {
        calls: [],
        rejected: [],
        summary: { dominant: 'Nessuna energia utile', counts: {}, meanPeak: 0 },
        range: [tMin, tMax],
        debug: `Nessun bin utile nella banda ${(minFreq/1000).toFixed(0)} kHz–Nyquist.`
      };
    }

    const dbs = framePeaks.map(f => f.db).sort((a,b) => a-b);
    const noiseFloor = percentile(dbs, 0.55);
    const highLevel = percentile(dbs, 0.95);
    const dynamicRange = Math.max(6, highLevel - noiseFloor);

    // Soglia adattiva: più alta è la sensibilità, più la soglia scende verso il rumore.
    const thresholdDb = noiseFloor + dynamicRange / sensitivity;
    const minCallDur = 0.0012;
    const maxBatCallDur = 0.080;   // sopra ~80 ms non viene trattato come chiamata impulsiva di pipistrello
    const maxGap = 0.010;
    const active = framePeaks.filter(f => f.db >= thresholdDb);

    const calls = [];
    const rejected = [];
    let current = [];
    for (const fr of active) {
      if (current.length === 0) {
        current.push(fr);
      } else {
        const prev = current[current.length - 1];
        if (fr.time - prev.time <= maxGap) current.push(fr);
        else {
          pushEventConservative(current, calls, rejected, minCallDur, maxBatCallDur);
          current = [fr];
        }
      }
    }
    pushEventConservative(current, calls, rejected, minCallDur, maxBatCallDur);

    const classified = calls.map(c => ({ ...c, suggestion: classifyCall(c) }));
    const summary = summarizeCalls(classified);
    const debug = `Banda analizzata: ${(minFreq/1000).toFixed(0)}–${(maxFreq/1000).toFixed(0)} kHz; frame: ${framePeaks.length}; attivi: ${active.length}; scartati/non-bat-like: ${rejected.length}; noise floor: ${noiseFloor.toFixed(1)} dB; soglia: ${thresholdDb.toFixed(1)} dB; picco max: ${Math.max(...framePeaks.map(f=>f.db)).toFixed(1)} dB.`;
    return { calls: classified, rejected, summary, range: [tMin, tMax], debug };
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return 0;
    const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.floor(p * (sortedValues.length - 1))));
    return sortedValues[idx];
  }

  function peakInBandForSize(re, im, n, minFreq, maxFreq) {
    const binHz = sampleRate / n;
    const k0 = Math.max(1, Math.floor(minFreq / binHz));
    const k1 = Math.min(n / 2 - 1, Math.floor(maxFreq / binHz));
    let bestK = -1;
    let bestDb = -Infinity;
    let sum = 0;
    let count = 0;
    for (let k = k0; k <= k1; k++) {
      const db = 20 * Math.log10(Math.sqrt(re[k]*re[k] + im[k]*im[k]) + 1e-9);
      sum += db;
      count++;
      if (db > bestDb) { bestDb = db; bestK = k; }
    }
    if (bestK < 0) return null;
    return { freq: bestK * binHz, db: bestDb, bandMeanDb: sum / Math.max(1, count) };
  }

  function peakInBand(mag, minFreq, maxFreq) {
    const binHz = sampleRate / fftSize;
    const k0 = Math.max(1, Math.floor(minFreq / binHz));
    const k1 = Math.min(mag.length - 1, Math.floor(maxFreq / binHz));
    let bestK = -1;
    let bestDb = -Infinity;
    for (let k = k0; k <= k1; k++) {
      if (mag[k] > bestDb) { bestDb = mag[k]; bestK = k; }
    }
    if (bestK < 0) return null;
    return { freq: bestK * binHz, db: bestDb };
  }

  function pushEventConservative(frames, calls, rejected, minDur, maxBatDur) {
    if (!frames || frames.length < 2) return;
    const t0 = frames[0].time;
    const t1 = frames[frames.length - 1].time;
    const dur = t1 - t0;
    const freqs = frames.map(f => f.freq);
    const dbs = frames.map(f => f.db);
    const fStart = freqs[0];
    const fEnd = freqs[freqs.length - 1];
    const fMin = Math.min(...freqs);
    const fMax = Math.max(...freqs);
    const fPeak = freqs[dbs.indexOf(Math.max(...dbs))];
    const fMean = freqs.reduce((a,b)=>a+b,0) / freqs.length;
    const slope = (fEnd - fStart) / Math.max(0.0001, dur);
    const bandwidth = fMax - fMin;
    const event = { t0, t1, dur, fStart, fEnd, fMin, fMax, fPeak, fMean, bandwidth, slope, frames: frames.length };

    if (dur < minDur) return;

    if (dur > maxBatDur) {
      rejected.push({
        ...event,
        reason: 'Suono troppo lungo/continuo',
        suggestion: {
          label: 'Human / bird / noise-like',
          confidence: 0.80,
          note: 'Evento troppo lungo o continuo: non viene trattato come chiamata isolata di pipistrello.'
        }
      });
      return;
    }

    if (fPeak < 35000) {
      rejected.push({
        ...event,
        reason: 'Picco sotto 35 kHz',
        suggestion: {
          label: 'Human / bird / noise-like',
          confidence: 0.70,
          note: 'Picco sotto 35 kHz: escluso dall’Auto-ID specie. Alcuni pipistrelli grandi possono stare sotto questa soglia, quindi verifica manualmente se il contesto lo suggerisce.'
        }
      });
      return;
    }

    calls.push(event);
  }

  function classifyCall(c) {
    const fp = c.fPeak / 1000;
    const bw = c.bandwidth / 1000;
    const durMs = c.dur * 1000;
    const falling = c.fStart > c.fEnd + 3000;
    const narrow = bw < 8;
    const broad = bw > 25;

    if (fp < 35) {
      return {
        label: 'Human / bird / noise-like',
        confidence: 0.70,
        note: 'Picco sotto 35 kHz: l’Auto‑ID specie non lo tratta come chiamata utile di pipistrello. Verifica manuale per eventuali specie grandi.'
      };
    }

    if (durMs > 80) {
      return {
        label: 'Human / bird / noise-like',
        confidence: 0.80,
        note: 'Evento troppo lungo/continuo: probabilmente non è una chiamata isolata distinguibile.'
      };
    }

    const candidates = europeanBatProfiles.map(profile => {
      const peakScore = rangeScore(fp, profile.peak[0], profile.peak[1]);
      const durScore = rangeScore(durMs, profile.dur[0], profile.dur[1]);
      const bwScore = rangeScore(bw, profile.bw[0], profile.bw[1]);
      let score = peakScore * 0.55 + durScore * 0.25 + bwScore * 0.20;

      if (profile.group === 'Myotis' && falling && broad) score += 0.12;
      if (profile.group.startsWith('Rhinolophus') && narrow && durMs >= 15) score += 0.15;
      if (profile.group.includes('Open-space') && narrow && durMs >= 8) score += 0.08;
      if (profile.group === 'Pipistrellus' && durMs >= 3 && durMs <= 14) score += 0.05;

      return { profile, score: Math.max(0, Math.min(1, score)) };
    }).sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score < 0.38) {
      return { label: 'Non determinato', confidence: 0.25, note: 'Parametri non abbastanza caratteristici per un suggerimento robusto.', candidates: candidates.slice(0, 3) };
    }

    return {
      label: best.profile.label,
      confidence: Number((0.30 + best.score * 0.55).toFixed(2)),
      note: best.profile.note,
      candidates: candidates.slice(0, 3)
    };
  }

  function rangeScore(value, min, max) {
    if (value >= min && value <= max) return 1;
    const width = Math.max(1, max - min);
    const dist = value < min ? min - value : value - max;
    return Math.max(0, 1 - dist / width);
  }

  async function loadTrainingExamples(force = false) {
    if (trainingLoaded && !force) return trainingExamples;
    const url = `${SUPABASE_URL}/rest/v1/${TRAINING_TABLE}?select=*&order=created_at.desc&limit=500`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `HTTP ${res.status}`);
    }
    trainingExamples = await res.json();
    trainingLoaded = true;
    return trainingExamples;
  }

  async function saveTrainingExample(call, correctedLabel, notes = '') {
    const payload = {
      file_name: fileName || null,
      file_hash: makeFileFingerprint(),
      t_start: call.t0,
      t_end: call.t1,
      f_peak_hz: call.fPeak,
      f_min_hz: call.fMin,
      f_max_hz: call.fMax,
      duration_ms: call.dur * 1000,
      bandwidth_khz: call.bw,
      suggested_label: call.suggestion?.label || null,
      corrected_label: correctedLabel,
      user_confidence: 'manual_check',
      notes: notes || null
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TRAINING_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `HTTP ${res.status}`);
    }
  }

  function makeFileFingerprint() {
    const s = `${fileName}|${sampleRate}|${duration.toFixed(6)}|${samples ? samples.length : 0}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function enrichWithTraining(results) {
    if (!results || !results.calls) return results;
    for (const call of results.calls) {
      call.learned = nearestTrainingSuggestion(call);
    }
    return results;
  }

  function nearestTrainingSuggestion(call) {
    const usable = trainingExamples.filter(e => e.corrected_label && isFinite(Number(e.f_peak_hz)) && isFinite(Number(e.duration_ms)) && isFinite(Number(e.bandwidth_khz)));
    if (usable.length < 3) return { label: 'Archivio insufficiente', count: usable.length, confidence: 0, detail: 'servono almeno 3 esempi salvati' };
    const distances = usable.map(e => {
      const peak = (Number(e.f_peak_hz) - call.fPeak) / 12000;
      const dur = (Number(e.duration_ms) - call.dur * 1000) / 15;
      const bw = (Number(e.bandwidth_khz) - call.bw) / 25;
      const d = Math.sqrt(peak*peak + dur*dur + bw*bw);
      return { e, d };
    }).sort((a,b) => a.d - b.d).slice(0, 7);
    const counts = {};
    for (const x of distances) counts[x.e.corrected_label] = (counts[x.e.corrected_label] || 0) + 1;
    const [label, count] = Object.entries(counts).sort((a,b) => b[1] - a[1])[0];
    const meanD = distances.reduce((s,x) => s + x.d, 0) / distances.length;
    const confidence = Math.max(0, Math.min(1, (count / distances.length) * (1 - Math.min(1, meanD / 2.2))));
    return { label, count, confidence, detail: `${count}/${distances.length} esempi vicini; distanza media ${meanD.toFixed(2)}` };
  }

  function correctionOptionsHtml() {
    return correctionLabels.map(x => `<option value="${escapeHtml(x)}">${x ? escapeHtml(x) : '— scegli —'}</option>`).join('');
  }

  function buildDominantTrainingCall(results) {
    const calls = results?.calls || [];
    if (!calls.length) return null;
    const range = results.range || [calls[0].t0, calls[calls.length - 1].t1];
    const dominant = results.summary?.dominant || 'Non determinato';
    const peak = calls.reduce((sum, c) => sum + c.fPeak, 0) / calls.length;
    const dur = calls.reduce((sum, c) => sum + c.dur, 0) / calls.length;
    const bw = calls.reduce((sum, c) => sum + c.bw, 0) / calls.length;
    const fMin = Math.min(...calls.map(c => c.fMin));
    const fMax = Math.max(...calls.map(c => c.fMax));
    return {
      t0: range[0],
      t1: range[1],
      fPeak: peak,
      fMin,
      fMax,
      dur,
      bw,
      suggestion: {
        label: dominant,
        confidence: calls.length ? Math.max(...calls.map(c => c.suggestion?.confidence || 0)) : 0,
        note: 'Esempio salvato come correzione del risultato dominante dell’intervallo selezionato.'
      }
    };
  }

  function summarizeCalls(calls) {
    if (calls.length === 0) return { dominant: 'Nessuna chiamata rilevata', counts: {}, meanPeak: 0 };
    const counts = {};
    let peakSum = 0;
    for (const c of calls) {
      counts[c.suggestion.label] = (counts[c.suggestion.label] || 0) + 1;
      peakSum += c.fPeak;
    }
    const dominant = Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
    return { dominant, counts, meanPeak: peakSum / calls.length };
  }

  function renderAutoIdResults(results) {
    const { calls, summary, range } = results;
    const rejected = results.rejected || [];
    const rejectedNote = rejected.length
      ? `<br>Eventi scartati/non-bat-like: <b style="color:var(--text);">${rejected.length}</b>`
      : '';

    if (calls.length === 0) {
      const rejectedPreview = rejected.slice(0, 6).map((c, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${fmtTime(c.t0)}</td>
          <td>${(c.dur*1000).toFixed(1)} ms</td>
          <td>${(c.fPeak/1000).toFixed(1)} kHz</td>
          <td>${c.reason}</td>
        </tr>
      `).join('');

      autoIdResults.innerHTML = `
        <b style="color:var(--text);">Auto‑ID Europa</b><br>
        Nessuna chiamata utile di pipistrello rilevata nell’intervallo ${fmtTime(range[0])} – ${fmtTime(range[1])}.${rejectedNote}<br><br>
        ${rejectedPreview ? `
          <div style="overflow-y:auto; overflow-x:hidden; margin-top:8px; max-height:170px;">
            <table style="width:100%; border-collapse:collapse; font-size:12px; color:var(--muted);">
              <thead><tr style="color:var(--text);"><th>#</th><th>Inizio</th><th>Durata</th><th>Picco</th><th>Motivo</th></tr></thead>
              <tbody>${rejectedPreview}</tbody>
            </table>
          </div>` : ''}
        <br><span style="color:#ffd166;">Diagnostica:</span> ${results.debug || 'nessun dettaglio'}<br><br>
        Prova a isolare una singola chiamata netta, aumentare/ridurre la sensibilità, oppure spostare il <b>righello</b> solo come riferimento visivo.
      `;
      return;
    }

    const topCalls = calls.slice(0, 12).map((c, i) => {
      const learned = c.learned && c.learned.confidence > 0
        ? `<br><span class="learnHint">Appreso: ${escapeHtml(c.learned.label)} · ${Math.round(c.learned.confidence*100)}%<br>${escapeHtml(c.learned.detail)}</span>`
        : `<br><span class="learnHint">Appreso: ${escapeHtml(c.learned?.detail || 'nessun confronto')}</span>`;
      return `
      <tr>
        <td>${i+1}</td>
        <td>${fmtTime(c.t0)}</td>
        <td>${(c.dur*1000).toFixed(1)} ms</td>
        <td>${(c.fPeak/1000).toFixed(1)} kHz</td>
        <td>${(c.fMin/1000).toFixed(1)}–${(c.fMax/1000).toFixed(1)} kHz</td>
        <td>${c.suggestion.label}<br><span style="color:var(--muted);">${Math.round(c.suggestion.confidence*100)}%</span>${learned}</td>
      </tr>`;
    }).join('');

    const rejectedRows = rejected.slice(0, 8).map((c, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${fmtTime(c.t0)}</td>
        <td>${(c.dur*1000).toFixed(1)} ms</td>
        <td>${(c.fPeak/1000).toFixed(1)} kHz</td>
        <td>${c.reason}</td>
      </tr>
    `).join('');

    const counts = Object.entries(summary.counts).map(([k,v]) => `${k}: ${v}`).join('<br>');
    autoIdResults.innerHTML = `
      <b style="color:var(--text);">Auto‑ID Europa</b><br>
      <span style="color:var(--ok);">Risultato dominante:</span> <b style="color:var(--text);">${summary.dominant}</b><br>
      Chiamate utili rilevate: <b style="color:var(--text);">${calls.length}</b>${rejectedNote}<br>
      Frequenza di picco media: <b style="color:var(--text);">${(summary.meanPeak/1000).toFixed(1)} kHz</b><br>
      <div style="margin-top:6px;">${counts}</div>
      <div class="learnHint" style="margin-top:6px;">Numero file in database: <b>${trainingExamples.length}</b></div>
      <div class="dominantCorrectionBox">
        <div><b>Correzione manuale del risultato dominante</b></div>
        <div class="correctionStack dominantCorrectionStack">
          <select data-dominant-correction>${correctionOptionsHtml()}</select>
          <input data-dominant-notes type="text" placeholder="nota opzionale sul risultato dominante" />
          <button class="miniBtn dominantSaveBtn" data-save-dominant-example>Salva</button>
        </div>
      </div>
      <div style="overflow-y:auto; overflow-x:hidden; margin-top:10px; max-height:260px;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; color:var(--muted);">
          <thead><tr style="color:var(--text);"><th>#</th><th>Inizio</th><th>Durata</th><th>Picco</th><th>Banda</th><th>Gruppo</th></tr></thead>
          <tbody>${topCalls}</tbody>
        </table>
      </div>
      ${rejectedRows ? `
        <div style="margin-top:10px; color:var(--warn);">Scarti conservativi</div>
        <div style="overflow-y:auto; overflow-x:hidden; margin-top:5px; max-height:160px;">
          <table style="width:100%; border-collapse:collapse; font-size:12px; color:var(--muted);">
            <thead><tr style="color:var(--text);"><th>#</th><th>Inizio</th><th>Durata</th><th>Picco</th><th>Motivo</th></tr></thead>
            <tbody>${rejectedRows}</tbody>
          </table>
        </div>` : ''}
      <div style="margin-top:8px; color:var(--warn);">Classificazione morfo‑acustica preliminare.</div>
      <div style="margin-top:6px; color:var(--muted);">Diagnostica: ${results.debug || '—'}</div>
    `;
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    return w;
  }

  function fft(re, im) {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wlenR = Math.cos(ang), wlenI = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wr = 1, wi = 0;
        for (let j = 0; j < len / 2; j++) {
          const uR = re[i+j], uI = im[i+j];
          const vR = re[i+j+len/2] * wr - im[i+j+len/2] * wi;
          const vI = re[i+j+len/2] * wi + im[i+j+len/2] * wr;
          re[i+j] = uR + vR;
          im[i+j] = uI + vI;
          re[i+j+len/2] = uR - vR;
          im[i+j+len/2] = uI - vI;
          const nextWr = wr * wlenR - wi * wlenI;
          wi = wr * wlenI + wi * wlenR;
          wr = nextWr;
        }
      }
    }
  }

  function drawAll() {
    drawSpectrogram();
    drawZoomSpectrogram();
    drawSegmentedSpectrogram();
  }

  function drawSpectrogram() {
    const w = specCanvas.width;
    const h = specCanvas.height;
    specCtx.clearRect(0, 0, w, h);
    specCtx.fillStyle = '#050609';
    specCtx.fillRect(0,0,w,h);

    if (!samples || spectrogramCols.length === 0) {
      specCtx.fillStyle = '#9aa3b2';
      specCtx.font = '18px system-ui';
      specCtx.fillText('Carica un file WAV', 28, 48);
      return;
    }

    const left = 64, right = 12, top = 12, bottom = 36;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const contrast = Number(contrastSlider.value);
    const minDb = -120 + contrast * 0.25;
    const maxDb = -18;

    const img = specCtx.createImageData(plotW, plotH);
    for (let x = 0; x < plotW; x++) {
      const colIdx = Math.min(spectrogramCols.length - 1, Math.floor(x / plotW * spectrogramCols.length));
      const mag = spectrogramCols[colIdx].mag;
      for (let y = 0; y < plotH; y++) {
        const freq = (1 - y / plotH) * maxFreqDisplay;
        const bin = Math.min(mag.length - 1, Math.floor(freq / (sampleRate / fftSize)));
        const db = mag[bin];
        let v = (db - minDb) / (maxDb - minDb);
        v = Math.max(0, Math.min(1, v));
        v = Math.pow(v, 0.75);
        const c = spectrogramColor(v, freq, db, mag, bin);
        const idx = (y * plotW + x) * 4;
        img.data[idx] = c[0]; img.data[idx+1] = c[1]; img.data[idx+2] = c[2]; img.data[idx+3] = 255;
      }
    }
    specCtx.putImageData(img, left, top);

    const highPassHz = getHighPassHz();
    if (highPassHz > 0 && highPassHz < maxFreqDisplay) {
      const yHp = top + (1 - highPassHz / maxFreqDisplay) * plotH;
      specCtx.strokeStyle = '#ff3b30';
      specCtx.lineWidth = 2;
      specCtx.beginPath();
      specCtx.moveTo(left, yHp);
      specCtx.lineTo(left + plotW, yHp);
      specCtx.stroke();
      specCtx.fillStyle = '#ff3b30';
      specCtx.font = '12px system-ui';
      specCtx.fillText(`Righello ${formatKhzValue(highPassHz / 1000)} kHz`, left + 8, Math.max(top + 14, yHp - 6));
    }

    // Selection overlay
    if (hasSelection()) {
      const x1 = left + selectionMin() / duration * plotW;
      const x2 = left + selectionMax() / duration * plotW;
      specCtx.fillStyle = 'rgba(93,183,255,.18)';
      specCtx.fillRect(x1, top, x2 - x1, plotH);
      specCtx.strokeStyle = 'rgba(93,183,255,.9)';
      specCtx.lineWidth = 2;
      specCtx.strokeRect(x1, top, x2 - x1, plotH);
    }

    // Cursor
    const cx = left + cursorTime / duration * plotW;
    specCtx.strokeStyle = '#ffffff';
    specCtx.lineWidth = 1.5;
    specCtx.beginPath();
    specCtx.moveTo(cx, top);
    specCtx.lineTo(cx, top + plotH);
    specCtx.stroke();

    if (showCallNumbers && showCallNumbers.checked && lastAutoIdResults && lastAutoIdResults.calls && lastAutoIdResults.calls.length) {
      drawCallNumberOverlay(specCtx, lastAutoIdResults.calls, left, top, plotW, plotH, 0, duration);
    }

    // Axes
    specCtx.strokeStyle = '#9aa3b2';
    specCtx.lineWidth = 1;
    specCtx.strokeRect(left, top, plotW, plotH);
    specCtx.fillStyle = '#cbd2df';
    specCtx.font = '12px system-ui';
    for (let i = 0; i <= 4; i++) {
      const f = i / 4 * maxFreqDisplay;
      const y = top + plotH - i / 4 * plotH;
      specCtx.fillText(`${Math.round(f/1000)} kHz`, 8, y + 4);
      specCtx.strokeStyle = 'rgba(255,255,255,.12)';
      specCtx.beginPath(); specCtx.moveTo(left, y); specCtx.lineTo(left+plotW, y); specCtx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const t = i / 5 * duration;
      const x = left + i / 5 * plotW;
      specCtx.fillText(fmtTime(t), x - 18, h - 12);
    }
  }

  function spectrogramColor(v, freq, db, spectrumLike, bin, imLike = null) {
    const mode = paletteSelect ? paletteSelect.value : 'batblue';
    if (mode !== 'batfocus') return colorMap(v);

    // “Bat focus”: maschera visiva prudente, non una vera identificazione.
    // Evidenzia solo segnali brevi/intensi nella banda ultrasonica tipica e scurisce il resto.
    const fKhz = freq / 1000;
    const minFreqKhz = 18;
    const maxFreqKhz = 125;

    if (fKhz < minFreqKhz || fKhz > maxFreqKhz) return [0, 0, 45];

    // Soglia intenzionalmente severa: sotto resta blu scuro.
    const visualThreshold = 0.38;
    if (v < visualThreshold) return [0, 0, 55];

    // Controllo di picco locale verticale: aiuta a scartare rumore diffuso.
    let localPeak = true;
    let localMean = db;
    if (spectrumLike && bin > 3) {
      let sum = 0;
      let count = 0;
      for (let k = -5; k <= 5; k++) {
        const b = bin + k;
        if (b < 0) continue;
        let val;
        if (imLike) {
          if (b >= spectrumLike.length || b >= imLike.length) continue;
          val = 20 * Math.log10(Math.sqrt(spectrumLike[b]*spectrumLike[b] + imLike[b]*imLike[b]) + 1e-9);
        } else {
          if (b >= spectrumLike.length) continue;
          val = spectrumLike[b];
        }
        sum += val;
        count++;
      }
      localMean = count ? sum / count : db;
      localPeak = (db - localMean) > 1.2 || v > 0.68;
    }

    if (!localPeak) return [0, 0, 50];

    // Rimappa i pixel sopravvissuti: blu -> ciano -> giallo/rosso -> bianco.
    const u = Math.max(0, Math.min(1, (v - visualThreshold) / (1 - visualThreshold)));
    return colorMap(Math.pow(u, 0.7));
  }

  function colorMap(v) {
    // Palette selezionabile. La modalità “Blu bat” imita lo stile dei software bioacustici:
    // fondo blu profondo e segnali evidenziati in ciano/giallo/rosso/bianco.
    v = Math.max(0, Math.min(1, v));
    const mode = paletteSelect ? paletteSelect.value : 'batblue';
    let stops;

    if (mode === 'batblue' || mode === 'batfocus') {
      // Taglia il rumore debole e comprime le intensità per tenere lo sfondo blu scuro.
      let u = Math.max(0, (v - 0.16) / 0.84);
      u = Math.pow(u, 1.55);
      stops = [
        [0.00, [0, 0, 78]],      // blu profondo
        [0.20, [0, 10, 145]],
        [0.42, [0, 185, 255]],   // ciano
        [0.58, [25, 245, 120]],  // verde
        [0.72, [255, 245, 30]],  // giallo
        [0.88, [255, 70, 0]],    // rosso/arancio
        [1.00, [255, 255, 255]]  // bianco sui picchi
      ];
      v = u;
    } else if (mode === '2dark') {
      // Due colori: blu notte -> bianco.
      stops = [
        [0.00, [2, 8, 22]],
        [1.00, [255, 255, 255]]
      ];
    } else if (mode === 'bw') {
      // Bianco e nero quasi puro, utile per lettura estrema.
      const g = Math.round(255 * Math.pow(v, 1.8));
      return [g, g, g];
    } else {
      // Quattro colori: tre toni scuri + bianco.
      stops = [
        [0.00, [2, 8, 22]],
        [0.38, [8, 22, 52]],
        [0.70, [16, 48, 92]],
        [1.00, [255, 255, 255]]
      ];
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const [a, ca] = stops[i], [b, cb] = stops[i + 1];
      if (v >= a && v <= b) {
        const p = (v - a) / (b - a || 1);
        return ca.map((x, j) => Math.round(x + (cb[j] - x) * p));
      }
    }
    return stops[stops.length - 1][1];
  }

  function exportAutoIdCsv(results) {
    if (!results || !results.calls || results.calls.length === 0) {
      alert('Nessuna chiamata da esportare. Esegui prima Auto-ID su un tratto con chiamate rilevate.');
      return;
    }

    const header = [
      'file',
      'selection_start_s',
      'selection_end_s',
      'call_index',
      'call_start_s',
      'call_end_s',
      'duration_ms',
      'f_start_khz',
      'f_end_khz',
      'f_min_khz',
      'f_max_khz',
      'f_peak_khz',
      'f_mean_khz',
      'bandwidth_khz',
      'slope_khz_per_s',
      'frames',
      'suggestion',
      'confidence',
      'note'
    ];

    const rows = results.calls.map((c, i) => [
      fileName,
      results.range[0].toFixed(6),
      results.range[1].toFixed(6),
      i + 1,
      c.t0.toFixed(6),
      c.t1.toFixed(6),
      (c.dur * 1000).toFixed(3),
      (c.fStart / 1000).toFixed(3),
      (c.fEnd / 1000).toFixed(3),
      (c.fMin / 1000).toFixed(3),
      (c.fMax / 1000).toFixed(3),
      (c.fPeak / 1000).toFixed(3),
      (c.fMean / 1000).toFixed(3),
      (c.bandwidth / 1000).toFixed(3),
      (c.slope / 1000).toFixed(3),
      c.frames,
      c.suggestion.label,
      c.suggestion.confidence.toFixed(2),
      c.suggestion.note
    ]);

    const lines = [header].concat(rows).map(row => row.map(csvEscape).join(','));
    const csv = lines.join(String.fromCharCode(10));

    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'bat_audio';
    a.href = url;
    a.download = base + '_autoid.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    const s = String(value == null ? '' : value);
    const mustQuote = s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf(';') >= 0 || s.indexOf(String.fromCharCode(10)) >= 0 || s.indexOf(String.fromCharCode(13)) >= 0;
    if (!mustQuote) return s;
    return '"' + s.split('"').join('""') + '"';
  }


  function drawCallNumberOverlay(ctx, calls, left, top, plotW, plotH, tMin, tMax) {
    if (!calls || !calls.length) return;
    const yBox = top + (1 - Math.min(25000, maxFreqDisplay) / maxFreqDisplay) * plotH;
    const boxW = 18;
    const boxH = 16;
    const visible = calls.filter(c => c.t1 >= tMin && c.t0 <= tMax);
    visible.forEach((c, idx) => {
      const centerT = (c.t0 + c.t1) / 2;
      const x = left + ((centerT - tMin) / Math.max(1e-9, tMax - tMin)) * plotW;
      const px = Math.max(left + boxW/2, Math.min(left + plotW - boxW/2, x));
      const peakY = top + (1 - Math.min(maxFreqDisplay, Math.max(0, c.fPeak)) / maxFreqDisplay) * plotH;
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, yBox - boxH/2 - 2);
      ctx.lineTo(px, peakY + 4);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - boxW/2, yBox - boxH/2, boxW, boxH);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - boxW/2, yBox - boxH/2, boxW, boxH);
      ctx.fillStyle = '#000000';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), px, yBox + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    });
  }

  function drawSegmentedSpectrogram() {
    const w = segmentCanvas.width;
    const h = segmentCanvas.height;
    segmentCtx.clearRect(0, 0, w, h);
    segmentCtx.fillStyle = '#03050d';
    segmentCtx.fillRect(0, 0, w, h);

    if (!samples) {
      segmentCtx.fillStyle = '#9aa3b2';
      segmentCtx.font = '18px system-ui';
      segmentCtx.fillText('Segmentazione calls non disponibile', 24, 44);
      return;
    }

    if (!lastAutoIdResults || !lastAutoIdResults.calls || lastAutoIdResults.calls.length === 0) {
      segmentCtx.fillStyle = '#cbd2df';
      segmentCtx.font = '17px system-ui';
      segmentCtx.fillText('Esegui Auto-ID per ottenere la vista segmentata delle calls.', 24, 44);
      segmentCtx.fillStyle = '#8c95a7';
      segmentCtx.font = '13px system-ui';
      segmentCtx.fillText('La vista prova a isolare solo i tratti intensi e localmente prominenti (“baffi”) delle chiamate rilevate.', 24, 68);
      return;
    }

    const t0 = lastAutoIdResults.range ? lastAutoIdResults.range[0] : (hasSelection() ? selectionMin() : 0);
    const t1 = lastAutoIdResults.range ? lastAutoIdResults.range[1] : (hasSelection() ? selectionMax() : duration);
    if (!(t1 > t0)) return;

    const left = 64, right = 12, top = 12, bottom = 36;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const contrast = Number(contrastSlider.value);
    const minDb = -120 + contrast * 0.25;
    const maxDb = -18;
    const n = 2048;
    const hop = 128;
    const window = hann(n);
    const startSample = Math.max(0, Math.floor(t0 * sampleRate));
    const endSample = Math.min(samples.length, Math.floor(t1 * sampleRate));
    const segmentSamples = endSample - startSample;
    const frames = Math.max(1, Math.floor((segmentSamples - n) / hop));
    const calls = lastAutoIdResults.calls || [];
    const img = segmentCtx.createImageData(plotW, plotH);

    function localProminence(db, re, im, bin) {
      let sum = 0, count = 0;
      for (let k = -5; k <= 5; k++) {
        const b = bin + k;
        if (b < 0 || b >= n / 2) continue;
        const val = 20 * Math.log10(Math.sqrt(re[b]*re[b] + im[b]*im[b]) + 1e-9);
        sum += val;
        count++;
      }
      const mean = count ? sum / count : db;
      return db - mean;
    }

    for (let x = 0; x < plotW; x++) {
      const frame = Math.floor(x / plotW * Math.max(1, frames));
      const s = startSample + frame * hop;
      const frameTime = s / sampleRate;
      const activeCalls = calls.filter(c => frameTime >= c.t0 - 0.0015 && frameTime <= c.t1 + 0.0015);
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) re[i] = (samples[s + i] || 0) * window[i];
      fft(re, im);

      for (let y = 0; y < plotH; y++) {
        const freq = (1 - y / plotH) * maxFreqDisplay;
        const bin = Math.min(n / 2 - 1, Math.floor(freq / (sampleRate / n)));
        const db = 20 * Math.log10(Math.sqrt(re[bin]*re[bin] + im[bin]*im[bin]) + 1e-9);
        let v = (db - minDb) / (maxDb - minDb);
        v = Math.max(0, Math.min(1, v));
        v = Math.pow(v, 0.75);

        let keep = false;
        if (activeCalls.length && v > 0.34) {
          const prominence = localProminence(db, re, im, bin);
          if (prominence > 1.2 || v > 0.72) {
            for (const c of activeCalls) {
              const timeFrac = (frameTime - c.t0) / Math.max(1e-9, c.t1 - c.t0);
              const expected = c.fStart + (c.fEnd - c.fStart) * Math.max(0, Math.min(1, timeFrac));
              const bandPad = Math.max(4000, c.bandwidth * 0.65 + 3000);
              const withinBox = freq >= Math.max(0, c.fMin - 7000) && freq <= Math.min(maxFreqDisplay, c.fMax + 7000);
              const nearTrack = Math.abs(freq - expected) <= bandPad;
              if (withinBox && nearTrack) {
                keep = true;
                break;
              }
            }
          }
        }

        const idx = (y * plotW + x) * 4;
        const c = keep ? colorMap(Math.min(1, Math.max(0, (v - 0.18) / 0.82))) : [0, 0, 16];
        img.data[idx] = c[0];
        img.data[idx + 1] = c[1];
        img.data[idx + 2] = c[2];
        img.data[idx + 3] = 255;
      }
    }
    segmentCtx.putImageData(img, left, top);

    if (showCallNumbers && showCallNumbers.checked && calls.length) {
      drawCallNumberOverlay(segmentCtx, calls, left, top, plotW, plotH, t0, t1);
    }

    segmentCtx.strokeStyle = '#9aa3b2';
    segmentCtx.lineWidth = 1;
    segmentCtx.strokeRect(left, top, plotW, plotH);
    segmentCtx.fillStyle = '#cbd2df';
    segmentCtx.font = '12px system-ui';
    for (let i = 0; i <= 4; i++) {
      const f = i / 4 * maxFreqDisplay;
      const y = top + plotH - i / 4 * plotH;
      segmentCtx.fillText(`${Math.round(f/1000)} kHz`, 8, y + 4);
      segmentCtx.strokeStyle = 'rgba(255,255,255,.12)';
      segmentCtx.beginPath();
      segmentCtx.moveTo(left, y);
      segmentCtx.lineTo(left + plotW, y);
      segmentCtx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const t = t0 + i / 5 * (t1 - t0);
      const x = left + i / 5 * plotW;
      segmentCtx.fillText(fmtTime(t), x - 18, h - 12);
    }
    segmentCtx.fillStyle = 'rgba(255,255,255,.84)';
    segmentCtx.font = '13px system-ui';
    segmentCtx.fillText(`Segmentazione calls: ${fmtTime(t0)} – ${fmtTime(t1)} · calls rilevate ${calls.length}`, left + 8, top + 20);
  }

  function drawZoomSpectrogram() {
    const w = zoomCanvas.width;
    const h = zoomCanvas.height;
    zoomCtx.clearRect(0, 0, w, h);
    zoomCtx.fillStyle = '#050609';
    zoomCtx.fillRect(0, 0, w, h);

    if (!samples) {
      zoomCtx.fillStyle = '#9aa3b2';
      zoomCtx.font = '18px system-ui';
      zoomCtx.fillText('Zoom selezione non disponibile', 24, 44);
      return;
    }

    let t0, t1;
    if (hasSelection()) {
      t0 = selectionMin();
      t1 = selectionMax();
    } else {
      const win = Math.min(0.250, Math.max(0.030, duration / 20));
      t0 = Math.max(0, cursorTime - win / 2);
      t1 = Math.min(duration, cursorTime + win / 2);
      if (t1 - t0 < win) {
        if (t0 === 0) t1 = Math.min(duration, win);
        if (t1 === duration) t0 = Math.max(0, duration - win);
      }
    }

    if (t1 <= t0) return;

    const left = 64, right = 12, top = 12, bottom = 36;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const contrast = Number(contrastSlider.value);
    const minDb = -120 + contrast * 0.25;
    const maxDb = -18;
    const n = 2048;
    const hop = 128;
    const window = hann(n);
    const startSample = Math.max(0, Math.floor(t0 * sampleRate));
    const endSample = Math.min(samples.length, Math.floor(t1 * sampleRate));
    const segmentSamples = endSample - startSample;
    const frames = Math.max(1, Math.floor((segmentSamples - n) / hop));

    const img = zoomCtx.createImageData(plotW, plotH);

    for (let x = 0; x < plotW; x++) {
      const frame = Math.floor(x / plotW * Math.max(1, frames));
      const s = startSample + frame * hop;
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) re[i] = (samples[s + i] || 0) * window[i];
      fft(re, im);
      for (let y = 0; y < plotH; y++) {
        const freq = (1 - y / plotH) * maxFreqDisplay;
        const bin = Math.min(n / 2 - 1, Math.floor(freq / (sampleRate / n)));
        const db = 20 * Math.log10(Math.sqrt(re[bin]*re[bin] + im[bin]*im[bin]) + 1e-9);
        let v = (db - minDb) / (maxDb - minDb);
        v = Math.max(0, Math.min(1, v));
        v = Math.pow(v, 0.75);
        const c = spectrogramColor(v, freq, db, re, bin, im);
        const idx = (y * plotW + x) * 4;
        img.data[idx] = c[0]; img.data[idx+1] = c[1]; img.data[idx+2] = c[2]; img.data[idx+3] = 255;
      }
    }
    zoomCtx.putImageData(img, left, top);

    const highPassHz = getHighPassHz();
    if (highPassHz > 0 && highPassHz < maxFreqDisplay) {
      const yHp = top + (1 - highPassHz / maxFreqDisplay) * plotH;
      zoomCtx.strokeStyle = '#ff3b30';
      zoomCtx.lineWidth = 2;
      zoomCtx.beginPath();
      zoomCtx.moveTo(left, yHp);
      zoomCtx.lineTo(left + plotW, yHp);
      zoomCtx.stroke();
      zoomCtx.fillStyle = '#ff3b30';
      zoomCtx.font = '12px system-ui';
      zoomCtx.fillText(`Righello ${formatKhzValue(highPassHz / 1000)} kHz`, left + 8, Math.max(top + 14, yHp - 6));
    }

    // Cursor in zoom
    if (cursorTime >= t0 && cursorTime <= t1) {
      const cx = left + (cursorTime - t0) / (t1 - t0) * plotW;
      zoomCtx.strokeStyle = '#ffffff';
      zoomCtx.lineWidth = 1.5;
      zoomCtx.beginPath();
      zoomCtx.moveTo(cx, top);
      zoomCtx.lineTo(cx, top + plotH);
      zoomCtx.stroke();
    }

    if (showCallNumbers && showCallNumbers.checked && lastAutoIdResults && lastAutoIdResults.calls && lastAutoIdResults.calls.length) {
      drawCallNumberOverlay(zoomCtx, lastAutoIdResults.calls, left, top, plotW, plotH, t0, t1);
    }

    zoomCtx.strokeStyle = '#9aa3b2';
    zoomCtx.lineWidth = 1;
    zoomCtx.strokeRect(left, top, plotW, plotH);
    zoomCtx.fillStyle = '#cbd2df';
    zoomCtx.font = '12px system-ui';

    for (let i = 0; i <= 4; i++) {
      const f = i / 4 * maxFreqDisplay;
      const y = top + plotH - i / 4 * plotH;
      zoomCtx.fillText(`${Math.round(f/1000)} kHz`, 8, y + 4);
      zoomCtx.strokeStyle = 'rgba(255,255,255,.12)';
      zoomCtx.beginPath(); zoomCtx.moveTo(left, y); zoomCtx.lineTo(left+plotW, y); zoomCtx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const t = t0 + i / 5 * (t1 - t0);
      const x = left + i / 5 * plotW;
      zoomCtx.fillText(fmtTime(t), x - 18, h - 12);
    }

    zoomCtx.fillStyle = 'rgba(255,255,255,.82)';
    zoomCtx.font = '13px system-ui';
    const label = hasSelection()
      ? `Zoom selezione: ${fmtTime(t0)} – ${fmtTime(t1)}`
      : `Zoom cursore: finestra ${fmtTime(t1 - t0)}`;
    zoomCtx.fillText(label, left + 8, top + 20);
  }

  function canvasToTime(e) {
    const rect = specCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * specCanvas.width / rect.width;
    const left = 64, right = 12;
    const plotW = specCanvas.width - left - right;
    const t = (x - left) / plotW * duration;
    return Math.max(0, Math.min(duration, t));
  }

  specCanvas.addEventListener('pointerdown', (e) => {
    if (!samples) return;
    lastAutoIdResults = null;
    isSelecting = true;
    dragStartTime = canvasToTime(e);
    cursorTime = dragStartTime;
    selStart = dragStartTime;
    selEnd = dragStartTime;
    specCanvas.setPointerCapture(e.pointerId);
    drawAll();
    setStatus();
  });

  specCanvas.addEventListener('pointermove', (e) => {
    if (!samples || !isSelecting) return;
    selEnd = canvasToTime(e);
    cursorTime = selEnd;
    drawAll();
    setStatus();
  });

  specCanvas.addEventListener('pointerup', (e) => {
    if (!samples) return;
    isSelecting = false;
    const t = canvasToTime(e);
    selEnd = t;
    if (Math.abs(selEnd - selStart) < 0.01) {
      cursorTime = t;
      selStart = selEnd = null;
    }
    lastAutoIdResults = null;
    drawAll();
    setStatus();
  });

  drawAll();
})();
