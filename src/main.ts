import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { InkDocument } from './ink/document';
import { InkCanvas } from './ink/InkCanvas';
import { isScribble, strokesCoveredBy } from './ink/scratch';
import { isColorKey, type ColorKey, type Tool } from './ink/types';
import { RecognitionClient } from './recognition/client';
import type { RecognitionResult } from './recognition/types';
import { describeRows, LOW_CONFIDENCE, type EquationView } from './app/equations';
import { ResultsLayer } from './app/results-layer';
import { Feedback } from './ui/feedback';
import { PerfHud } from './ui/perf-hud';
import { loadPage, safeStorage, savePage } from './ui/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const paper = $('paper');
const hint = $('hint');
const chipModel = $('chip-model');
const chipNet = $('chip-net');
const list = $('reading-list');
const empty = $('reading-empty');

const doc = new InkDocument();
const results = new ResultsLayer();
const feedback = new Feedback();
const hud = new PerfHud(document.body);

let drawing = false;
let lastKeys = new Map<string, string>();

// ---- canvas ----------------------------------------------------------------------------------
const canvas = new InkCanvas(paper, doc, {
  onStrokeStart: () => {
    drawing = true;
    hud.setDrawing(true);
    hint.classList.add('hidden');
  },
  onStrokeEnd: () => {
    drawing = false;
    hud.setDrawing(false);
  },
  onResize: (w, h, dpr) => results.resize(w, h, dpr),
  // Scratch-to-erase: a zig-zag scribble over ink deletes it (one undo step) instead of being ink.
  interceptStroke: (stroke) => {
    if (!isScribble(stroke)) return false;
    const ids = strokesCoveredBy(stroke, doc.strokes);
    if (!ids.length) return false;
    doc.remove(ids);
    feedback.erase();
    return true;
  },
});
paper.insertBefore(results.canvas, canvas.live);
results.resize(canvas.width, canvas.height, canvas.dpr);

// Zoom logic
let currentZoom = 1;
let paperLogicalHeight = 3000;
const paperWrap = paper.parentElement!;
paperWrap.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.11;
    currentZoom *= delta;
    currentZoom = Math.max(0.3, Math.min(currentZoom, 4));
    paper.style.transform = `scale(${currentZoom})`;
    paper.style.transformOrigin = '0 0';
    paperWrap.style.width = `${850 * currentZoom}px`;
    paperWrap.style.height = `${paperLogicalHeight * currentZoom}px`;
    canvas.resize();
    window.dispatchEvent(new Event('resize'));
  }
}, { passive: false });

// Infinite scroll
const stage = document.querySelector('.stage') as HTMLElement;
stage.addEventListener('scroll', () => {
  if (stage.scrollTop + stage.clientHeight > stage.scrollHeight - 800) {
    paperLogicalHeight += 1000;
    paper.style.height = `${paperLogicalHeight}px`;
    paperWrap.style.height = `${paperLogicalHeight * currentZoom}px`;
    canvas.resize();
  }
});

function applyTheme() {
  // Each ink colour key resolves to a theme-appropriate colour (lighter tints on the dark theme).
  const css = getComputedStyle(document.documentElement);
  const pick = (k: ColorKey, fallback: string) => css.getPropertyValue(`--c-${k}`).trim() || fallback;
  canvas.setPalette({
    ink: pick('ink', '#14213d'),
    blue: pick('blue', '#1d4ed8'),
    green: pick('green', '#15803d'),
    red: pick('red', '#dc2626'),
    purple: pick('purple', '#7e22ce'),
  });
  results.redraw();
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---- recognition ----------------------------------------------------------------------------
const client = new RecognitionClient(
  {
    symbols: new URL('models/symbols16.onnx', document.baseURI).href,
    digits: new URL('models/digits_mnist.onnx', document.baseURI).href,
  },
  (status, detail) => {
    chipModel.dataset.state = status;
    chipModel.textContent =
      status === 'ready' ? 'On-device model ready' : status === 'loading' ? 'Loading on-device model…' : status === 'error' ? `Model error: ${detail ?? ''}` : 'Idle';
  },
);

const DEBOUNCE_MS = 260;
let timer = 0;
let inflight = 0;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(run, DEBOUNCE_MS);
}

