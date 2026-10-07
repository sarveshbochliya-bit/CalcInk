# PS compliance audit

Status key: **TESTED** = verified by an automated test or a measured run in this environment · **SHOULD WORK** = implemented, not verifiable here · **MANUAL** = needs a human action.

| Requirement (PS §) | Implementation | Status | Evidence |
|---|---|---|---|
| Canvas: mouse / stylus / touch (2) | Pointer Events, pressure, pen-eraser, palm rejection, `touch-action:none` | TESTED (mouse) · SHOULD WORK (touch, stylus) | e2e draws with real mouse events; touch/stylus not run on hardware |
| Smooth low-latency curves (2) | Quadratic smoothing, rAF-batched incremental painting, coalesced events | TESTED | e2e frame test p95 16.8 ms |
| Undo / redo (2) | Command history, grouped eraser drags | TESTED | `tests/document.test.ts`, e2e undo/redo |
| Stroke eraser + pixel eraser (2) | `strokesTouching`, `erasePixels` (splits strokes) | TESTED | `tests/geometry.test.ts`; e2e stroke eraser edit |
| Clear, stroke width (2) | Toolbar + slider | TESTED (clear) · SHOULD WORK (slider) | e2e clear; slider manual |
| High-DPI `devicePixelRatio` (2) | `backingStore()`, DPR media-query watcher, ResizeObserver | TESTED (maths) · SHOULD WORK (real Retina) | `tests/geometry.test.ts` |
| Recognise 0–9, + − × ÷ . = (2) | symbols16 + MNIST CNNs + shape priors | TESTED (simulated ink) | 100 % / 94.7 % equations on 150+150 synthetic equations (`npm run test:eval`); not human data |
| Existing open-source pretrained model (2, 4) | Two pretrained ONNX models, no training | TESTED | README → Model Attribution |
| Multi-digit, decimals, negatives (2) | Tokenizer + parser | TESTED | `tests/math.test.ts` |
| BODMAS/PEMDAS (2) | Recursive descent | TESTED | `tests/math.test.ts` (`18+4×3`=30, `2+3×4`=14, `10÷2+5`=10) |
| Answer projected next to `=` (2) | `describeRows` + `ResultsLayer` | TESTED | e2e + screenshots |
| Reactive editing (2) | Debounced re-recognition, per-symbol cache | TESTED | e2e `5÷0` → erase `0` → `5÷4=1.25` |
| 100 % on-device, zero cloud APIs (3) | ORT Web WASM in Worker, no network code | TESTED | e2e asserts no request leaves the origin |
| Offline after first load (3) | Workbox precache of app + WASM + models + fonts | TESTED (Chromium) | e2e reloads with network disabled and solves `12.5+3.5=` |
| 60 FPS, inference never blocks UI (3) | Web Worker, transferables, rAF painting, debounce | TESTED (headless Chromium) | p95 16.8 ms, worst 16.8 ms while recognising |
| No `eval()` (3) | Hand-written parser | TESTED | code audit: `grep -rn "eval(" src` matches only a comment saying it is never used |
| `Undefined` for ÷0; malformed handled (3) | `MathError` values, never thrown to UI | TESTED | `tests/math.test.ts`; e2e shows “Undefined” |
| Test suites incl. parser, ÷0, coordinates (6) | 95 unit + 2 eval + 3 e2e | TESTED | `npm test`, `npm run test:e2e` |
| README with quick start + model attribution (5) | `README.md` | TESTED (reviewed) | source link, licence, architecture present |
| Architecture + model justification (6) | `ARCHITECTURE.md`, README *ML Model* | TESTED (reviewed) | alternatives + rationale documented |
| Memory stability, no leaks in long sessions (6) | Bounded history/cache, disposers, AbortController | SHOULD WORK | not profiled for long sessions |
| Clean GitHub repo, balanced team commits (5, 6) | Commit plan provided | MANUAL | you create the repo and commits |
| Public live deployment link (5) | Vercel/Netlify/Pages configs | MANUAL | needs your account; see README → Deployment |
| UX extras (6) | Scratch-to-erase, ✓/✗ check, confidence bars, sound/haptics, dark mode, PWA | TESTED (build + screenshots) · SHOULD WORK (audio/haptics) | `docs/screenshots/` |
