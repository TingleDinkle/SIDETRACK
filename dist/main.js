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
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`missing #${id}`);
    return node;
}
async function boot() {
    const bundle = await loadBundle();
    const progress = new Progress();
    const canvas = el('board');
    const renderer = new Renderer(canvas);
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