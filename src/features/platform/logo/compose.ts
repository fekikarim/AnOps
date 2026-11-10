/** Browser-side logo composition (crop, position, background, optional organization name). Pure canvas code, no network. */

export type LogoEdit = {
  zoom: number; //      1 = fit, up to 3
  x: number; //         horizontal offset, percent of the canvas (-40..40)
  y: number; //         vertical offset
  padding: number; //   percent of the canvas kept free around the artwork (0..30)
  background: "white" | "transparent" | "ink" | "lime" | "custom";
  customColor: string;
  removePlainBackground: boolean;
  tolerance: number; // 4..80, how different from the corner colour a pixel may be and still count as background
  showName: boolean;
};

export const DEFAULT_EDIT: LogoEdit = { zoom: 1, x: 0, y: 0, padding: 8, background: "white", customColor: "#f7f7f2", removePlainBackground: false, tolerance: 28, showName: false };

export const CANVAS_SIZE = 1024;
const MAX_BYTES = 3 * 1024 * 1024;
const BACKGROUNDS: Record<Exclude<LogoEdit["background"], "custom" | "transparent">, string> = { white: "#ffffff", ink: "#111f1d", lime: "#c8f03e" };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be read."));
    image.src = src;
  });
}

function backgroundColor(edit: LogoEdit): string | null {
  if (edit.background === "transparent") return null;
  if (edit.background === "custom") return /^#[0-9a-f]{6}$/i.test(edit.customColor) ? edit.customColor : "#ffffff";
  return BACKGROUNDS[edit.background];
}

/** Perceived brightness 0..255, to choose a readable colour for the name. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * Makes the plain background around the artwork transparent: a flood fill from the four corners that stops at the artwork's
 * edges, so colours inside the logo that happen to match the background are kept.
 */
export function knockOutBackground(source: HTMLImageElement, tolerance: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0);
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const corner = (cx: number, cy: number) => {
    const i = (cy * width + cx) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const refs = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
  const similar = (i: number) => refs.some(([r, g, b]) => Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) <= tolerance * 3);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [0, width - 1, (height - 1) * width, height * width - 1];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!similar(p * 4)) continue;
    data[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function composeLogo(source: HTMLImageElement, edit: LogoEdit, organizationName: string, size = CANVAS_SIZE): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const color = backgroundColor(edit);
  if (color) {
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
  }
  const art: CanvasImageSource = edit.removePlainBackground ? knockOutBackground(source, edit.tolerance) : source;
  const pad = (edit.padding / 100) * size;
  const nameBand = edit.showName ? size * 0.2 : 0;
  const areaW = size - pad * 2;
  const areaH = size - pad * 2 - nameBand;
  const w = (art as HTMLImageElement).naturalWidth ?? (art as HTMLCanvasElement).width;
  const h = (art as HTMLImageElement).naturalHeight ?? (art as HTMLCanvasElement).height;
  const scale = Math.min(areaW / w, areaH / h) * edit.zoom;
  const dw = w * scale;
  const dh = h * scale;
  context.save();
  context.beginPath();
  context.rect(0, 0, size, size - nameBand);
  context.clip();
  context.drawImage(art, pad + (areaW - dw) / 2 + (edit.x / 100) * size, pad + (areaH - dh) / 2 + (edit.y / 100) * size, dw, dh);
  context.restore();

  if (edit.showName && organizationName.trim()) {
    if (document.fonts) await document.fonts.load("700 64px Manrope").catch(() => undefined);
    const dark = color ? luminance(color) < 140 : false;
    context.fillStyle = dark ? "#f7f7f2" : "#111f1d";
    context.textAlign = "center";
    context.textBaseline = "middle";
    let fontSize = size * 0.095;
    const label = organizationName.trim();
    context.font = `700 ${fontSize}px Manrope, system-ui, sans-serif`;
    while (context.measureText(label).width > size * 0.86 && fontSize > 18) {
      fontSize -= 2;
      context.font = `700 ${fontSize}px Manrope, system-ui, sans-serif`;
    }
    context.fillText(label, size / 2, size - nameBand / 2 - pad * 0.15, size * 0.86);
  }
  return canvas;
}

/** PNG of the composed logo, kept under the 3 MB limit (re-exported smaller when a very detailed image is too heavy). */
export async function exportPng(source: HTMLImageElement, edit: LogoEdit, organizationName: string): Promise<string> {
  for (const size of [CANVAS_SIZE, 768, 512]) {
    const canvas = await composeLogo(source, edit, organizationName, size);
    const url = canvas.toDataURL("image/png");
    if ((url.length * 3) / 4 <= MAX_BYTES) return url;
  }
  throw new Error("The logo is too detailed to export. Try a simpler image.");
}
