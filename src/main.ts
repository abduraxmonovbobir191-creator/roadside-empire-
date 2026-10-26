import "@fontsource-variable/urbanist";
import "./style.css";
import * as THREE from "three";
import { createWorld, DT, initPhysics } from "./sim/physics";
import { Stage } from "./render/scene";
import { StationView } from "./render/world";
import { makeCar, MAT, type CarView } from "./render/carMesh";
import { Traffic, type Car } from "./game/traffic";
import { SLOTS, TILL } from "./game/layout";
import * as eco from "./game/economy";
import { initAds, maybeInterstitial, setNoAds, showBanner, showRewarded } from "./ads";
import { duration, h, money } from "./ui/format";
import { sfx } from "./audio";

const SAVE_KEY = "roadside-empire:v1";
const DAY_SECONDS = 600; // one full day-night cycle in real seconds
const BOOST_MS = 5 * 60 * 1000;
const BOOST_CAP_MS = 30 * 60 * 1000;

function loadState(): eco.State {
  try {
    return eco.load(localStorage.getItem(SAVE_KEY));
  } catch {
    return eco.newState();
  }
}

type Info = { name: string; icon: string; effect: (s: eco.State) => string };
const INFO: Record<eco.UpgradeId, Info> = {
  pumps: { name: "Kolonkalar", icon: "⛽", effect: (s) => `${s.levels.pumps} / ${eco.MAX_PUMPS} ta` },
  flow: { name: "Quyish tezligi", icon: "🚀", effect: (s) => `${eco.flowRate(s).toFixed(1)} L/s` },
  price: { name: "Yoqilg'i narxi", icon: "💲", effect: (s) => `$${eco.fuelPrice(s).toFixed(2)} / litr` },
  sign: { name: "Reklama taxtasi", icon: "🪧", effect: (s) => `${Math.round(eco.pullInChance(s) * 100)}% mashina kiradi` },
  shop: {
    name: "Do'kon",
    icon: "🛒",
    effect: (s) => (s.levels.shop === 0 ? "Yopiq" : `xarid ~$${money(eco.shopSpend(s, 0))}`),
  },
  cashier: { name: "Kassir", icon: "🧾", effect: (s) => (s.levels.cashier ? "Pul o'zi yig'iladi" : "Pulni o'zingiz yig'asiz") },
  attendant: { name: "Quyuvchi xodim", icon: "👷", effect: (s) => `xizmat ${eco.handlingTime(s).toFixed(1)} s` },
};
const ORDER: eco.UpgradeId[] = ["pumps", "flow", "price", "sign", "cashier", "shop", "attendant"];

class Game {
  state = loadState();
  stage: Stage;
  world = createWorld();
  station: StationView;
  traffic: Traffic;
  views = new Map<number, CarView>();
  ui = document.getElementById("ui")!;
  private acc = 0;
  private last = performance.now();
  private t = 0;
  private hour = 14;
  private fixedHour = new URLSearchParams(location.search).get("hour");
  private rateAcc = 0;
  private rateTimer = 0;
  private saveTimer = 0;
  private hudTimer = 0;
  private hiddenAt = 0;
  private tags = new Map<number, HTMLElement>();
  private tmp = new THREE.Vector3();
  private el: Record<string, HTMLElement> = {};
  private sheet: HTMLElement | null = null;
  private sheetKind = "";

  constructor() {
    this.stage = new Stage(document.getElementById("scene") as HTMLCanvasElement);
    this.station = new StationView(this.world);
    this.stage.scene.add(this.station.group);
    this.traffic = new Traffic(this.world, {
      pullInChance: () => eco.pullInChance(this.state),
      pumps: () => this.state.levels.pumps,
      serviceTime: (l) => eco.serviceTime(this.state, l),
      onPaid: (car, slot) => this.paid(car, slot),
      onMissed: () => {
        this.state.missed++;
      },
      onSpawn: (car) => this.spawnView(car),
      onDespawn: (car) => this.removeView(car),
    });
    this.applyChapter();
    // warm up: fill the highway before the first frame
    for (let i = 0; i < 60 * 25; i++) this.simStep();
    this.buildHud();
    this.hud();
    document.addEventListener("visibilitychange", () => this.visibility());
    addEventListener("pagehide", () => this.save());
  }

