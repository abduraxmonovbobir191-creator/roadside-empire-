import { Capacitor } from "@capacitor/core";

/**
 * Ads behind one small interface. On Android (Capacitor) it uses AdMob; in the browser it shows a
 * short stand-in so every reward flow can be played and tested.
 * Ad unit ids come from build-time env (VITE_ADMOB_*); without them Google's public TEST ids are used,
 * which never pay out. Real ids are not secrets, but they belong to the owner's AdMob account.
 */
const TEST = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
};

const IDS = {
  banner: import.meta.env.VITE_ADMOB_BANNER || TEST.banner,
  interstitial: import.meta.env.VITE_ADMOB_INTERSTITIAL || TEST.interstitial,
  rewarded: import.meta.env.VITE_ADMOB_REWARDED || TEST.rewarded,
};
const TESTING = !import.meta.env.VITE_ADMOB_REWARDED;

/** At most one interstitial every 3 minutes, never in the first 2 minutes of a session. */
const INTERSTITIAL_GAP_MS = 3 * 60 * 1000;

type AdMobModule = typeof import("@capacitor-community/admob");

let admob: AdMobModule | null = null;
let ready = false;
let lastInterstitial = Date.now() - INTERSTITIAL_GAP_MS + 2 * 60 * 1000;
let noAds = false;

export const native = Capacitor.isNativePlatform();

export async function initAds(disableAds: boolean) {
  noAds = disableAds;
  if (!native) return;
  try {
    admob = await import("@capacitor-community/admob");
    await admob.AdMob.initialize({ initializeForTesting: TESTING });
    // EU / UK users: Google's consent form (UMP) before personalised ads
    const info = await admob.AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === admob.AdmobConsentStatus.REQUIRED) {
      await admob.AdMob.showConsentForm();
    }
    ready = true;
    void preloadRewarded();
    if (!noAds) void preloadInterstitial();
  } catch {
    ready = false;
  }
}

async function preloadRewarded() {
  try {
    await admob?.AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });
  } catch {
    /* no fill: try again on the next request */
  }
}

async function preloadInterstitial() {
  try {
    await admob?.AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
  } catch {
    /* no fill */
  }
}

export async function showBanner(show: boolean) {
  if (!native || !ready || !admob) return;
  try {
    if (show && !noAds) {
      await admob.AdMob.showBanner({
        adId: IDS.banner,
        adSize: admob.BannerAdSize.ADAPTIVE_BANNER,
        position: admob.BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: TESTING,
      });
    } else await admob.AdMob.hideBanner();
  } catch {
    /* ignore */
  }
}

export function setNoAds(v: boolean) {
  noAds = v;
  if (v) void showBanner(false);
}

/** Interstitial at a natural break (chapter end, returning after a long time away). */
export async function maybeInterstitial(): Promise<void> {
  if (noAds || Date.now() - lastInterstitial < INTERSTITIAL_GAP_MS) return;
  lastInterstitial = Date.now();
  if (!native) return; // the browser build does not interrupt play
  if (!ready || !admob) return;
  try {
    await admob.AdMob.showInterstitial();
  } catch {
    /* not loaded */
  }
  void preloadInterstitial();
}

/** Rewarded video. Resolves true only when the player watched it to the end. */
export async function showRewarded(): Promise<boolean> {
  if (native) {
    if (!ready || !admob) return false;
    try {
      const reward = await admob.AdMob.showRewardVideoAd();
      void preloadRewarded();
      return !!reward;
    } catch {
      void preloadRewarded();
      return false;
    }
  }
  return webStandIn();
}

function webStandIn(): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "ad-standin";
    el.innerHTML = `<div class="ad-box"><div class="ad-tag">Reklama</div><div class="ad-count">5</div><p>Brauzer versiyasi: bu yerda haqiqiy reklama ko'rsatiladi.</p><button class="btn ghost" disabled>Yopish</button></div>`;
    document.body.appendChild(el);
    const count = el.querySelector(".ad-count")!;
    const btn = el.querySelector("button")!;
    let n = 5;
    const tick = setInterval(() => {
      n--;
      count.textContent = String(n);
      if (n <= 0) {
        clearInterval(tick);
        btn.disabled = false;
        btn.textContent = "Mukofotni olish";
      }
    }, 1000);
    btn.addEventListener("click", () => {
      el.remove();
      resolve(n <= 0);
    });
  });
}
