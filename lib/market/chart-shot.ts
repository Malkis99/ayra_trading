/**
 * «Chart screenshot» (owner 2026-11-02): the browser films this tab once (Screen Capture API, with the browser's own
 * permission prompt), and the frame is cut to the chart. TradingView's chart is another site's frame, so it cannot be
 * drawn from the page itself — only the tab's picture has it. The image is put together here: our line with the
 * instrument and timeframe, the chart's pixels, the «Time and session» card and a small AYRA mark.
 *
 * Only on computers: phones have no tab capture (the button says to take an ordinary screenshot there).
 */

export type ShotErrorCode = "denied" | "notTab" | "blank" | "failed";

export class ShotError extends Error {
  constructor(readonly code: ShotErrorCode) {
    super(code);
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The «Time and session» card's lines, as shown on the page. */
export interface ShotClock {
  title: string;
  time: string;
  zone: string;
  session: string;
  sessionOn: boolean;
  market: string;
  marketOpen: boolean;
  note: string;
}

export interface ShotInput {
  /** The chart windows (layouts 1/2/4 with their headers), in page pixels. */
  grid: Rect;
  /** Each TradingView frame, in page pixels: for the 16–17 cover of the legend's line. */
  widgets: Rect[];
  name: string;
  ticker: string;
  interval: string;
  clock: ShotClock | null;
  /** 16–17 mode: the legend's first line (it names the broker, e.g. «FOREXCOM») is covered. */
  minor: boolean;
  /** TradingView's drawing toolbar is on (the cover starts right of it). */
  drawing: boolean;
}

/** Can this browser film the tab at all? (Phones: no.) */
export function canCaptureTab(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// ---- Geometry (page pixels; the image is drawn at the frame's own scale) ----

export const SHOT_PAD = 16;
export const SHOT_HEADER = 40;
export const SHOT_CARD_W = 240;
export const SHOT_GAP = 12;
/** The legend's line at the top of TradingView's chart, and the price scale on its right that stays visible. */
export const LEGEND_H = 34;
export const PRICE_SCALE_W = 80;
/** TradingView's drawing toolbar on the left of the chart. */
export const DRAWING_BAR_W = 56;

export interface ShotLayout {
  width: number;
  height: number;
  chart: Rect;
  card: Rect | null;
}

export function shotLayout(grid: Rect, cardHeight: number | null): ShotLayout {
  const top = SHOT_PAD + SHOT_HEADER;
  const card = cardHeight === null ? null : { x: SHOT_PAD + grid.w + SHOT_GAP, y: top, w: SHOT_CARD_W, h: cardHeight };
  return {
    width: SHOT_PAD * 2 + grid.w + (card ? SHOT_GAP + SHOT_CARD_W : 0),
    height: top + Math.max(grid.h, card?.h ?? 0) + SHOT_PAD,
    chart: { x: SHOT_PAD, y: top, w: grid.w, h: grid.h },
    card,
  };
}

/** The bands that hide the legend's line of every chart window (16–17 mode), relative to the grid. */
export function legendCovers(grid: Rect, widgets: Rect[], drawing: boolean): Rect[] {
  const left = drawing ? DRAWING_BAR_W : 0;
  return widgets.map((w) => ({ x: w.x - grid.x + left, y: w.y - grid.y, w: Math.max(0, w.w - PRICE_SCALE_W - left), h: Math.min(LEGEND_H, w.h) }));
}

/** The part of `r` inside the window (what the tab's picture has). */
export function clipToWindow(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.max(0, Math.min(r.x + r.w, width) - x), h: Math.max(0, Math.min(r.y + r.h, height) - y) };
}

/** The timeframe for the file name: `1m`, `4h`, `1D`, `1W`, `1M`. */
export function intervalTag(interval: string): string {
  if (interval === "D" || interval === "W" || interval === "M") return `1${interval}`;
  const m = Number(interval);
  if (!Number.isFinite(m) || m <= 0) return interval;
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}

/** Does the picture show this tab (and not another window or screen)? Same proportions as the page's window. */
export function framesMatch(frameW: number, frameH: number, pageW: number, pageH: number): boolean {
  if (!frameW || !frameH || !pageW || !pageH) return false;
  return Math.abs(frameW / frameH - pageW / pageH) < 0.02;
}

/**
 * An empty chart window: all but a trace of the sampled pixels have one colour (the browser gave the frame without
 * the chart's picture). A real chart always has its grid, price scale and candles or line. `data` is RGBA.
 */
export function looksBlank(data: ArrayLike<number>, step?: number): boolean {
  const pixels = Math.floor(data.length / 4);
  if (!pixels) return true;
  step = step ?? Math.max(1, Math.floor(pixels / 40000));
  const seen = new Map<number, number>();
  let samples = 0;
  for (let i = 0; i < pixels; i += step) {
    const o = i * 4;
    // coarse colour (to 1/16), so anti-aliasing noise does not count as a picture
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    samples++;
  }
  const top = Math.max(...Array.from(seen.values()));
  return top / samples > 0.998;
}

/** `AYRA_EURUSD_1h_2026-11-02_14-05.png` (local time). */
export function shotFileName(ticker: string, interval: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `AYRA_${safe(ticker) || "chart"}_${safe(interval) || "tf"}_${date}.png`;
}

// ---- Filming the tab ----

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

export interface TabFrame {
  canvas: HTMLCanvasElement;
  /** Frame pixels per page pixel. */
  scale: number;
}

/**
 * Films the tab once: the browser asks for permission (this tab is offered first), then one picture is taken and the
 * filming stops at once. `measure` runs right before the picture, so the page's places match it (Chrome's «sharing
 * this tab» bar can make the window a little lower).
 */
export async function captureTab<T>(measure: () => T): Promise<{ frame: TabFrame; measured: T }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 5 },
      audio: false,
      // Chrome: offer this tab first, and allow it
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (e) {
    throw new ShotError(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "failed");
  }
  const track = stream.getVideoTracks()[0];
  const video = document.createElement("video");
  try {
    const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    if (!track || (surface && surface !== "browser")) throw new ShotError("notTab");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // the page settles after the browser's bar appears; the picture follows the window's new size
    let matched = false;
    for (let i = 0; i < 20 && !matched; i++) {
      await wait(i === 0 ? 400 : 100);
      matched = framesMatch(video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight);
    }
    if (!matched) throw new ShotError("notTab");
    await nextFrame();
    const measured = measure();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ShotError("failed");
    ctx.drawImage(video, 0, 0);
    return { frame: { canvas, scale: video.videoWidth / window.innerWidth }, measured };
  } catch (e) {
    throw e instanceof ShotError ? e : new ShotError("failed");
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}

// ---- Putting the picture together ----

const COLORS = {
  ink: "#121117",
  s1: "#18171f",
  line: "#2c2a38",
  tx: "#ebe9f3",
  mu: "#a09eb2",
  vi: "#a38ad1",
  long: "#34d399",
  chart: "#18171f",
};
const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SANS = "Manrope, system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Words onto lines no wider than `max`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, radius);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, radius);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, radius);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, radius);
  ctx.closePath();
}

