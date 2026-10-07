# Manual test checklist

Run against the production build: `npm run build && npm run preview` (http://localhost:4173). Tick each box.

| # | Area | Steps | Expected |
|---|---|---|---|
| 1 | Draw | Write `18+4×3=` with the mouse | Smooth ink, no lag, crisp on a high-DPI screen |
| 2 | Recognition | Wait ~0.3 s | “What I read” shows `18+4×3=`, confidence bar > 85 % |
| 3 | Calculation | — | **30** appears right of `=` in orange; also try `2+3×4=` (14), `10÷2+5=` (10), `12.5+3.5=` (16), `-5+10=` (5), `9÷0=` (Undefined), `5+=` (Error) |
| 4 | Editing | Erase the `4` (Stroke tool), write `5` | Answer updates to 33 without pressing anything |
| 5 | Undo | Ctrl/Cmd+Z or toolbar | Last stroke (or last whole eraser drag) is reverted; answer updates |
| 6 | Redo | Ctrl/Cmd+Shift+Z or Ctrl+Y | Reapplied |
| 7 | Eraser | Stroke eraser removes whole strokes; Pixel eraser cuts through a stroke; scribble over a number with the pen | Each works; answers update |
| 8 | Clear | Trash button; then Undo | Page empties and the answer disappears; Undo restores it |
| 9 | Resize | Resize the window, rotate a phone, zoom 50–200 % | Ink keeps its position, stays crisp, no blank canvas |
| 10 | Mobile/touch | Phone or tablet: write with finger; with a stylus if available | Works; page does not scroll while writing; palm ignored while pen is used |
| 11 | Offline | Load once online → chip says “Works offline” → airplane mode → reload → write `7×8=` | 56, no errors; DevTools → Network shows no external requests |
| 12 | Performance | Press F; write continuously for a minute | ~60 fps, worst frame near 17 ms, memory (DevTools) stays flat |
| 13 | Persistence | Reload the page | Your ink and answers return |
| 14 | Dark mode | Switch OS to dark | Ink/paper recolour; answers remain readable |

Automated equivalents: `npm run test:unit`, `npm run test:eval`, `npm run test:e2e`.