  private applyChapter() {
    this.traffic.interval = Math.max(2.4, 5.5 - 0.7 * (this.state.chapter - 1));
  }

  private spawnView(car: Car) {
    const v = makeCar(car.vehicle.spec, car.color);
    this.views.set(car.id, v);
    this.stage.scene.add(v.root);
  }

  private removeView(car: Car) {
    const v = this.views.get(car.id);
    if (v) this.stage.scene.remove(v.root);
    this.views.delete(car.id);
    this.tags.get(car.id)?.remove();
    this.tags.delete(car.id);
  }

  private paid(car: Car, slot: (typeof SLOTS)[number]) {
    const amount = eco.payForCar(this.state, car.litres, Math.random(), Date.now());
    this.rateAcc += amount;
    const where = this.state.levels.cashier ? new THREE.Vector3(slot.x, 2.6, slot.z) : new THREE.Vector3(TILL.x, 1.8, TILL.z);
    this.floatText(`+$${money(amount)}`, where);
    if (this.state.levels.cashier) sfx.coin();
  }

  private simStep() {
    this.traffic.step();
    this.world.step();
    this.traffic.cleanup();
  }

  // ---------------------------------------------------------------- loop
  frame = (now: number) => {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was in the background: don't fast-forward physics
    this.t += dt;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 5) {
      this.simStep();
      this.acc -= DT;
      n++;
    }
    if (n === 5) this.acc = 0;