/** The card's lines and its height (page pixels). */
function cardLines(ctx: CanvasRenderingContext2D, clock: ShotClock) {
  const inner = SHOT_CARD_W - 24;
  ctx.font = `14px ${SANS}`;
  const session = wrap(ctx, clock.session, inner - 16);
  const market = wrap(ctx, clock.market, inner - 16);
  ctx.font = `11px ${SANS}`;
  const note = wrap(ctx, clock.note, inner);
  const height = 12 + 16 + 30 + 16 + 8 + session.length * 20 + 8 + market.length * 20 + 8 + note.length * 15 + 12;
  return { session, market, note, height };
}

function drawCard(ctx: CanvasRenderingContext2D, r: Rect, clock: ShotClock, lines: ReturnType<typeof cardLines>) {
  roundRect(ctx, r, 12);
  ctx.fillStyle = COLORS.s1;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  const x = r.x + 12;
  let y = r.y + 12;
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.mu;
  ctx.font = `600 12px ${SANS}`;
  ctx.fillText(clock.title.toUpperCase(), x, y);
  y += 16;
  ctx.fillStyle = COLORS.tx;
  ctx.font = `600 24px ${MONO}`;
  ctx.fillText(clock.time, x, y);
  y += 30;
  ctx.fillStyle = COLORS.mu;
  ctx.font = `11px ${SANS}`;
  ctx.fillText(clock.zone, x, y);
  y += 16 + 8;
  const dotted = (texts: string[], color: string | null) => {
    ctx.beginPath();
    ctx.arc(x + 4, y + 9, 4, 0, Math.PI * 2);
    if (color) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = COLORS.mu;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.tx;
    ctx.font = `14px ${SANS}`;
    for (const t of texts) {
      ctx.fillText(t, x + 16, y + 2);
      y += 20;
    }
  };
  dotted(lines.session, clock.sessionOn ? COLORS.vi : null);
  y += 8;
  dotted(lines.market, clock.marketOpen ? COLORS.long : "rgba(160,158,178,0.5)");
  y += 8;
  ctx.fillStyle = COLORS.mu;
  ctx.font = `11px ${SANS}`;
  for (const t of lines.note) {
    ctx.fillText(t, x, y);
    y += 15;
  }
}