async function run() {
  if (drawing) return schedule(); // never recognise mid-gesture
  if (doc.isEmpty) {
    render(null, []);
    return;
  }
  const version = doc.version;
  hud.setRecognizing(++inflight > 0);
  const res = await client.recognize(doc.strokes).finally(() => hud.setRecognizing(--inflight > 0));
  if (!res || version !== doc.version) return; // superseded or stale → a newer run is coming
  hud.inferenceMs = res.ms;
  hud.inferenceCount++;
  render(res, describeRows(res.rows));
}

function render(res: RecognitionResult | null, views: EquationView[]) {
  results.set(views);
  
  const rows = res?.rows ?? [];

  // Haptic/audio cue only when an answer actually changes.
  const keys = new Map(views.map((v) => [v.key, v.display]));
  for (const v of views) {
    if (lastKeys.get(v.key) !== v.display) {
      v.kind === 'undefined' || v.kind === 'error' || v.kind === 'check-wrong' ? feedback.problem() : feedback.answer();
      if (v.kind === 'ok' || v.kind === 'check-ok') {
        const row = rows.find(r => r.bbox === v.bbox);
        if (row) appendToHistory(row.text.replace(/-/g, '−'), v.display);
      }
    }
  }
  lastKeys = keys;

  list.replaceChildren();
  empty.hidden = rows.length > 0;
  for (const row of rows) {
    const li = document.createElement('li');
    const eq = document.createElement('div');
    eq.className = 'eq';
    eq.textContent = row.text.replace(/-/g, '−');
    li.append(eq);
    const view = views.find((v) => v.bbox === row.bbox);
    if (view) {
      const ans = document.createElement('div');
      ans.className = 'ans' + (view.kind === 'ok' || view.kind === 'check-ok' ? '' : ' bad');
      ans.textContent = view.display;
      li.append(ans);
    }
    const conf = Math.min(...row.symbols.map((s) => s.confidence));
    const meta = document.createElement('div');
    meta.className = 'meta';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(conf * 100)}%`;
    fill.className = conf >= 0.85 ? '' : conf >= LOW_CONFIDENCE ? 'mid' : 'low';
    bar.append(fill);
    const label = document.createElement('span');
    label.textContent = conf >= LOW_CONFIDENCE ? `${Math.round(conf * 100)}% sure` : 'unsure – rewrite clearly';
    meta.append(bar, label);
    li.append(meta);
    list.append(li);
  }
}

// Any ink change (stroke, erase, undo, redo, clear, load) → debounced re-recognition + autosave.
let saveTimer = 0;
doc.subscribe((c) => {
  hint.classList.toggle('hidden', !doc.isEmpty);
  if (c.kind !== 'load') {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => savePage(doc.strokes), 500);
  }
  schedule();
});

// ---- "What I read" & History drawer -----------------------------------------------------
const readingPanel = $('reading');
const readingBtn = $<HTMLButtonElement>('btn-reading');
function setReadingOpen(open: boolean) {
  readingPanel.dataset.open = String(open);
  readingBtn.setAttribute('aria-expanded', String(open));
  readingBtn.setAttribute('aria-label', open ? 'Hide side panel' : 'Show side panel');
}
readingBtn.addEventListener('click', () => setReadingOpen(readingPanel.dataset.open !== 'true'));

// History logic
interface HistoryEntry {
  eq: string;
  ans: string;
  time: number;
}
let historyLog: HistoryEntry[] = [];
try {
  const loaded = JSON.parse(safeStorage.get('calcink.history.v1') || '[]');
  if (Array.isArray(loaded)) historyLog = loaded;
} catch (e) {}

const historyList = $('history-list');
const historyEmpty = $('history-empty');

function renderHistory() {
  historyList.replaceChildren();
  historyEmpty.hidden = historyLog.length > 0;
  for (const entry of historyLog.slice().reverse()) {
    const li = document.createElement('li');
    const eq = document.createElement('div');
    eq.className = 'eq';
    eq.textContent = entry.eq;
    li.append(eq);
    const ans = document.createElement('div');
    ans.className = 'ans';
    ans.textContent = entry.ans;
    li.append(ans);
    
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.append(meta);

    historyList.append(li);
  }
}

function appendToHistory(eq: string, ans: string) {
  if (historyLog.length > 0 && historyLog[historyLog.length - 1].eq === eq && historyLog[historyLog.length - 1].ans === ans) return;
  historyLog.push({ eq, ans, time: Date.now() });
  if (historyLog.length > 50) historyLog.shift();
  safeStorage.set('calcink.history.v1', JSON.stringify(historyLog));
  renderHistory();
}
renderHistory();

const tabEq = $('tab-eq');
const tabHist = $('tab-hist');
const panelEq = $('panel-eq');
const panelHist = $('panel-hist');

tabEq.onclick = () => {
  tabEq.classList.add('active');
  tabEq.style.color = 'var(--text)';
  tabHist.classList.remove('active');
  tabHist.style.color = 'var(--muted)';
  panelEq.style.display = 'block';
  panelHist.style.display = 'none';
};

tabHist.onclick = () => {
  tabHist.classList.add('active');
  tabHist.style.color = 'var(--text)';
  tabEq.classList.remove('active');
  tabEq.style.color = 'var(--muted)';
  panelHist.style.display = 'block';
  panelEq.style.display = 'none';
};

// ---- paper style: ruled notebook · engineering grid · blank parchment -----------------------------
type PaperStyle = 'ruled' | 'grid' | 'parchment';
const PAPER_KEY = 'calcink.paper.v1';
const PAPERS: readonly PaperStyle[] = ['ruled', 'grid', 'parchment'];
const paperButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-paper]')].filter((b) => b.classList.contains('paper-opt'));
function setPaper(style: PaperStyle, persist = true) {
  paper.dataset.paper = style;
  for (const b of paperButtons) b.setAttribute('aria-checked', String(b.dataset.paper === style));
  if (persist) safeStorage.set(PAPER_KEY, style);
}
for (const b of paperButtons) b.addEventListener('click', () => setPaper(b.dataset.paper as PaperStyle));
const savedPaper = safeStorage.get(PAPER_KEY) as PaperStyle | null;
setPaper(savedPaper && PAPERS.includes(savedPaper) ? savedPaper : 'ruled', false);

// ---- toolbar --------------------------------------------------------------------------------
const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
function setTool(t: Tool) {
  canvas.setTool(t);
  for (const b of toolButtons) b.setAttribute('aria-checked', String(b.dataset.tool === t));
}
for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool as Tool));

const undoBtn = $<HTMLButtonElement>('btn-undo');
const redoBtn = $<HTMLButtonElement>('btn-redo');
const clearBtn = $<HTMLButtonElement>('btn-clear');
const syncButtons = () => {
  undoBtn.disabled = !doc.canUndo;
  redoBtn.disabled = !doc.canRedo;
  clearBtn.disabled = doc.isEmpty;
};
doc.subscribe(syncButtons);
undoBtn.onclick = () => doc.undo();
redoBtn.onclick = () => doc.redo();
clearBtn.onclick = () => {
  doc.clear();
  feedback.erase();
};

const width = $<HTMLInputElement>('width');
const widthDot = $('width-dot');
const syncWidth = () => {
  canvas.strokeWidth = Number(width.value);
  widthDot.style.setProperty('--w', `${width.value}px`);
};
width.oninput = syncWidth;
syncWidth();

// ---- ink colours ------------------------------------------------------------------------------
const COLOR_ORDER: ColorKey[] = ['ink', 'blue', 'green', 'red', 'purple'];
const swatches = [...document.querySelectorAll<HTMLButtonElement>('[data-color]')];
function setColor(key: ColorKey, persist = true) {
  canvas.penColor = key; // only affects NEW strokes
  for (const b of swatches) b.setAttribute('aria-checked', String(b.dataset.color === key));
  widthDot.style.setProperty('--pen', `var(--c-${key})`); // the width preview shows the pen colour
  if (persist) safeStorage.set('calcink.color.v1', key);
}
for (const b of swatches) b.addEventListener('click', () => setColor(b.dataset.color as ColorKey));
const savedColor = safeStorage.get('calcink.color.v1');
setColor(isColorKey(savedColor) ? savedColor : 'ink', false);

// ---- help dialog ------------------------------------------------------------------------------
const helpDialog = $<HTMLDialogElement>('help');
const helpBtn = $<HTMLButtonElement>('btn-help');
const openHelp = () => {
  if (!helpDialog.open) helpDialog.showModal();
};
helpBtn.onclick = openHelp;
$('btn-help-close').onclick = () => helpDialog.close();
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog) helpDialog.close(); // click on the backdrop
});
helpDialog.addEventListener('close', () => helpBtn.focus());

const soundBtn = $<HTMLButtonElement>('btn-sound');
soundBtn.onclick = () => {
  feedback.soundOn = !feedback.soundOn;
  soundBtn.setAttribute('aria-pressed', String(feedback.soundOn));
  if (feedback.soundOn) feedback.answer();
};

$('btn-export').onclick = () => {
  const a = document.createElement('a');
  a.download = 'calcink.png';
  a.href = canvas.exportPng([results.canvas], getComputedStyle(paper).getPropertyValue('--sheet').trim() || '#fffdf7');
  a.click();
};

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (helpDialog.open) return; // the modal handles Esc itself; no drawing shortcuts behind it
  if (e.key === 'Escape') setReadingOpen(false);
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'l') {
    // Clear everything. It is a normal undoable edit, so Ctrl+Z brings the page back.
    e.preventDefault();
    if (!doc.isEmpty) clearBtn.click();
  } else if (mod && k === 'z') {
    e.preventDefault();
    e.shiftKey ? doc.redo() : doc.undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    doc.redo();
  } else if (!mod) {
    if (k === 'p') setTool('pen');
    else if (k === 'e') setTool('stroke-eraser');
    else if (k === 'h') setTool('pan');
    else if (k === 'f') hud.toggle();
    else if (k === 'r') setReadingOpen(readingPanel.dataset.open !== 'true');
    else if (k === '?') openHelp();
    else if (k >= '1' && k <= '5') setColor(COLOR_ORDER[Number(k) - 1]);
  }
});

// ---- connectivity chip + service worker -----------------------------------------------------
let offlineReady = false;
function syncNet() {
  const online = navigator.onLine;
  chipNet.dataset.state = online ? (offlineReady ? 'offline-ready' : 'online') : 'offline';
  chipNet.textContent = !online ? 'Offline – still working' : offlineReady ? 'Works offline' : 'Online';
}
window.addEventListener('online', syncNet);
window.addEventListener('offline', syncNet);
syncNet();
registerSW({
  immediate: true,
  onOfflineReady() {
    offlineReady = true;
    syncNet();
  },
});

// ---- boot -----------------------------------------------------------------------------------
doc.load(loadPage());
syncButtons();
client
  .start()
  .then(() => schedule())
  .catch(() => {
    /* status chip already shows the error */
  });

// Test/debug hook (read-only handles; no effect on users).
(window as unknown as Record<string, unknown>).__calcink = { doc, client, hud };
