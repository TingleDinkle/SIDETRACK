/**
 * Level validation — catches the edge cases that make a level crash, soft-lock,
 * or be unsolvable, so the editor can warn before you ship one. Errors block a
 * clean test; warnings are advisory.
 */
export function validateLevel(L) {
    const issues = [];
    const err = (msg) => void issues.push({ level: 'error', msg });
    const warn = (msg) => void issues.push({ level: 'warn', msg });
    const { cols, rows } = L.grid;
    const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const tiles = L.fixedTiles ?? [];
    const wagons = L.wagons ?? [];
    const movers = L.movers ?? [];
    const rockAt = (x, y) => tiles.some((t) => t.type === 'rock' && t.x === x && t.y === y);
    /* ---- grid / budget ---- */
    if (cols < 2 || rows < 2 || cols > 16 || rows > 12)
        err('Grid size must be between 2×2 and 16×12.');
    if (L.trackBudget < 0)
        err('Track budget cannot be negative.');
    /* ---- locomotive ---- */
    const loco = L.locomotive;
    if (!loco || !inb(loco.x, loco.y))
        err('Locomotive is off the grid.');
    else if (rockAt(loco.x, loco.y))
        err('Locomotive is on a rock.');
    /* ---- exit ---- */
    if (!tiles.some((t) => t.type === 'exit'))
        err('No exit tile — the level is unwinnable.');
    for (const t of tiles)
        if (!inb(t.x, t.y))
            err(`A ${t.type} tile is off the grid (${t.x},${t.y}).`);
    /* ---- wagons: must be 1..N, unique, on the grid, reachable ---- */
    const nums = wagons.map((w) => w.number).sort((a, b) => a - b);
    let badSeq = false;
    for (let i = 0; i < nums.length; i++)
        if (nums[i] !== i + 1)
            badSeq = true;
    if (badSeq)
        err(`Wagons must be numbered 1..${nums.length} with no gaps or duplicates (got ${nums.join(', ') || 'none'}).`);
    for (const w of wagons) {
        if (!inb(w.x, w.y))
            err(`Wagon ${w.number} is off the grid.`);
        else if (rockAt(w.x, w.y))
            warn(`Wagon ${w.number} sits on a rock (unreachable).`);
    }
    /* ---- nothing may start on the locomotive (instant collision) ---- */
    if (loco) {
        for (const w of wagons)
            if (w.x === loco.x && w.y === loco.y)
                err(`Wagon ${w.number} starts on the locomotive.`);
        for (const m of movers)
            if (m.x === loco.x && m.y === loco.y)
                err('A mover starts on the locomotive.');
    }
    /* ---- overlaps: one thing per cell ---- */
    const occ = new Map();
    const claim = (x, y, what) => {
        const k = `${x},${y}`;
        if (occ.has(k))
            warn(`${what} overlaps ${occ.get(k)} at (${x},${y}).`);
        else
            occ.set(k, what);
    };
    if (loco)
        claim(loco.x, loco.y, 'locomotive');
    for (const t of tiles)
        if (t.type !== 'track')
            claim(t.x, t.y, t.type);
    for (const w of wagons)
        claim(w.x, w.y, `wagon ${w.number}`);
    for (const m of movers) {
        if (!inb(m.x, m.y))
            err('A mover is off the grid.');
        else if (rockAt(m.x, m.y))
            warn('A mover sits on a rock.');
        claim(m.x, m.y, 'mover');
    }
    /* ---- tunnels: exactly 2 per pairId ---- */
    const pairs = new Map();
    for (const t of tiles)
        if (t.type === 'tunnel')
            pairs.set(t.pairId ?? -1, (pairs.get(t.pairId ?? -1) ?? 0) + 1);
    for (const [pid, n] of pairs) {
        if (pid < 0)
            err('A tunnel has no pairId.');
        else if (n !== 2)
            err(`Tunnel pair ${pid} needs exactly 2 tunnels (has ${n}).`);
    }
    /* ---- coloured links: gate/switch need a colour; a colourless button is a
           master that opens every gate ---- */
    const buttons = tiles.filter((t) => t.type === 'button');
    const buttonColors = new Set(buttons.filter((b) => b.color).map((b) => b.color));
    const hasMaster = buttons.some((b) => !b.color);
    const gates = tiles.filter((t) => t.type === 'gate');
    for (const g of gates) {
        if (!g.color)
            err('A gate has no colour — it can never be opened.');
        else if (!g.open && !buttonColors.has(g.color) && !hasMaster)
            warn(`Closed gate "${g.color}" has no matching button — it can never open.`);
    }
    if (hasMaster && !gates.length)
        warn('A master button has no gates to open.');
    for (const s of tiles.filter((t) => t.type === 'switch'))
        if (!s.color)
            warn('A switch has no colour — it flips nothing.');
    /* ---- unsupported objective ---- */
    if ((L.objectives?.passengers ?? 0) > 0)
        warn('Passengers objective is not implemented yet and will be ignored.');
    return issues;
}
//# sourceMappingURL=levelValidate.js.map