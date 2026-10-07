# CalcInk - Handwritten Math Calculator

Write an equation like `18 + 4 x 3 =` with your mouse, stylus, or finger, and the answer appears directly on the page. Edit any number and the answer updates instantly. Everything runs completely **inside your browser** with **no network needed** after the first load.

Built for the Inter IIT Tech Meet 15.0 Bootcamp, this project is a fully offline, privacy-first, on-device smart calculator.

## Overview

| Feature | Detail |
|---|---|
| Input | Mouse, touch, stylus (pressure support), and palm rejection |
| AI Recognition | Two open-source pretrained models run with **ONNX Runtime Web** inside a Web Worker |
| Math Engine | Hand-written parser. **No eval() is used.** Safely evaluates BODMAS/PEMDAS |
| Fully Offline | Service worker precaches everything (~23 MB). Works without internet! |
| No Backend | 100% static files. No API keys, no servers, absolute privacy |

## Core Features

* **Infinite Digital Canvas**: Scroll endlessly! The canvas dynamically grows as you scroll down, allowing you to write as many equations as you want on a single page.
* **Pan Tool**: Easily navigate around your infinite canvas using the Pan tool (shortcut `H`).
* **Calculation History**: Every successful calculation is logged with a timestamp in the History tab on the right panel, so you never lose track of past work.
* **Locked Dark Mode**: A beautiful, distraction-free dark theme that stays consistent regardless of your operating system settings.
* **Smart Erasing**: Use the dedicated eraser or simply scribble back and forth over your ink to delete it instantly.
* **Reactive Math**: Erase a digit, write a new one, and the entire equation re-evaluates automatically. 
* **Reliable Errors**: Division by zero shows "Undefined", and messy handwriting shows an "unsure" warning so you know when to rewrite clearly.

## Architecture & Tech Stack

This project is built using:
* **TypeScript** for strict type safety
* **Vite** for fast bundling
* **Vanilla DOM + Canvas 2D** for blazing fast 60 fps rendering (no heavy UI frameworks)
* **ONNX Runtime Web** to run machine learning models purely in the browser

## Keyboard Shortcuts

The app supports fast keyboard navigation:

* `P` : Pen
* `E` : Eraser
* `H` : Pan
* `1` to `5` : Change ink color (Black, Blue, Green, Red, Purple)
* `Ctrl+Z` : Undo
* `Ctrl+Shift+Z` / `Ctrl+Y` : Redo
* `Ctrl+L` : Clear the entire canvas
* `R` : Show or hide the side panel
* `F` : Show frame rate details
* `?` : Open the Help menu

## ML Models Used

Recognition relies on a small ensemble of pretrained, open-source models (nothing trained from scratch):
1. **Symbols16 CNN (9.3 MB)**: Decides what kind of symbol is drawn (digit vs operator vs decimal).
2. **MNIST CNN (26 KB)**: A specialist model that determines exactly *which* digit is written.
3. **Shape Prior Algorithm**: Softly re-weights votes based on stroke count and geometry (e.g., an equals sign "=" is always two strokes).

## How to Run Locally

You need Node.js installed on your computer.

1. Clone or download the repository.
2. Open your terminal in the project folder.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to start the local development server.
5. Open the link provided in the terminal (usually `http://localhost:5173`).

The model files are already in the `public/models/` folder, so no extra downloads are required!

## Deployment

Deploying is incredibly easy since it is just a static site. 
If you are using **Vercel**, just import the GitHub repository, ensure the framework preset is set to Vite, and click "Deploy". Vercel will automatically run `npm run build` and publish the `dist` folder. 

No environment variables or secrets are needed.
