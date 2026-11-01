# SENS/LAB

SENS/LAB is a browser-based CS2 mouse sensitivity calibration tool. It runs a short set of aim exercises, records trial outcomes, and compares nearby in-game sensitivities while preserving the DPI you use.

## Stack

Next.js App Router, React, strict TypeScript, Three.js / React Three Fiber, Drei, Zustand, Framer Motion, Lucide React, and Vitest.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` exports the static site to `out/`; `npm start` serves that export locally. Checks: `npm run typecheck`, `npm run lint`, and `npm test`.

## GitHub Pages

This app runs entirely in the browser and needs no API or server, so it can be hosted as static files. The included GitHub Actions workflow targets the `Mouse_Sens_Calculator` repository name. Push to `main`, then enable GitHub Pages with **GitHub Actions** as the source. To create the deployment artifact locally, run `npm run build:github`; the files are written to `out/`.

## Structure

- `src/app` — App Router entry, visual system, and single-page calibration flow.
- `src/lib/calibration.ts` — CS2 unit conversion and trial scoring.
- `src/lib/store.ts` — browser-persisted settings and trial history.

## How calibration works

The setup screen computes eDPI as DPI × in-game sensitivity and estimates cm/360° using `2.54 × 360 / (DPI × sensitivity × 0.022)`. Before starting, players choose a quick, longer, or longest test. Quick runs one block with five observations per exercise and sensitivity (100 total). Longer runs three randomized blocks with four observations per exercise and sensitivity in each block (240 total). The most accurate test runs five blocks (400 total). Target layouts match across candidates within blocks. Each observation includes hit/miss, acquisition time, angular error when meaningful, corrections, overshoots, and undershoots. Candidate scores weight accuracy (35%), acquisition speed (20%), angular error (20%), corrections (15%), and overshoot rate (10%). Longer-test confidence uses paired differences between matched block scores and a 95% Student-t uncertainty interval for the winner-to-runner-up gap. High confidence requires at least 40 observations for every candidate, all four modes, three blocks, and a score gap larger than that interval. Quick results remain low confidence by design.

Pointer lock requests unadjusted mouse input when the browser supports it. In that mode, camera degrees per mouse count use the CS2 yaw directly: `sensitivity × 0.022°`. If the browser rejects raw input, the fallback treats CSS pixels as counts at 800 DPI and scales by entered DPI; this is an estimate because OS scaling and device behavior vary. DPI is held constant because browser aiming cannot identify a uniquely best physical DPI.

Results are an estimate, not a guaranteed perfect sensitivity. Browser `movementX/Y` behavior can still vary with browser, operating system pointer acceleration, device, and input settings, so the mapping is an estimate and does not reproduce CS2 input exactly. The arena uses pointer lock and is intended for a desktop with a physical mouse. Focus loss and Escape release pointer lock; click the arena to reacquire. Calibration results and settings stay in local browser storage.

## Tests

The project is configured for Vitest. Deterministic math and scoring functions are isolated in `src/lib/calibration.ts`; no real hardware calibration is claimed by software checks.
