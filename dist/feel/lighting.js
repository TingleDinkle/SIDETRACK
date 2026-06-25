const AHEAD = {
    N: [0, -1],
    S: [0, 1],
    E: [1, 0],
    W: [-1, 0],
};
/** A soft warm pool of light under the loco, pushed slightly in its heading so
 *  it reads as a headlight. Additive, so it lifts the dark floor without washing
 *  out the sprite drawn on top of it. (cx,cy) is the loco's centre in px. */
export function drawHeadlight(ctx, cx, cy, cell, heading) {
    const [dx, dy] = AHEAD[heading] ?? [0, 0];
    const gx = cx + dx * cell * 0.35;
    const gy = cy + dy * cell * 0.35;
    const radius = cell * 1.6;
    const g = ctx.createRadialGradient(gx, gy, cell * 0.12, gx, gy, radius);
    g.addColorStop(0, 'rgba(255,226,156,0.22)');
    g.addColorStop(0.55, 'rgba(255,206,132,0.09)');
    g.addColorStop(1, 'rgba(255,198,120,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
//# sourceMappingURL=lighting.js.map