/**
 * AssetManager — optional sprite/texture layer.
 *
 * The game ships with no art and draws everything procedurally. If
 * `assets/manifest.json` defines sprites, the renderer uses them instead (and
 * falls back per-sprite to the shapes when a name is missing). This lets you
 * drop in PNGs from a pack, a commission or AI without touching code.
 *
 * A sprite is either a region of a shared atlas image (`x,y,w,h`) or a
 * standalone file (`src`). See assets/README.md for the full spec.
 */

export interface SpriteDef {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  src?: string;
  anchorX?: number; // 0..1, default 0.5 (centre)
  anchorY?: number; // 0..1, default 0.5
}

interface Manifest {
  atlas?: string;
  sprites?: Record<string, SpriteDef>;
}

interface Sprite {
  img: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  anchorX: number;
  anchorY: number;
}

/** Parse #rgb / #rrggbb into [r,g,b]. */
function parseColor(c: string): [number, number, number] {
  let s = c.trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s || '0', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

export class AssetManager {
  private sprites = new Map<string, Sprite>();
  private patterns = new Map<string, CanvasPattern | null>();
  private tintCache = new Map<string, HTMLCanvasElement | null>();
  ready = false;

  constructor(private readonly base = './assets/') {}

  /** Load the manifest and its images. Never throws — missing assets just mean
   *  the renderer keeps using procedural art. */
  async load(): Promise<void> {
    let manifest: Manifest;
    try {
      const res = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      manifest = (await res.json()) as Manifest;
    } catch {
      return; // no manifest -> fully procedural
    }
    const defs = manifest.sprites ?? {};
    let atlas: HTMLImageElement | null = null;
    if (manifest.atlas) atlas = await loadImage(this.base + manifest.atlas).catch(() => null);

    const fileCache = new Map<string, HTMLImageElement>();
    for (const [name, d] of Object.entries(defs)) {
      try {
        if (d.src) {
          let img = fileCache.get(d.src) ?? null;
          if (!img) {
            img = await loadImage(this.base + d.src).catch(() => null);
            if (img) fileCache.set(d.src, img);
          }
          if (!img) continue;
          this.sprites.set(name, { img, sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight, anchorX: d.anchorX ?? 0.5, anchorY: d.anchorY ?? 0.5 });
        } else if (atlas && d.w && d.h) {
          this.sprites.set(name, { img: atlas, sx: d.x ?? 0, sy: d.y ?? 0, sw: d.w, sh: d.h, anchorX: d.anchorX ?? 0.5, anchorY: d.anchorY ?? 0.5 });
        }
      } catch {
        /* skip a bad sprite, keep the rest */
      }
    }
    this.ready = true;
  }

  has(name: string): boolean {
    return this.sprites.has(name);
  }

  /** Draw a sprite to fit a w×h box centred on (cx,cy), optionally rotated. */
  draw(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, w: number, h: number, rot = 0): boolean {
    const s = this.sprites.get(name);
    if (!s) return false;
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, -w * s.anchorX, -h * s.anchorY, w, h);
    ctx.restore();
    return true;
  }

  /** Extract a sprite (atlas region or whole file) onto its own canvas. */
  private extract(name: string): HTMLCanvasElement | null {
    const s = this.sprites.get(name);
    if (!s) return null;
    const c = document.createElement('canvas');
    c.width = s.sw;
    c.height = s.sh;
    const x = c.getContext('2d');
    if (!x) return null;
    x.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, s.sw, s.sh);
    return c;
  }

  /**
   * Recolour a monochrome icon: the shape's brightness becomes its alpha (so a
   * white-on-black symbol gets a transparent background) and is filled with
   * `color`. Result is cached per (name, color). Great for tintable UI/booster
   * icons — one PNG, any colour.
   */
  tinted(name: string, color: string): HTMLCanvasElement | null {
    const key = name + '|' + color;
    const cached = this.tintCache.get(key);
    if (cached !== undefined) return cached;
    const canvas = this.extract(name);
    if (canvas) {
      const x = canvas.getContext('2d')!;
      const img = x.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      const [r, g, b] = parseColor(color);
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.max(d[i], d[i + 1], d[i + 2]); // white shape -> 255, black bg -> 0
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = Math.round((lum * d[i + 3]) / 255);
      }
      x.putImageData(img, 0, 0);
    }
    this.tintCache.set(key, canvas);
    return canvas;
  }

  /**
   * Recolour a sprite's saturated (coloured) pixels to `color`, keeping their
   * shading and leaving near-grey pixels untouched. Used to map the yellow
   * structure-barrier to a gate's link colour: the coloured part's luminance
   * scales the target colour (so highlights/shadows survive) while metal greys
   * stay grey. Cached per (name, color).
   */
  recolored(name: string, color: string): HTMLCanvasElement | null {
    const key = 're|' + name + '|' + color;
    const cached = this.tintCache.get(key);
    if (cached !== undefined) return cached;
    const canvas = this.extract(name);
    if (canvas) {
      const x = canvas.getContext('2d')!;
      const img = x.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      const sat = (r: number, g: number, b: number): number => {
        const mx = Math.max(r, g, b);
        return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
      };
      const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
      // Reference luminance: the average brightness of the coloured pixels, so
      // the base colour maps onto the target at full strength.
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        if (sat(d[i], d[i + 1], d[i + 2]) > 0.22) {
          sum += lum(d[i], d[i + 1], d[i + 2]);
          cnt++;
        }
      }
      const base = cnt ? sum / cnt : 200;
      const [tr, tg, tb] = parseColor(color);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        if (sat(d[i], d[i + 1], d[i + 2]) <= 0.22) continue; // keep greys
        const f = lum(d[i], d[i + 1], d[i + 2]) / base;
        d[i] = Math.min(255, Math.round(tr * f));
        d[i + 1] = Math.min(255, Math.round(tg * f));
        d[i + 2] = Math.min(255, Math.round(tb * f));
      }
      x.putImageData(img, 0, 0);
    }
    this.tintCache.set(key, canvas);
    return canvas;
  }

  /** Draw a recoloured sprite to fit a w×h box centred on (cx,cy). */
  drawRecolored(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, w: number, h: number, color: string, rot = 0): boolean {
    const c = this.recolored(name, color);
    if (!c) return false;
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(c, -w / 2, -h / 2, w, h);
    ctx.restore();
    return true;
  }

  /** Draw a tinted icon centred in a w×h box. Returns false if not loaded. */
  drawIcon(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, w: number, h: number, color = '#ffffff'): boolean {
    const c = this.tinted(name, color);
    if (!c) return false;
    ctx.drawImage(c, cx - w / 2, cy - h / 2, w, h);
    return true;
  }

  /** A repeating pattern for tiled ground (extracts atlas regions as needed). */
  pattern(ctx: CanvasRenderingContext2D, name: string): CanvasPattern | null {
    if (this.patterns.has(name)) return this.patterns.get(name) ?? null;
    const s = this.sprites.get(name);
    let pat: CanvasPattern | null = null;
    if (s) {
      let source: CanvasImageSource = s.img;
      const natW = (s.img as HTMLImageElement).naturalWidth ?? s.sw;
      const natH = (s.img as HTMLImageElement).naturalHeight ?? s.sh;
      if (s.sx !== 0 || s.sy !== 0 || s.sw !== natW || s.sh !== natH) {
        const off = document.createElement('canvas');
        off.width = s.sw;
        off.height = s.sh;
        off.getContext('2d')?.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, s.sw, s.sh);
        source = off;
      }
      pat = ctx.createPattern(source, 'repeat');
    }
    this.patterns.set(name, pat);
    return pat;
  }
}
