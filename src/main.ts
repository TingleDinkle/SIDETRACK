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
  };

  const audio = new AudioManager();
  const game = new Game(canvas, renderer, hud, audio, store.levels(), 0);

  /* ----------------------------- level select ----------------------------- */

  const selectEl = el('levelselect');
  const worldsEl = el('ls-worlds');
  const progressEl = el('ls-progress');

  const buildSelect = (): void => {
    game.setLevels(store.levels()); // stay in sync with edits made in the manager
    progressEl.textContent = `${progress.completedCount()} / ${store.levels().length} solved`;
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
          (done ? `<span class="tick">✓</span><span class="best">${best} ticks</span>` : '');
        cell.addEventListener('click', () => {
          game.loadLevel(lv);
          showSelect(false);
        });
        grid.appendChild(cell);
      }
      wEl.append(h, p, grid);
      worldsEl.appendChild(wEl);
    }
  };

  const showSelect = (show: boolean): void => {
    if (show) buildSelect();
    selectEl.classList.toggle('show', show);
  };

  game.onWin = (id, ticks) => {
    progress.markComplete(id, ticks);
  };

  /* ----------------------------- wiring ----------------------------- */

  el('btn-levels').addEventListener('click', () => showSelect(true));
  el('ls-close').addEventListener('click', () => showSelect(false));

  // Mute toggle (persisted)
  const muteBtn = el<HTMLButtonElement>('btn-mute');
  let muted = localStorage.getItem('sidetrack.muted') === '1';
  const applyMute = (): void => {
    game.setMuted(muted);
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('off', muted);
  };
  applyMute();
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    try {
      localStorage.setItem('sidetrack.muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    applyMute();
  });

  el<HTMLButtonElement>('btn-undo').addEventListener('click', () => game.undo());
  el<HTMLButtonElement>('btn-redo').addEventListener('click', () => game.redo());
  el<HTMLButtonElement>('btn-reset').addEventListener('click', () => game.reset());
  hud.btnPlay.addEventListener('click', () => game.play());
  hud.btnStep.addEventListener('click', () => game.step());
  hud.btnSpeed.addEventListener('click', () => game.cycleSpeed());

  hud.outcome.btnReplay.addEventListener('click', () => game.replay());
  hud.outcome.btnEdit.addEventListener('click', () => game.reset());
  hud.outcome.btnNext.addEventListener('click', () => game.next());

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

  el('ls-editor').addEventListener('click', () => {
    showSelect(false);
    manager.open();
  });
  mgrRefs.btnDone.addEventListener('click', () => {
    manager.close();
    showSelect(true); // rebuilds the select (and re-syncs game levels) from the store
  });

  /* ----------------------------- booster bar (below the board) ----------------------------- */
  // Functional power-ups under the grid (each has a limited count):
  //   Reverse — undo all the way back to the level start
  //   +Track  — grant one extra track piece of budget
  //   Hold    — freeze one object (signal / gate / mover) for the run
  //   Boost   — run Play at 2×
  const boosters = [
    { id: 'reverse', icon: 'icon_loco', color: '#3f7fd2', name: 'Reverse', count: 2 },
    { id: 'track', icon: 'icon_rail', color: '#4fae5a', name: '+Track', count: 3 },
    { id: 'hold', icon: 'icon_signal_stop', color: '#d2553f', name: 'Hold', count: 2 },
    { id: 'boost', icon: 'icon_signal_go', color: '#d9a82e', name: 'Boost', count: 2 },
  ];
  const boostersEl = el('boosters');
  const idpr = Math.min(2, window.devicePixelRatio || 1);
  for (const b of boosters) {
    const btn = document.createElement('button');
    btn.className = 'booster';
    const count = document.createElement('span');
    count.className = 'bcount';
    count.textContent = '×' + b.count;
    const cvs = document.createElement('canvas');
    cvs.className = 'bicon';
    cvs.width = Math.round(34 * idpr);
    cvs.height = Math.round(34 * idpr);
    const cx = cvs.getContext('2d');
    if (cx) {
      cx.scale(idpr, idpr);
      if (!assets.drawIcon(cx, b.icon, 17, 17, 30, 30, b.color)) {
        cx.fillStyle = b.color; // fallback dot if icons aren't loaded
        cx.beginPath();
        cx.arc(17, 17, 12, 0, Math.PI * 2);
        cx.fill();
      }
    }
    const label = document.createElement('span');
    label.className = 'blabel';
    label.textContent = b.name;
    btn.append(count, cvs, label);
    let n = b.count;
    const spend = (): void => {
      n--;
      count.textContent = '×' + n;
      if (n === 0) btn.disabled = true;
    };
    btn.addEventListener('click', () => {
      if (n <= 0) return;
      switch (b.id) {
        case 'reverse':
          game.revertToStart();
          spend();
          break;
        case 'track':
          game.grantTrack(1);
          spend();
          break;
        case 'boost':
          game.boost();
          spend();
          break;
        case 'hold':
          game.beginHold((applied) => {
            if (applied) spend();
          });
          break;
      }
    });
    boostersEl.appendChild(btn);
  }

  game.updateHud();
  showSelect(true); // open the menu on first load
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
