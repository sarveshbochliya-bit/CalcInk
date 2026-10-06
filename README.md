# CalcInk
On - device Handwritten Math Calculator
...
calcink/
├── .github/CODEOWNERS      # per-folder review ownership (teamwork points)
├── src/
│   ├── types.ts            # shared contracts: ALL 3 must approve changes
│   ├── canvas/index.ts     # Member A: InkCanvas interface (stub)
│   ├── recognition/index.ts# Member B: mock recognizer (returns [])
│   ├── math/index.ts       # Member C: evaluate() stub
│   └── main.ts             # wiring (step 6)
├── tests/contracts.test.ts
├── index.html, vite.config.ts, tsconfig.json, package.json
└── README.md               # quick start + ownership table
...