/** The finished picture: our line on top, the chart cut from the tab's frame, the card, the AYRA mark. */
export function composeShot(frame: TabFrame, input: ShotInput): HTMLCanvasElement {
  const s = frame.scale;
  const out = document.createElement("canvas");
  const probe = out.getContext("2d");
  if (!probe) throw new ShotError("failed");
  const lines = input.clock ? cardLines(probe, input.clock) : null;
  const layout = shotLayout(input.grid, lines ? lines.height : null);
  out.width = Math.round(layout.width * s);
  out.height = Math.round(layout.height * s);
  const ctx = out.getContext("2d")!;
  ctx.scale(s, s);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // the chart, cut from the tab's picture at its own resolution
  const g = input.grid;
  ctx.drawImage(frame.canvas, g.x * s, g.y * s, g.w * s, g.h * s, layout.chart.x, layout.chart.y, layout.chart.w, layout.chart.h);
  // every chart window must have a picture (not an empty square)
  const source = frame.canvas.getContext("2d");
  for (const w of input.widgets.length ? input.widgets : [g]) {
    const sample = source?.getImageData(Math.round(w.x * s), Math.round(w.y * s), Math.max(1, Math.round(w.w * s)), Math.max(1, Math.round(w.h * s)));
    if (!sample || looksBlank(sample.data)) throw new ShotError("blank");
  }
  if (input.minor) {
    ctx.fillStyle = COLORS.chart;
    for (const c of legendCovers(g, input.widgets, input.drawing)) ctx.fillRect(layout.chart.x + c.x, layout.chart.y + c.y, c.w, c.h);
  }

  // the line with the instrument and timeframe
  ctx.textBaseline = "middle";
  const mid = SHOT_PAD + SHOT_HEADER / 2 - 4;
  ctx.fillStyle = COLORS.tx;
  ctx.font = `700 20px ${SERIF}`;
  ctx.fillText(input.name, SHOT_PAD, mid);
  const nameW = ctx.measureText(input.name).width;
  ctx.fillStyle = COLORS.mu;
  ctx.font = `600 14px ${SANS}`;
  ctx.fillText(`${input.ticker} · ${input.interval}`, SHOT_PAD + nameW + 12, mid + 1);

  // the AYRA mark in the corner
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.vi;
  ctx.font = `700 15px ${SERIF}`;
  ctx.fillText("AYRA", layout.width - SHOT_PAD, mid);
  ctx.textAlign = "left";

  if (input.clock && lines && layout.card) drawCard(ctx, layout.card, input.clock, lines);
  return out;
}

/** The picture as a PNG file. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ShotError("failed"))), "image/png"));
}