    this.rateTimer += dt;
    if (this.rateTimer >= 1) {
      eco.trackRate(this.state, this.rateAcc, this.rateTimer);
      this.rateAcc = 0;
      this.rateTimer = 0;
    }
    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.save();
    }

    this.hour = this.fixedHour !== null ? Number(this.fixedHour) : (this.hour + dt * (24 / DAY_SECONDS)) % 24;
    this.stage.setHour(this.hour);
    MAT.head.emissiveIntensity = 0.6 + 4 * this.stage.night;
    MAT.tail.emissiveIntensity = 0.25 + 1.2 * this.stage.night;
    this.syncCars();
    this.station.update({
      night: this.stage.night,
      pumps: this.state.levels.pumps,
      shop: this.state.levels.shop,
      sign: this.state.levels.sign,
      attendant: this.state.levels.attendant,
      priceText: eco.fuelPrice(this.state).toFixed(2),
      till: this.state.till,
      t: this.t,
    });
    this.stage.update();
    this.stage.render();
    this.hudTimer += dt;
    if (this.hudTimer > 0.2) {
      this.hudTimer = 0;
      this.hud();
    }
    this.worldTags();
    requestAnimationFrame(this.frame);
  };

  private syncCars() {
    for (const car of this.traffic.cars) {
      const v = this.views.get(car.id);
      if (!v) continue;
      const p = car.vehicle.body.translation();
      const q = car.vehicle.body.rotation();
      v.root.position.set(p.x, p.y, p.z);
      v.root.quaternion.set(q.x, q.y, q.z, q.w);
      for (let i = 0; i < 4; i++) {
        const w = car.vehicle.wheel(i);
        const wv = v.wheels[i];
        wv.steer.position.set(w.x, w.y, w.z);
        wv.steer.rotation.y = w.steer;
        wv.spin.rotation.z = -w.spin;
      }
      v.tail.material = car.vehicle.brake > 0.05 ? MAT.brake : MAT.tail;
    }
  }

  // ---------------------------------------------------------------- HUD
  private buildHud() {
    const ui = this.ui;
    const top = h("div", "top");
    const moneyPill = h("div", "pill money", `<span class="coin">$</span><span id="m"></span>`);
    const rate = h("div", "pill rate", "");
    top.append(moneyPill, rate, h("div", "spacer"));
    ui.append(top);
    const chapter = h("div", "pill chapter", `<div class="label">Bob <b id="ch"></b></div><div class="bar"><i id="chbar"></i></div><div class="label" id="chpct"></div>`);
    chapter.addEventListener("click", () => this.openGoals());
    ui.append(chapter);

    const side = h("div", "side");
    const boost = h("button", "round", `<span class="ico">⚡</span><span id="boostTxt">x2</span><span class="ad-chip">AD</span>`) as HTMLButtonElement;
    boost.addEventListener("click", () => this.watchBoost());
    const gift = h("button", "round", `<span class="ico">🎁</span><span id="giftTxt">Sovg'a</span><span class="ad-chip">AD</span>`) as HTMLButtonElement;
    gift.addEventListener("click", () => this.watchGift());
    const goals = h("button", "round", `<span class="ico">📋</span>Vazifa<span class="badge" id="goalBadge"></span>`);
    goals.addEventListener("click", () => this.openGoals());
    const mute = h("button", "round", `<span class="ico">${sfx.muted ? "🔇" : "🔊"}</span>Ovoz`);
    mute.addEventListener("click", () => {
      sfx.setMuted(!sfx.muted);
      mute.querySelector(".ico")!.textContent = sfx.muted ? "🔇" : "🔊";
      sfx.tap();
    });
    side.append(boost, gift, goals, mute);
    addEventListener("pointerdown", () => sfx.unlock(), { once: true });
    ui.append(side);

    const bottom = h("div", "bottom");
    const up = h("button", "btn gold wide", `Yaxshilash<span class="sub" id="upSub"></span>`);
    up.addEventListener("click", () => this.openUpgrades());
    bottom.append(up);
    ui.append(bottom);

    const tags = h("div", "");
    tags.style.cssText = "position:absolute;inset:0;pointer-events:none";
    tags.id = "tags";
    ui.append(tags);

    const till = h("div", "tag", `<button class="till-btn"></button>`);
    till.querySelector("button")!.addEventListener("click", () => this.collect());
    tags.append(till);
    const buy = h("div", "tag", `<button class="buy-tag"></button>`);
    buy.querySelector("button")!.addEventListener("click", () => this.buy("pumps"));
    tags.append(buy);

    this.el = {
      m: moneyPill.querySelector("#m")!,
      rate,
      ch: chapter.querySelector("#ch")!,
      chbar: chapter.querySelector("#chbar")!,
      chpct: chapter.querySelector("#chpct")!,
      boost,
      boostTxt: boost.querySelector("#boostTxt")!,
      gift,
      giftTxt: gift.querySelector("#giftTxt")!,
      goalBadge: goals.querySelector("#goalBadge")!,
      upSub: up.querySelector("#upSub")!,
      tags,
      till,
      tillBtn: till.querySelector("button")!,
      buy,
      buyBtn: buy.querySelector("button")!,
    };
  }

  private hud() {
    const s = this.state;
    const now = Date.now();
    this.el.m.textContent = money(s.money);
    this.el.rate.textContent = `$${money(s.rate)}/s`;
    this.el.ch.textContent = String(s.chapter);
    this.el.chbar.style.width = `${Math.round(eco.chapterProgress(s) * 100)}%`;
    this.el.chpct.textContent = `${s.goalsClaimed.length}/${eco.GOALS.length}`;
    const boostLeft = s.boostUntil - now;
    this.el.boostTxt.textContent = boostLeft > 0 ? duration(boostLeft / 1000).replace(/ \d+ s$/, "") : "x2";
    this.el.boost.classList.toggle("hot", boostLeft > 0);
    const giftIn = s.giftReadyAt - now;
    (this.el.gift as HTMLButtonElement).disabled = giftIn > 0;
    this.el.giftTxt.textContent = giftIn > 0 ? `${Math.ceil(giftIn / 1000)}s` : "Sovg'a";
    this.el.gift.classList.toggle("hot", giftIn <= 0);
    const claimable = eco.GOALS.filter((g) => !s.goalsClaimed.includes(g.id) && g.done(s)).length;
    this.el.goalBadge.textContent = String(claimable);
    this.el.goalBadge.style.display = claimable ? "grid" : "none";
    const affordable = ORDER.filter((id) => eco.canBuy(s, id)).length;
    this.el.upSub.textContent = affordable ? `${affordable} ta yaxshilash mavjud` : "Pul yig'ing";
    this.el.tillBtn.textContent = `Yig'ish $${money(s.till)}`;
    const nextPump = s.levels.pumps < eco.MAX_PUMPS ? eco.upgradeCost(s, "pumps") : Infinity;
    this.el.buyBtn.innerHTML = Number.isFinite(nextPump) ? `⛽ Yangi kolonka<br>$${money(nextPump)}` : "";
    this.el.buyBtn.classList.toggle("off", s.money < nextPump);
    if (this.sheet) this.refreshSheet();
    if (!s.goalsClaimed.length || !eco.chapterComplete(s)) return;
    if (!document.querySelector(".modal-wrap")) this.chapterDone();
  }

  /** Labels that follow 3D points: till cash, next-pump price, fuelling progress rings. */
  private worldTags() {
    const s = this.state;
    const place = (el: HTMLElement, v: THREE.Vector3, show: boolean) => {
      const p = show ? this.stage.project(v, this.tmp) : null;
      if (!p) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    };
    place(this.el.till, new THREE.Vector3(TILL.x, 2.2, TILL.z), s.levels.cashier === 0 && s.till > 0);
    const slot = SLOTS[s.levels.pumps];
    place(this.el.buy, slot ? new THREE.Vector3(slot.x, 1.2, slot.z) : this.tmp, !!slot);

    const seen = new Set<number>();
    for (const car of this.traffic.cars) {
      if (car.state !== "fueling") continue;
      seen.add(car.id);
      let tag = this.tags.get(car.id);
      if (!tag) {
        tag = h("div", "tag", `<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="rgba(0,0,0,.55)" stroke="#2a2d33" stroke-width="4"/><circle class="p" cx="18" cy="18" r="15" fill="none" stroke="#ffc93c" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.2" transform="rotate(-90 18 18)"/><text x="18" y="22.5" text-anchor="middle" font-size="12" font-weight="900" fill="#fff">⛽</text></svg>`);
        this.el.tags.append(tag);
        this.tags.set(car.id, tag);
      }
      const p = car.vehicle.position();
      place(tag, new THREE.Vector3(p.x, p.y + car.vehicle.spec.height + 0.6, p.z), true);
      const done = 1 - Math.max(0, car.timer) / car.serviceTotal;
      (tag.querySelector(".p") as SVGCircleElement).setAttribute("stroke-dashoffset", String(94.2 * (1 - done)));
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.remove();
        this.tags.delete(id);
      }
    }
  }

  private floatText(text: string, at: THREE.Vector3) {
    const p = this.stage.project(at, this.tmp);
    if (!p) return;
    const el = h("div", "tag", `<div class="float">${text}</div>`);
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    this.el.tags.append(el);
    setTimeout(() => el.remove(), 1400);
  }

  toast(text: string) {
    const t = h("div", "toast", text);
    this.ui.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------------------------------------------------------------- actions
  private collect() {
    const got = eco.collectTill(this.state);
    if (got > 0) sfx.coin();
    if (got > 0) this.floatText(`+$${money(got)}`, new THREE.Vector3(TILL.x, 2.4, TILL.z));
    this.hud();
  }

  private buy(id: eco.UpgradeId) {
    if (!eco.buy(this.state, id)) {
      sfx.deny();
      this.toast("Pul yetmaydi");
      return;
    }
    sfx.buy();
    if (id === "pumps") {
      const slot = SLOTS[this.state.levels.pumps - 1];
      this.floatText("Yangi kolonka!", new THREE.Vector3(slot.x, 3, slot.z));
    }
    this.save();
    this.hud();
  }

  private async watchBoost() {
    const s = this.state;
    if (s.boostUntil - Date.now() > BOOST_CAP_MS - BOOST_MS) {
      this.toast("x2 allaqachon to'liq");
      return;
    }
    if (!(await showRewarded())) return;
    s.boostUntil = Math.max(Date.now(), s.boostUntil) + BOOST_MS;
    sfx.reward();
    this.toast("5 daqiqa x2 daromad!");
    this.save();
  }

  private async watchGift() {
    const s = this.state;
    if (Date.now() < s.giftReadyAt) return;
    if (!(await showRewarded())) return;
    const amount = eco.giftAmount(s);
    eco.credit(s, amount);
    s.giftReadyAt = Date.now() + eco.GIFT_COOLDOWN_MS;
    sfx.reward();
    this.modal(`<h3>🎁 <b>Sovg'a</b></h3><div class="big">+$${money(amount)}</div>`, [{ text: "Zo'r!", cls: "gold" }]);
    this.save();
  }

  // ---------------------------------------------------------------- sheets & modals
  private closeSheet() {
    this.sheet?.remove();
    this.sheet = null;
    this.sheetKind = "";
  }

  private openSheet(kind: string, title: string) {
    this.closeSheet();
    const wrap = h("div", "sheet-wrap");
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) this.closeSheet();
    });
    const sheet = h("div", "sheet", `<div class="grab"></div><h2>${title}</h2><div class="list"></div>`);
    wrap.append(sheet);
    this.ui.append(wrap);
    this.sheet = wrap;
    this.sheetKind = kind;
    this.refreshSheet(true);
  }

  private openUpgrades() {
    this.openSheet("upgrades", "Stansiyani <b>yaxshilash</b>");
  }

  private openGoals() {
    this.openSheet("goals", `${this.state.chapter}-bob <b>vazifalari</b>`);
  }

  private refreshSheet(build = false) {
    const list = this.sheet?.querySelector(".list") as HTMLElement | null;
    if (!list) return;
    const s = this.state;
    if (this.sheetKind === "upgrades") {
      if (build) {
        list.innerHTML = "";
        for (const id of ORDER) {
          const card = h("div", "card", `<div class="icon">${INFO[id].icon}</div><div class="info"><div class="name">${INFO[id].name}</div><div class="lvl"></div><div class="effect"></div></div><button class="btn gold"></button>`);
          card.dataset.id = id;
          card.querySelector("button")!.addEventListener("click", () => this.buy(id));
          list.append(card);
        }
      }
      for (const card of list.querySelectorAll<HTMLElement>(".card")) {
        const id = card.dataset.id as eco.UpgradeId;
        const lvl = s.levels[id];
        const max = eco.UPGRADES[id].max;
        const cost = eco.upgradeCost(s, id);
        card.querySelector(".lvl")!.textContent = max === 1 ? (lvl ? "Yollangan" : "Yollanmagan") : `Daraja ${lvl} / ${max}`;
        card.querySelector(".effect")!.textContent = INFO[id].effect(s);
        const b = card.querySelector("button") as HTMLButtonElement;
        b.textContent = Number.isFinite(cost) ? `$${money(cost)}` : "MAX";
        b.disabled = !eco.canBuy(s, id);
        card.classList.toggle("done", !Number.isFinite(cost));
      }
    } else if (this.sheetKind === "goals") {
      if (build) {
        list.innerHTML = "";
        for (const g of eco.GOALS) {
          const card = h("div", "card", `<div class="icon">🏁</div><div class="info"><div class="name">${g.text}</div><div class="effect"></div></div><button class="btn green">Olish</button>`);
          card.dataset.id = String(g.id);
          card.querySelector("button")!.addEventListener("click", () => {
            const got = eco.claimGoal(this.state, g.id);
            if (got) this.toast(`+$${money(got)}`);
            this.save();
            this.hud();
          });
          list.append(card);
        }
      }
      for (const card of list.querySelectorAll<HTMLElement>(".card")) {
        const g = eco.GOALS.find((x) => x.id === Number(card.dataset.id))!;
        const claimed = s.goalsClaimed.includes(g.id);
        card.querySelector(".effect")!.textContent = claimed ? "Bajarildi" : `Mukofot: $${money(g.reward(s))}`;
        const b = card.querySelector("button") as HTMLButtonElement;
        b.disabled = claimed || !g.done(s);
        b.textContent = claimed ? "✓" : "Olish";
        card.classList.toggle("done", claimed);
      }
    }
  }

  private modal(html: string, buttons: { text: string; cls: string; onClick?: () => void | Promise<void> }[]) {
    const wrap = h("div", "modal-wrap");
    const box = h("div", "modal", html);
    const row = h("div", "row");
    for (const b of buttons) {
      const btn = h("button", `btn ${b.cls}`, b.text);
      btn.addEventListener("click", async () => {
        wrap.remove();
        await b.onClick?.();
        this.hud();
      });
      row.append(btn);
    }
    box.append(row);
    wrap.append(box);
    this.ui.append(wrap);
  }

  private chapterDone() {
    this.closeSheet();
    this.modal(
      `<h3>🏆 <b>${this.state.chapter}-bob yakunlandi!</b></h3><p>Yangi, gavjumroq yo'l ochildi. Hamma narx va daromad 3 baravar katta. Yaxshilashlar boshidan boshlanadi.</p>`,
      [
        {
          text: "Yangi yo'lga o'tish",
          cls: "gold",
          onClick: async () => {
            await maybeInterstitial();
            eco.nextChapter(this.state);
            this.applyChapter();
            this.save();
          },
        },
      ],
    );
  }

  offline(seconds: number, amount: number) {
    if (amount <= 0) return;
    const s = this.state;
    this.modal(
      `<h3>Xush <b>kelibsiz!</b></h3><p>Siz ${duration(seconds)} yo'q edingiz. Kassir ishladi:</p><div class="big">+$${money(amount)}</div>`,
      [
        {
          text: `x2 olish ($${money(amount * 2)}) · reklama`,
          cls: "gold",
          onClick: async () => {
            const ok = await showRewarded();
            eco.credit(s, ok ? amount * 2 : amount);
            this.save();
            setTimeout(() => this.maybeDaily(), 400);
          },
        },
        {
          text: "Olish",
          cls: "ghost",
          onClick: async () => {
            eco.credit(s, amount);
            this.save();
            if (seconds > 600) await maybeInterstitial();
            setTimeout(() => this.maybeDaily(), 400);
          },
        },
      ],
    );
  }

  /** Daily streak gift: once per local day, x2 when the player watches an ad. */
  maybeDaily() {
    const day = eco.dailyNext(this.state, Date.now());
    if (day === null || document.querySelector(".modal-wrap")) return;
    const amount = eco.dailyAmount(this.state, day);
    const dots = Array.from({ length: 7 }, (_, i) => `<span style="display:inline-block;width:26px;height:26px;border-radius:50%;margin:0 3px;line-height:26px;font-size:12px;font-weight:900;${i < day ? "background:#4cd27a;color:#08331a" : i === day ? "background:#ffc93c;color:#3b2a00" : "background:#2a2d33;color:#8b8f97"}">${i + 1}</span>`).join("");
    this.modal(
      `<h3>📅 <b>Kunlik sovg'a</b></h3><p>Ketma-ket ${day + 1}-kun. Har kuni kirsangiz sovg'a kattalashadi.</p><div>${dots}</div><div class="big">+$${money(amount)}</div>`,
      [
        {
          text: `x2 olish ($${money(amount * 2)}) · reklama`,
          cls: "gold",
          onClick: async () => {
            const ok = await showRewarded();
            const got = eco.claimDaily(this.state, Date.now(), ok);
            sfx.reward();
            this.toast(`+$${money(got)}`);
            this.save();
          },
        },
        {
          text: "Olish",
          cls: "ghost",
          onClick: () => {
            const got = eco.claimDaily(this.state, Date.now(), false);
            sfx.reward();
            this.toast(`+$${money(got)}`);
            this.save();
          },
        },
      ],
    );
  }

  private visibility() {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      this.save();
      return;
    }
    if (this.hiddenAt) {
      const { seconds, amount } = eco.offlineEarnings(this.state, Date.now());
      this.hiddenAt = 0;
      this.state.savedAt = Date.now();
      if (amount > 0) this.offline(seconds, amount);
    }
  }

  save() {
    this.state.savedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      /* private mode: play without saving */
    }
  }
}

async function boot() {
  await initPhysics();
  const game = new Game();
  const { seconds, amount } = eco.offlineEarnings(game.state, Date.now());
  game.state.savedAt = Date.now();
  requestAnimationFrame(game.frame);
  document.getElementById("boot")!.classList.add("hide");
  setTimeout(() => document.getElementById("boot")?.remove(), 600);
  await initAds(game.state.noAds);
  setNoAds(game.state.noAds);
  void showBanner(true);
  if (amount > 0) game.offline(seconds, amount);
  else setTimeout(() => game.maybeDaily(), 1200);
}

void boot();
