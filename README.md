# Roadside Empire

Idle tycoon game: grow a roadside fuel station from one pump into a busy forecourt.
Every car is a real physics vehicle (Rapier ray-cast suspension, torque curve, gearbox, aero drag,
friction-limited brakes, Ackermann steering) driven by an AI driver (pure pursuit + Intelligent Driver Model).

- **Play loop:** cars pull in, fill up, pay → collect cash → upgrade pumps, flow, price, billboard, shop, staff → chapter goals → next, busier road (×3).
- **Retention:** 7-day daily reward streak (x2 with an ad), day-night cycle, synthesized sound effects with a mute button.
- **Monetisation:** rewarded ads (x2 income, gift, x2 offline earnings), interstitial at chapter breaks (max 1 per 3 min), bottom banner. AdMob on Android via Capacitor.
- **Stack:** Vite + TypeScript, three.js (procedural low-poly-realistic models, PBR sky lighting), Rapier 3D (WASM), Capacitor 8.

## Commands

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
npx tsc --noEmit
npx vitest run     # economy + 6-minute traffic simulation
npm run build
```

## Android APK

GitHub Actions → **Android APK** builds a release APK + AAB on every push to `main` and publishes them in Releases.

Optional repository secrets:

| Secret | What |
|---|---|
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | release signing (`scripts/setup-signing.sh`). Without them the APK is debug-signed. |
| `ADMOB_APP_ID` | AdMob app id (`ca-app-pub-…~…`) |
| `ADMOB_BANNER_ID`, `ADMOB_INTERSTITIAL_ID`, `ADMOB_REWARDED_ID` | AdMob ad unit ids |

Without AdMob secrets the build shows Google's **test ads** (no revenue).
