/**
 * Bootstrap — loads the level bundle + saved progress, wires the DOM controls
 * and the level-select screen to the Game. Plumbing only; logic lives in the
 * modules.
 */

import { Game, Hud } from './game.js';
import { Renderer } from './render.js';
import { loadBundle } from './levelLoader.js';
import { Progress } from './progress.js';
import { AudioManager } from './sound.js';
import { LevelManager, ManagerRefs } from './leveleditor.js';
import { LevelStore } from './levelStore.js';
import { AssetManager } from './assets.js';
import { Economy, BOOSTER_PRICE, DAILY, BoosterId } from './economy.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

async function boot(): Promise<void> {
  const canvas = el<HTMLCanvasElement>('board');
  const renderer = new Renderer(canvas);

  // Optional sprite layer — loads in parallel with the level bundle; the game
  // renders procedurally until (and unless) assets/manifest.json supplies art.
  const assets = new AssetManager();
  renderer.setAssets(assets);
  const [bundle] = await Promise.all([loadBundle(), assets.load()]);
  const progress = new Progress();
  // The store is the live, persistent library that the manager edits and that
  // the level-select + game read from. Seeded from the shipped bundle.
  const store = new LevelStore(bundle);
  const economy = new Economy();

  const hud: Hud = {
    levelName: el('level-name'),
    budgetUsed: el('budget-used'),
    budgetTotal: el('budget-total'),
    budgetBox: el('budget'),
    toast: el('toast'),
    btnUndo: el<HTMLButtonElement>('btn-undo'),
    btnRedo: el<HTMLButtonElement>('btn-redo'),
    btnPlay: el<HTMLButtonElement>('btn-play'),
    btnStep: el<HTMLButtonElement>('btn-step'),
    btnSpeed: el<HTMLButtonElement>('btn-speed'),
    outcome: {
      panel: el('outcome'),
      title: el('outcome-title'),
      sub: el('outcome-sub'),
      btnReplay: el<HTMLButtonElement>('outcome-replay'),
      btnNext: el<HTMLButtonElement>('outcome-next'),
      btnEdit: el<HTMLButtonElement>('outcome-edit'),
    },
    btnHelp: el<HTMLButtonElement>('btn-help'),
    tutorial: {
      panel: el('tutorial'),
      text: el('tut-text'),
      dots: el('tut-dots'),
      btnSkip: el<HTMLButtonElement>('tut-skip'),
      btnNext: el<HTMLButtonElement>('tut-next'),
    },
  };

  const audio = new AudioManager();
  const game = new Game(canvas, renderer, hud, audio, store.levels(), 0);

  /* ----------------------------- meta screens ----------------------------- */

  const selectEl = el('levelselect');
  const worldsEl = el('ls-worlds');
  const progressEl = el('ls-progress');
  const settingsEl = el('settings');
  const statsEl = el('stats');
  const statsBody = el('stats-body');
  const metanav = el('metanav');
  const homeEl = el('home');
  const shopEl = el('shop');
  const dailyEl = el('daily');
  const scratchEl = el('scratch');
  const metatop = el('metatop');
  const metaTitle = el('meta-title');
  const coinsVal = el('coins-val');
  const gemsVal = el('gems-val');
  const refreshCurrency = (): void => {
    coinsVal.textContent = String(economy.coins);
    gemsVal.textContent = String(economy.gems);
  };

  // shorthand reward icon(s)+amount markup, and a plain-text version for popups
  type Rw = { coins?: number; gems?: number; booster?: string };
  const boosterIcon = (b: string): string => `assets/ui/ic_${b === 'track' ? 'plus' : b}.png`;
  const rewardInner = (r: Rw): string => {
    if (r.booster) return `<img src="${boosterIcon(r.booster)}" alt="" />×1`;
    const parts: string[] = [];
    if (r.coins) parts.push(`<img src="assets/ui/ic_coin.png" alt="" />${r.coins}`);
    if (r.gems) parts.push(`<img src="assets/ui/ic_gem.png" alt="" />${r.gems}`);
    return parts.join(' ');
  };
  const rewardText = (r: Rw): string => {
    if (r.booster) return `a ${r.booster === 'track' ? '+Track' : r.booster} booster`;
    const parts: string[] = [];
    if (r.coins) parts.push(`${r.coins} coins`);
    if (r.gems) parts.push(`${r.gems} gems`);
    return parts.join(' + ');
  };

  const buildSelect = (): void => {
    game.setLevels(store.levels()); // stay in sync with edits made in the manager
    // Count against the LIVE library (completedCount() can include stale keys for
    // levels deleted/replaced in the editor, giving e.g. "12/8").
    progressEl.textContent = `${store.levels().filter((l) => progress.isComplete(l.id)).length}/${store.levels().length}`;
    worldsEl.replaceChildren();
    for (const w of store.worlds()) {
      const levels = store.levels().filter((l) => l.world === w.id);
      if (!levels.length) continue;
      const wEl = document.createElement('div');
      wEl.className = 'ls-world';
      const h = document.createElement('h2');
      h.textContent = `World ${w.id} · ${w.name}`;
      const p = document.createElement('p');
      p.textContent = w.blurb;
      const grid = document.createElement('div');
      grid.className = 'ls-grid';
      for (const lv of levels) {
        const cell = document.createElement('button');
        cell.className = 'ls-cell';
        const done = progress.isComplete(lv.id);
        if (done) cell.classList.add('done');
        const best = progress.bestTicks(lv.id);
        cell.innerHTML =
          `<span class="num">${lv.id}</span><span class="nm">${lv.name}</span>` +
          (done ? `<span class="tick"></span><span class="best">${best}⏱</span>` : '');
        cell.addEventListener('click', () => {
          game.loadLevel(lv);
          closeMenu();
        });
        grid.appendChild(cell);
      }
      wEl.append(h, p, grid);
      worldsEl.appendChild(wEl);
    }
  };

  const buildStats = (): void => {
    const levels = store.levels();
    const total = levels.length;
    const solved = levels.filter((l) => progress.isComplete(l.id)).length;
    const pct = total ? Math.round((solved / total) * 100) : 0;
    const ticks = levels.reduce((s, l) => s + (progress.bestTicks(l.id) ?? 0), 0);
    const worldsDone = new Set(levels.filter((l) => progress.isComplete(l.id)).map((l) => l.world)).size;
    const totalWorlds = new Set(levels.map((l) => l.world)).size;
    const card = (num: string | number, lbl: string, wide = false): string =>
      `<div class="stat-card${wide ? ' wide' : ''}"><span class="stat-num">${num}</span><span class="stat-lbl">${lbl}</span></div>`;
    statsBody.innerHTML =
      '<div class="stat-grid">' +
      card(solved, 'Solved') +
      card(Math.max(0, total - solved), 'To go') +
      card(`${pct}%`, 'Complete') +
      card(`${worldsDone}/${totalWorlds}`, 'Worlds') +
      card(ticks, 'Total best ticks', true) +
      '</div>';
  };

  /* ----- shop: buy booster uses with coins/gems ----- */
  const BOOSTER_META: { id: BoosterId; name: string; icon: string }[] = [
    { id: 'reverse', name: 'Reverse', icon: 'assets/ui/ic_reverse.png' },
    { id: 'track', name: '+Track', icon: 'assets/ui/ic_plus.png' },
    { id: 'hold', name: 'Hold', icon: 'assets/ui/ic_hold.png' },
    { id: 'boost', name: 'Boost', icon: 'assets/ui/ic_boost.png' },
  ];
  const shopBody = el('shop-body');
  const buildShop = (): void => {
    shopBody.replaceChildren();
    for (const b of BOOSTER_META) {
      const price = BOOSTER_PRICE[b.id];
      const row = document.createElement('div');
      row.className = 'shop-row s9 s-navy';
      row.innerHTML =
        `<span class="shop-ic"><img src="${b.icon}" alt="" /></span>` +
        `<div class="shop-info"><b>${b.name}</b><span class="shop-own">Owned ${economy.boosterCount(b.id)}</span></div>` +
        `<button class="buy coin" data-id="${b.id}" data-cur="coins"${economy.coins < price.coins ? ' disabled' : ''}><img src="assets/ui/ic_coin.png" alt="" />${price.coins}</button>` +
        `<button class="buy gem" data-id="${b.id}" data-cur="gems"${economy.gems < price.gems ? ' disabled' : ''}><img src="assets/ui/ic_gem.png" alt="" />${price.gems}</button>`;
      shopBody.appendChild(row);
    }
  };
  shopBody.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.buy') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.dataset.id as BoosterId;
    const cur = btn.dataset.cur === 'gems' ? 'gems' : 'coins';
    if (economy.buy(id, cur)) audio.play('button'); // onChange re-renders the rows + currency
  });

  /* ----- daily rewards: claim today's card ----- */
  const dailyGrid = el('daily-grid');
  const buildDaily = (): void => {
    dailyGrid.replaceChildren();
    const next = economy.nextDailyDay();
    const claimedToday = economy.claimedToday();
    for (let day = 1; day <= 7; day++) {
      const card = document.createElement('div');
      card.className = 'day-card' + (day === 7 ? ' day7' : '');
      const claimed = day < next || (day === next && claimedToday);
      const claimable = day === next && !claimedToday;
      if (claimed) card.classList.add('claimed');
      if (claimable) card.classList.add('claimable');
      card.innerHTML =
        `<span class="day-n">Day ${day}</span><span class="day-rw">${rewardInner(DAILY[day - 1])}</span>` +
        (claimed ? '<span class="day-tick"></span>' : '');
      if (claimable) {
        card.addEventListener('click', () => {
          const res = economy.claimDaily();
          if (res) {
            audio.play('win'); // economy.onChange rebuilds the grid (marks it claimed)
            showPopup('Daily Reward!', `Day ${res.day} — you got ${rewardText(res.reward)}.`, () => {}, 'Collect', null);
          }
        });
      }
      dailyGrid.appendChild(card);
    }
  };

  /* ----- scratch & win: one free reveal per day ----- */
  const scratchGrid = el('scratch-grid');
  const scratchNote = el('scratch-note');
  // Repeatable: each of the 4 cards can be scratched once; a fresh board on every
  // visit (and on page refresh), so the player can keep scratching.
  const buildScratch = (): void => {
    scratchGrid.replaceChildren();
    scratchNote.textContent = 'Scratch a card to reveal a prize!';
    for (let i = 0; i < 4; i++) {
      const card = document.createElement('div');
      card.className = 'scr-card';
      let revealed = false;
      card.addEventListener('click', () => {
        if (revealed) return;
        revealed = true;
        const reward = economy.scratch();
        card.classList.add('revealed');
        card.innerHTML = `<span class="scr-reward">${rewardInner(reward)}</span>`;
        scratchNote.textContent = `You won ${rewardText(reward)}!`;
        audio.play('win');
      });
      scratchGrid.appendChild(card);
    }
  };

  game.onWin = (id, ticks) => {
    const firstClear = !progress.isComplete(id);
    progress.markComplete(id, ticks);
    const coins = firstClear ? 80 : 25;
    const gems = firstClear ? 2 : 0;
    economy.applyReward({ coins, gems });
    game.toast(`+${coins} coins${gems ? ` · +${gems} gems` : ''}`);
  };

  /* ----------------------------- wiring ----------------------------- */

  el('btn-levels').addEventListener('click', () => openMenu('levels'));

  // Quick mute (header button, persisted). Fine volume lives on the Settings sliders.
  const muteBtn = el<HTMLButtonElement>('btn-mute');
  let muted = localStorage.getItem('sidetrack.muted') === '1';
  const applyMute = (): void => {
    game.setMuted(muted);
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('off', muted);
  };
  const toggleMute = (): void => {
    muted = !muted;
    try {
      localStorage.setItem('sidetrack.muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    applyMute();
  };
  applyMute();
  muteBtn.addEventListener('click', toggleMute);

  el<HTMLButtonElement>('btn-undo').addEventListener('click', () => game.undo());
  el<HTMLButtonElement>('btn-redo').addEventListener('click', () => game.redo());
  el<HTMLButtonElement>('btn-reset').addEventListener('click', () => game.reset());
  hud.btnPlay.addEventListener('click', () => game.play());
  hud.btnStep.addEventListener('click', () => game.step());
  hud.btnSpeed.addEventListener('click', () => game.cycleSpeed());

  hud.tutorial.btnNext.addEventListener('click', () => game.tutorialNext());
  hud.tutorial.btnSkip.addEventListener('click', () => game.tutorialSkip());
  hud.btnHelp.addEventListener('click', () => game.replayTutorial());
  hud.outcome.btnReplay.addEventListener('click', () => game.replay());
  hud.outcome.btnEdit.addEventListener('click', () => game.reset());
  hud.outcome.btnNext.addEventListener('click', () => {
    if (game.hasNext()) game.next();
    else openMenu('levels'); // last level solved — back to the menu, not a dead-end
  });

  /* ----------------------------- level manager ----------------------------- */

  const mgrRefs: ManagerRefs = {
    panel: el('editor'),
    list: el('ed-list'),
    main: el('ed-main'),
    status: el('ed-status'),
    json: el<HTMLTextAreaElement>('ed-json'),
    btnNew: el<HTMLButtonElement>('ed-new'),
    btnExportAll: el<HTMLButtonElement>('ed-exportall'),
    btnImportAll: el<HTMLButtonElement>('ed-importall'),
    btnReset: el<HTMLButtonElement>('ed-reset'),
    btnDone: el<HTMLButtonElement>('ed-done'),
  };
  const manager = new LevelManager(mgrRefs, store, assets, (level) => {
    game.setLevels(store.levels());
    game.loadLevel(level);
  });

  mgrRefs.btnDone.addEventListener('click', () => {
    manager.close();
    openMenu('levels'); // rebuilds the select (and re-syncs game levels) from the store
  });

  /* ----------------------------- meta nav + settings ----------------------------- */

  type Tab = 'home' | 'levels' | 'shop' | 'daily' | 'scratch' | 'stats' | 'settings' | 'editor';
  const navBtns = Array.from(metanav.querySelectorAll<HTMLButtonElement>('.navtab'));
  const screens: Record<string, HTMLElement> = { home: homeEl, levels: selectEl, shop: shopEl, daily: dailyEl, scratch: scratchEl, stats: statsEl, settings: settingsEl };
  const titles: Record<string, string> = { home: 'SIDETRACK', levels: 'LEVELS', shop: 'SHOP', daily: 'DAILY', scratch: 'SCRATCH', stats: 'STATS', settings: 'SETTINGS' };
  const closeMenu = (): void => {
    for (const e of [...Object.values(screens), metatop, metanav]) e.classList.remove('show');
    for (const b of navBtns) b.classList.remove('active');
  };
  const openMenu = (tab: Tab = 'home'): void => {
    if (tab === 'editor') { closeMenu(); manager.open(); return; }
    if (tab === 'levels') buildSelect();
    if (tab === 'stats') buildStats();
    if (tab === 'shop') buildShop();
    if (tab === 'daily') buildDaily();
    if (tab === 'scratch') buildScratch();
    for (const [k, e] of Object.entries(screens)) e.classList.toggle('show', k === tab);
    metatop.classList.add('show');
    metanav.classList.add('show');
    metaTitle.textContent = titles[tab] ?? '';
    refreshCurrency();
    for (const b of navBtns) b.classList.toggle('active', b.dataset.tab === tab); // scratch/stats: none active
  };
  for (const b of navBtns) b.addEventListener('click', () => openMenu(b.dataset.tab as Tab));
  el('set-stats').addEventListener('click', () => openMenu('stats'));
  el('set-editor').addEventListener('click', () => openMenu('editor'));
  el('daily-scratch').addEventListener('click', () => openMenu('scratch'));
  el('cur-coins').addEventListener('click', () => openMenu('shop'));
  el('cur-gems').addEventListener('click', () => openMenu('shop'));
  el('home-play').addEventListener('click', () => closeMenu()); // PLAY → drop onto the board

  // Settings sliders (persisted): Sound -> master volume, Music -> ambience,
  // Vibration -> haptics on/off (read by game.buzz()).
  const sndSound = el<HTMLInputElement>('snd-sound');
  const sndMusic = el<HTMLInputElement>('snd-music');
  const sndHaptics = el<HTMLInputElement>('snd-haptics');
  const save = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const restore = (k: string, d: number): number => {
    const raw = localStorage.getItem(k);
    if (raw == null || raw === '') return d;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d;
  };
  sndSound.value = String(restore('sidetrack.vol', 50));
  sndMusic.value = String(restore('sidetrack.ambvol', 60));
  sndHaptics.value = localStorage.getItem('sidetrack.haptics') === '0' ? '0' : '1';
  audio.setVolume(Number(sndSound.value) / 100);
  audio.setAmbientVolume(Number(sndMusic.value) / 100);
  sndSound.addEventListener('input', () => { audio.setVolume(Number(sndSound.value) / 100); save('sidetrack.vol', sndSound.value); });
  sndMusic.addEventListener('input', () => { audio.setAmbientVolume(Number(sndMusic.value) / 100); save('sidetrack.ambvol', sndMusic.value); });
  sndHaptics.addEventListener('input', () => save('sidetrack.haptics', sndHaptics.value === '0' ? '0' : '1'));

  // Styled confirmation popup (replaces window.confirm; matches the kit dialogs).
  const popup = el('popup');
  const popTitle = el('pop-title');
  const popMsg = el('pop-msg');
  const popNo = el<HTMLButtonElement>('pop-no');
  const popYes = el<HTMLButtonElement>('pop-yes');
  let popOnYes: (() => void) | null = null;
  // noLabel === null → single-button (reward) popup.
  const showPopup = (title: string, msg: string, onYes: () => void, yesLabel = 'Yes', noLabel: string | null = 'No'): void => {
    popTitle.textContent = title; popMsg.textContent = msg; popOnYes = onYes;
    popYes.textContent = yesLabel;
    if (noLabel === null) { popNo.style.display = 'none'; } else { popNo.style.display = ''; popNo.textContent = noLabel; }
    popup.classList.add('show');
    (noLabel === null ? popYes : popNo).focus();
  };
  const hidePopup = (): void => { popup.classList.remove('show'); popOnYes = null; };
  popYes.addEventListener('click', () => { const cb = popOnYes; hidePopup(); cb?.(); });
  popNo.addEventListener('click', hidePopup);
  popup.addEventListener('click', (e) => { if (e.target === popup) hidePopup(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popup.classList.contains('show')) hidePopup(); });

  el<HTMLButtonElement>('set-reset').addEventListener('click', () => {
    showPopup('Reset?', 'Clear every solved level? This cannot be undone.', () => {
      progress.reset();
      buildSelect();
      buildStats();
    });
  });
  el<HTMLButtonElement>('set-share').addEventListener('click', () => {
    const data = { title: 'Sidetrack', text: 'A cozy train-shunting puzzle.', url: location.href };
    if (navigator.share) void navigator.share(data).catch(() => { /* cancelled */ });
    else { try { void navigator.clipboard?.writeText(location.href); } catch { /* ignore */ } game.toast('Link copied'); }
  });
  el<HTMLButtonElement>('set-source').addEventListener('click', () => {
    window.open('https://github.com/TingleDinkle/SIDETRACK', '_blank', 'noopener');
  });

  /* ----------------------------- booster bar (below the board) ----------------------------- */
  // Functional power-ups under the grid (each has a limited count):
  //   Reverse — undo all the way back to the level start
  //   +Track  — grant one extra track piece of budget
  //   Hold    — freeze one object (signal / gate / mover) for the run
  //   Boost   — run Play at 2×
  // Full-colour ability icons from the UI kit (swirl/plus/hand/star), drawn as
  // sprites; `color` is the fallback dot only (used if the sprite isn't loaded).
  // Full-colour ability icons from the kit (swirl/plus/hand/star). Counts now come
  // from the persistent economy stock (bought in the Shop, won daily / scratching).
  const boosters: { id: BoosterId; icon: string; color: string; name: string }[] = [
    { id: 'reverse', icon: 'ui_reverse', color: '#3f7fd2', name: 'Reverse' },
    { id: 'track', icon: 'ui_track', color: '#4fae5a', name: '+Track' },
    { id: 'hold', icon: 'ui_hold', color: '#d2553f', name: 'Hold' },
    { id: 'boost', icon: 'ui_boost', color: '#d9a82e', name: 'Boost' },
  ];
  const boostersEl = el('boosters');
  const idpr = Math.min(2, window.devicePixelRatio || 1);
  const boosterEls: { id: BoosterId; btn: HTMLButtonElement; count: HTMLElement }[] = [];
  for (const b of boosters) {
    const btn = document.createElement('button');
    btn.className = 'booster';
    const count = document.createElement('span');
    count.className = 'bcount';
    const cvs = document.createElement('canvas');
    cvs.className = 'bicon';
    cvs.width = Math.round(34 * idpr);
    cvs.height = Math.round(34 * idpr);
    const cx = cvs.getContext('2d');
    if (cx) {
      cx.scale(idpr, idpr);
      if (!assets.draw(cx, b.icon, 17, 17, 34, 34)) {
        cx.fillStyle = b.color; // fallback dot if sprites aren't loaded
        cx.beginPath();
        cx.arc(17, 17, 12, 0, Math.PI * 2);
        cx.fill();
      }
    }
    const label = document.createElement('span');
    label.className = 'blabel';
    label.textContent = b.name;
    btn.append(count, cvs, label);
    btn.addEventListener('click', () => {
      if (game.tutorialActive()) return; // boosters are inert while a tutorial is up
      if (economy.boosterCount(b.id) <= 0) {
        game.toast(`Out of ${b.name} — buy more in the Shop`);
        return;
      }
      switch (b.id) {
        case 'reverse': game.revertToStart(); economy.useBooster('reverse'); break;
        case 'track': game.grantTrack(1); economy.useBooster('track'); break;
        case 'boost': if (game.boost()) economy.useBooster('boost'); break; // no spend if already 2×
        case 'hold': game.beginHold((r) => {
          if (r === 'freeze') economy.useBooster('hold');
          else if (r === 'unfreeze') economy.addBooster('hold', 1); // refund on un-freeze
        }); break;
      }
    });
    boostersEl.appendChild(btn);
    boosterEls.push({ id: b.id, btn, count });
  }
  const refreshBoosters = (): void => {
    for (const e of boosterEls) {
      const n = economy.boosterCount(e.id);
      e.count.textContent = '×' + n;
      e.btn.disabled = n <= 0;
    }
  };

  // Any balance/stock change refreshes the currency bar, booster badges and any
  // open shop/daily screen.
  economy.onChange = () => {
    refreshCurrency();
    refreshBoosters();
    if (shopEl.classList.contains('show')) buildShop();
    if (dailyEl.classList.contains('show')) buildDaily();
    // (scratch isn't rebuilt here — that would wipe the just-revealed cards)
  };
  refreshBoosters();
  game.updateHud();
  openMenu('home'); // land on the Home scene (Play + train) on first load
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
