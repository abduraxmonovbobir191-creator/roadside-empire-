# Roadside Empire

Idle tycoon mobile game (roadside fuel station). Vite + TypeScript + three.js + Rapier (WASM) + Capacitor (Android, AdMob). No backend; progress in localStorage.

## Layout
- src/sim: physics only (no rendering). vehicle.ts = real drivetrain/suspension numbers (SI units), driver.ts = AI driver, path.ts = lane centre lines.
- src/game: rules. economy.ts is pure (unit-tested), layout.ts = world coordinates, traffic.ts = spawning, pumps, queues, merging.
- src/render: three.js scene, procedural models and textures (no downloaded assets).
- src/ads.ts: the only place that talks to AdMob. src/main.ts: glue, HUD, loop.

## Rules
1. UI text Uzbek (Latin). Code and commits English.
2. Physics runs at a fixed 60 Hz (DT); never tie it to frame rate. Keep units SI.
3. Economy stays pure and covered by tests/economy.test.ts; traffic changes must keep tests/traffic.test.ts green (no jams, no crashes).
4. Ads: rewarded only on player request; interstitials only at natural breaks, max 1 per 3 min, never in the first 2 min. Real ad ids only via CI secrets.
5. Never commit keystores or secrets. Original names and art only (no other games' brands).

## Commands
npm ci · npx tsc --noEmit · npx vitest run · npm run dev · npm run build · APK: GitHub Actions "Android APK"
