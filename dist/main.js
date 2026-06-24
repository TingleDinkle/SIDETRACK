/**
 * Bootstrap — loads the level bundle + saved progress, wires the DOM controls
 * and the level-select screen to the Game. Plumbing only; logic lives in the
 * modules.
 */
import { Game } from './game.js';
import { Renderer } from './render.js';
import { loadBundle } from './levelLoader.js';
import { Progress } from './progress.js';
import { AudioManager } from './sound.js';
import { LevelEditor } from './leveleditor.js';
import { AssetManager } from './assets.js';
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`missing #${id}`);
    return node;
}
async function boot() {
    const canvas = el('board');
    const renderer = new Renderer(canvas);
    // Optional sprite layer — loads in parallel with the level bundle; the game
    // renders procedurally until (and unless) assets/manifest.json supplies art.
    const assets = new AssetManager();
    renderer.setAssets(assets);
    const [bundle] = await Promise.all([loadBundle(), assets.load()]);
    const progress = new Progress();
    const hud = {
        levelName: el('level-name'),
        budgetUsed: el('budget-used'),
        budgetTotal: el('budget-total'),
        budgetBox: el('budget'),
        toast: el('toast'),
        btnUndo: el('btn-undo'),
        btnRedo: el('btn-redo'),
        btnPlay: el('btn-play'),
        btnStep: el('btn-step'),
        btnSpeed: el('btn-speed'),
        outcome: {
            panel: el('outcome'),
            title: el('outcome-title'),
            sub: el('outcome-sub'),
            btnReplay: el('outcome-replay'),
            btnNext: el('outcome-next'),
            btnEdit: el('outcome-edit'),
        },
    };
    const audio = new AudioManager();
    const game = new Game(canvas, renderer, hud, audio, bundle.levels, 0);
    /* ----------------------------- level select ----------------------------- */
    const selectEl = el('levelselect');
    const worldsEl = el('ls-worlds');
    const progressEl = el('ls-progress');
    const buildSelect = () => {
        progressEl.textContent = `${progress.completedCount()} / ${bundle.levels.length} solved`;
        worldsEl.replaceChildren();
        for (const w of bundle.worlds) {
            const levels = bundle.levels.filter((l) => l.world === w.id);
            if (!levels.length)
                continue;
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
                if (done)
                    cell.classList.add('done');
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
    const showSelect = (show) => {
        if (show)
            buildSelect();
        selectEl.classList.toggle('show', show);
    };
    game.onWin = (id, ticks) => {
        progress.markComplete(id, ticks);
    };
    /* ----------------------------- wiring ----------------------------- */
    el('btn-levels').addEventListener('click', () => showSelect(true));
    el('ls-close').addEventListener('click', () => showSelect(false));
    // Mute toggle (persisted)
    const muteBtn = el('btn-mute');
    let muted = localStorage.getItem('sidetrack.muted') === '1';
    const applyMute = () => {
        game.setMuted(muted);
        muteBtn.textContent = muted ? '🔇' : '🔊';
        muteBtn.classList.toggle('off', muted);
    };
    applyMute();
    muteBtn.addEventListener('click', () => {
        muted = !muted;
        try {
            localStorage.setItem('sidetrack.muted', muted ? '1' : '0');
        }
        catch {
            /* ignore */
        }
        applyMute();
    });
    el('btn-undo').addEventListener('click', () => game.undo());
    el('btn-redo').addEventListener('click', () => game.redo());
    el('btn-reset').addEventListener('click', () => game.reset());
    hud.btnPlay.addEventListener('click', () => game.play());
    hud.btnStep.addEventListener('click', () => game.step());
    hud.btnSpeed.addEventListener('click', () => game.cycleSpeed());
    hud.outcome.btnReplay.addEventListener('click', () => game.replay());
    hud.outcome.btnEdit.addEventListener('click', () => game.reset());
    hud.outcome.btnNext.addEventListener('click', () => game.next());
    /* ----------------------------- level editor (M6) ----------------------------- */
    const edRefs = {
        panel: el('editor'),
        canvas: el('ed-board'),
        tools: el('ed-tools'),
        cols: el('ed-cols'),
        rows: el('ed-rows'),
        budget: el('ed-budget'),
        heading: el('ed-heading'),
        orient: el('ed-orient'),
        color: el('ed-color'),
        json: el('ed-json'),
        status: el('ed-status'),
    };
    const editor = new LevelEditor(edRefs, (level) => {
        showSelect(false);
        game.loadLevel(level);
    });
    el('ls-editor').addEventListener('click', () => {
        showSelect(false);
        editor.open();
    });
    el('ed-done').addEventListener('click', () => {
        editor.close();
        showSelect(true);
    });
    el('ed-test').addEventListener('click', () => editor.test());
    el('ed-export').addEventListener('click', () => editor.exportJSON());
    el('ed-copy').addEventListener('click', () => void editor.copyJSON());
    el('ed-import').addEventListener('click', () => editor.importJSON());
    el('ed-clear').addEventListener('click', () => editor.clear());
    /* ----------------------------- booster bar (below the board) ----------------------------- */
    // Scaffold UI placed right under the gameplay grid, built from the tinted
    // icons. No effect wired yet — each click just toasts; hook real behaviour
    // (reverse loco, drop a track, hold a signal…) where marked.
    const boosters = [
        { icon: 'icon_loco', color: '#3f7fd2', name: 'Reverse', count: 2 },
        { icon: 'icon_rail', color: '#4fae5a', name: '+Track', count: 3 },
        { icon: 'icon_signal_stop', color: '#d2553f', name: 'Hold', count: 1 },
        { icon: 'icon_signal_go', color: '#d9a82e', name: 'Boost', count: 2 },
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
        btn.addEventListener('click', () => {
            if (n <= 0)
                return;
            n--;
            count.textContent = '×' + n;
            if (n === 0)
                btn.disabled = true;
            game.toast(`${b.name} — hook an effect here`); // TODO: wire booster behaviour
        });
        boostersEl.appendChild(btn);
    }
    game.updateHud();
    showSelect(true); // open the menu on first load
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
}
else {
    void boot();
}
//# sourceMappingURL=main.js.map