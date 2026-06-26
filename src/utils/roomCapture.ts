import type { PlacedFurniture, StatKey } from '../types/furniture';
import { ROOM_COLS, ROOM_ROWS, ATTIC_COLS, ATTIC_ROWS, ATTIC_INDEX, isAtticCellValid, getRoomLabel } from '../types/furniture';
import { SVG_NEEDS_ROTATION } from './rotationAssets';

const STATS: StatKey[] = ['appeal', 'comfort', 'stimulation', 'health', 'mutation'];

// Resolved colors (since canvas can't use CSS vars)
const BG_COLOR = '#1a1a1f';
const CELL_BG = '#1f2028';
const CELL_BORDER = '#2e303a';
const TEXT_COLOR = '#c8c8d8';
const TEXT_H_COLOR = '#e8e8f0';
const ACCENT_COLOR = '#e06070';
const WATERMARK_COLOR = '#c8c8d8';

function computeStats(placed: PlacedFurniture[]): Record<StatKey, number> {
  const t: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  for (const p of placed) for (const s of STATS) t[s] += p.item[s];
  return t;
}

function getVisualBounds(shape: number[][]) {
  let minR = shape.length, maxR = -1, minC = shape[0]?.length ?? 0, maxC = -1;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      const t = shape[r][c];
      if (t === 2 || t === 3 || t === 5) {
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR === -1) { minR = 0; maxR = shape.length - 1; minC = 0; maxC = (shape[0]?.length ?? 1) - 1; }
  return { minR, maxR, minC, maxC };
}

function getImageAlignment(shape: number[][]): 'top' | 'bottom' | 'center' {
  const vis = getVisualBounds(shape);
  let hasAnchorBelow = false;
  for (let r = vis.maxR + 1; r < shape.length; r++) {
    if (shape[r].some(c => c === 4)) { hasAnchorBelow = true; break; }
  }
  if (hasAnchorBelow) return 'bottom';
  if (vis.minR >= 0 && vis.minR < shape.length && shape[vis.minR].some(c => c === 3)) return 'top';
  return 'center';
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawStatsBar(
  ctx: CanvasRenderingContext2D,
  stats: Record<StatKey, number>,
  label: string,
  x: number, y: number, w: number, h: number,
  statIcons: Record<StatKey, HTMLImageElement>,
  itemCount?: number,
) {
  // Background
  ctx.fillStyle = 'rgba(30,30,50,0.8)';
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 2, w - 8, h - 4, 6);
  ctx.fill();

  ctx.font = 'bold 14px Rubik, sans-serif';
  ctx.fillStyle = TEXT_H_COLOR;
  ctx.textBaseline = 'middle';
  const cy = y + h / 2;

  // Label
  ctx.fillText(label, x + 12, cy);
  const labelW = ctx.measureText(label).width;

  // Stats
  let sx = x + 12 + labelW + 16;
  const iconSize = 14;
  for (const s of STATS) {
    const icon = statIcons[s];
    if (icon) {
      // Draw icon as white
      const tmp = document.createElement('canvas');
      tmp.width = iconSize;
      tmp.height = iconSize;
      const tc = tmp.getContext('2d')!;
      tc.drawImage(icon, 0, 0, iconSize, iconSize);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = '#ffffff';
      tc.fillRect(0, 0, iconSize, iconSize);
      ctx.drawImage(tmp, sx, cy - iconSize / 2);
      sx += iconSize + 4;
    }
    const val = stats[s];
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = 'bold 13px Rubik, sans-serif';
    ctx.fillText(String(val), sx, cy);
    sx += ctx.measureText(String(val)).width + 12;
  }

  // Item count
  if (itemCount !== undefined) {
    ctx.fillStyle = '#8888aa';
    ctx.font = '12px Rubik, sans-serif';
    const countText = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
    ctx.fillText(countText, x + w - 12 - ctx.measureText(countText).width, cy);
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  placed: PlacedFurniture[],
  x: number, y: number, w: number, h: number,
  loadedImages: Map<string, HTMLImageElement>,
  gridCols: number = ROOM_COLS,
  gridRows: number = ROOM_ROWS,
) {
  const cellW = w / gridCols;
  const cellH = h / gridRows;

  // Grid background
  ctx.fillStyle = CELL_BG;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();

  // Grid lines
  ctx.strokeStyle = CELL_BORDER;
  ctx.lineWidth = 1;
  for (let r = 0; r <= gridRows; r++) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * cellH);
    ctx.lineTo(x + w, y + r * cellH);
    ctx.stroke();
  }
  for (let c = 0; c <= gridCols; c++) {
    ctx.beginPath();
    ctx.moveTo(x + c * cellW, y);
    ctx.lineTo(x + c * cellW, y + h);
    ctx.stroke();
  }

  // Clip to grid bounds so furniture doesn't overflow
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.clip();

  drawFurniture(ctx, placed, x, y, cellW, cellH, loadedImages);

  ctx.restore();

  // Border
  ctx.strokeStyle = CELL_BORDER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.stroke();
}

/** Build the attic outline path — diagonals pass through outer cell corners */
function atticClipPath(ctx: CanvasRenderingContext2D, x: number, y: number, cellW: number, cellH: number) {
  // The diagonals go from the top row corners to the last row's top corners,
  // so they pass through each row's outer staircase corner exactly.
  // Row 0: cols 14–16, Row 7: cols 0–30
  // Left diagonal: (14*cellW, 0) → (0, 7*cellH) — passes through (12*cellW, cellH), (10*cellW, 2*cellH), etc.
  // Right diagonal: (17*cellW, 0) → (31*cellW, 7*cellH)
  // Then the bottom edge at row 8 encloses the last row.
  const topLeftX = x + 14 * cellW;
  const topRightX = x + 17 * cellW;
  const diagBottomY = y + 7 * cellH; // top of last row — diagonal ends here
  const gridBottomY = y + ATTIC_ROWS * cellH; // actual bottom of grid

  ctx.beginPath();
  ctx.moveTo(topLeftX, y);                          // top-left
  ctx.lineTo(topRightX, y);                         // top-right
  ctx.lineTo(x + ATTIC_COLS * cellW, diagBottomY);  // right diagonal end
  ctx.lineTo(x + ATTIC_COLS * cellW, gridBottomY);  // right side down
  ctx.lineTo(x, gridBottomY);                       // bottom-left
  ctx.lineTo(x, diagBottomY);                       // left side up
  ctx.closePath();                                   // back to top-left via left diagonal
}

function drawAtticGrid(
  ctx: CanvasRenderingContext2D,
  placed: PlacedFurniture[],
  x: number, y: number, w: number, h: number,
  loadedImages: Map<string, HTMLImageElement>,
) {
  const cellW = w / ATTIC_COLS;
  const cellH = h / ATTIC_ROWS;

  // Draw cell backgrounds only for valid cells
  for (let r = 0; r < ATTIC_ROWS; r++) {
    for (let c = 0; c < ATTIC_COLS; c++) {
      if (!isAtticCellValid(r, c)) continue;
      ctx.fillStyle = CELL_BG;
      ctx.fillRect(x + c * cellW, y + r * cellH, cellW, cellH);
    }
  }

  // Draw grid lines within the attic shape
  ctx.save();
  atticClipPath(ctx, x, y, cellW, cellH);
  ctx.clip();

  ctx.strokeStyle = CELL_BORDER;
  ctx.lineWidth = 0.5;
  for (let r = 0; r <= ATTIC_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * cellH);
    ctx.lineTo(x + w, y + r * cellH);
    ctx.stroke();
  }
  for (let c = 0; c <= ATTIC_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(x + c * cellW, y);
    ctx.lineTo(x + c * cellW, y + ATTIC_ROWS * cellH);
    ctx.stroke();
  }

  // Draw furniture (clipped to attic shape)
  drawFurniture(ctx, placed, x, y, cellW, cellH, loadedImages);

  ctx.restore();

  // Draw the attic outline border
  ctx.strokeStyle = CELL_BORDER;
  ctx.lineWidth = 2;
  atticClipPath(ctx, x, y, cellW, cellH);
  ctx.stroke();
}

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  placed: PlacedFurniture[],
  x: number, y: number,
  cellW: number, cellH: number,
  loadedImages: Map<string, HTMLImageElement>,
) {
  for (const p of placed) {
    const { minR, maxR, minC, maxC } = getVisualBounds(p.item.shape);
    const vRows = maxR - minR + 1;
    const vCols = maxC - minC + 1;
    const align = getImageAlignment(p.item.shape);

    const imgX = x + (p.col + minC) * cellW;
    const imgY = y + (p.row + minR) * cellH;
    const imgW = vCols * cellW;
    const imgH = vRows * cellH;

    const fixedSrc = p.item.image_url.startsWith('public/')
      ? p.item.image_url.slice(6)
      : p.item.image_url;

    const img = loadedImages.get(fixedSrc);
    if (!img) continue;

    const imgAspect = img.naturalWidth / img.naturalHeight;

    let drawW: number, drawH: number;
    if (imgAspect > imgW / imgH) {
      drawW = imgW;
      drawH = drawW / imgAspect;
    } else {
      drawH = imgH;
      drawW = drawH * imgAspect;
    }

    const needsRotation = SVG_NEEDS_ROTATION.has(fixedSrc);

    if (needsRotation) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(imgX, imgY, imgW, imgH);
      ctx.clip();

      const cx = imgX + imgW / 2;
      const cy = imgY + imgH / 2;
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1.333, 1.333);

      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    } else {
      const drawX = imgX + (imgW - drawW) / 2;
      let drawY: number;
      if (align === 'top') {
        drawY = imgY;
      } else if (align === 'bottom') {
        drawY = imgY + imgH - drawH;
      } else {
        drawY = imgY + (imgH - drawH) / 2;
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }
  }
}

const WATERMARK_BAR_H = 36;

async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  canvasW: number, canvasH: number,
  favicon: HTMLImageElement,
) {
  const iconSize = 20;
  const text = 'https://baenar.github.io/mg-clawset/';

  // Solid background bar
  ctx.fillStyle = 'rgba(20,20,26,0.95)';
  ctx.fillRect(0, canvasH - WATERMARK_BAR_H, canvasW, WATERMARK_BAR_H);

  const cy = canvasH - WATERMARK_BAR_H / 2;
  const pad = 12;

  ctx.drawImage(favicon, pad, cy - iconSize / 2, iconSize, iconSize);

  ctx.fillStyle = WATERMARK_COLOR;
  ctx.font = '12px Rubik, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad + iconSize + 6, cy);
}

async function loadAllImages(rooms: PlacedFurniture[][]): Promise<{
  images: Map<string, HTMLImageElement>;
  statIcons: Record<StatKey, HTMLImageElement>;
  favicon: HTMLImageElement;
}> {
  const srcs = new Set<string>();
  for (const room of rooms) {
    for (const p of room) {
      const src = p.item.image_url.startsWith('public/')
        ? p.item.image_url.slice(6)
        : p.item.image_url;
      srcs.add(src);
    }
  }

  const base = import.meta.env.BASE_URL || '/';
  const images = new Map<string, HTMLImageElement>();
  const promises = [...srcs].map(async (src) => {
    try {
      const img = await loadImage(base + src);
      images.set(src, img);
    } catch { /* skip */ }
  });

  // Load stat icons
  const iconNames: Record<StatKey, string> = {
    appeal: 'Appeal_Icon.png', comfort: 'Comfort_Icon.png', stimulation: 'Stimulation_Icon.png',
    health: 'Health_Icon.png', mutation: 'Mutation_Icon.png',
  };
  const statIcons = {} as Record<StatKey, HTMLImageElement>;
  const iconPromises = STATS.map(async (s) => {
    try {
      statIcons[s] = await loadImage(`${base}icons/${iconNames[s]}`);
    } catch { /* skip */ }
  });

  const faviconPromise = loadImage(`${base}favicon.svg`);

  await Promise.all([...promises, ...iconPromises, faviconPromise.catch(() => null)]);
  const favicon = await faviconPromise.catch(() => {
    // Create a simple fallback
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const cx = c.getContext('2d')!;
    cx.fillStyle = ACCENT_COLOR;
    cx.fillRect(0, 0, 20, 20);
    const img = new Image();
    img.src = c.toDataURL();
    return img;
  });

  return { images, statIcons, favicon };
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

export async function captureRoom(
  rooms: PlacedFurniture[][],
  roomIndex: number,
) {
  const room = rooms[roomIndex];
  const stats = computeStats(room);
  const { images, statIcons, favicon } = await loadAllImages([room]);
  const label = getRoomLabel(roomIndex);
  const isAttic = roomIndex === ATTIC_INDEX;

  const gridW = 1920;
  const roomCols = isAttic ? ATTIC_COLS : ROOM_COLS;
  const roomRows = isAttic ? ATTIC_ROWS : ROOM_ROWS;
  const gridH = gridW * (roomRows / roomCols);
  const statsBarH = 32;
  const pad = 16;
  const canvasW = gridW + pad * 2;
  const canvasH = gridH + statsBarH + pad * 2 + pad / 2 + WATERMARK_BAR_H;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Stats bar
  drawStatsBar(ctx, stats, label, pad, pad, gridW, statsBarH, statIcons, room.length);

  // Grid
  if (isAttic) {
    drawAtticGrid(ctx, room, pad, pad + statsBarH + pad / 2, gridW, gridH, images);
  } else {
    drawGrid(ctx, room, pad, pad + statsBarH + pad / 2, gridW, gridH, images);
  }

  // Watermark
  await drawWatermark(ctx, canvasW, canvasH, favicon);

  downloadCanvas(canvas, `${label.toLowerCase().replace(' ', '-')}.png`);
}

export async function captureHouse(rooms: PlacedFurniture[][]) {
  const { images, statIcons, favicon } = await loadAllImages(rooms);

  const gridW = 1200;
  const gridH = gridW * (ROOM_ROWS / ROOM_COLS);
  const statsBarH = 28;
  const houseSummaryH = 34;
  const pad = 16;
  const gap = 12;

  // Attic dimensions - spans full width of the 2-column layout
  const atticTotalW = gridW * 2 + gap;
  const atticH = atticTotalW * (ATTIC_ROWS / ATTIC_COLS);
  const atticStatsBarH = 28;

  // Layout: 2 columns x 2 rows for regular rooms
  // Room order: Room 4 Room 3 (top), Room 1 Room 2 (bottom)
  const roomOrder = [3, 2, 0, 1]; // Room 4, Room 3, Room 1, Room 2

  const canvasW = pad + atticTotalW + pad;
  const roomBlockH = statsBarH + 4 + gridH;
  const atticBlockH = atticStatsBarH + 4 + atticH;
  const canvasH = pad + houseSummaryH + gap + atticBlockH + gap + roomBlockH + gap + roomBlockH + pad + WATERMARK_BAR_H;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // House summary
  const houseStats: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  let totalItems = 0;
  for (const room of rooms) {
    const rs = computeStats(room);
    for (const s of STATS) houseStats[s] += rs[s];
    totalItems += room.length;
  }
  drawStatsBar(ctx, houseStats, 'House', pad, pad, canvasW - pad * 2, houseSummaryH, statIcons, totalItems);

  // Draw attic
  let curY = pad + houseSummaryH + gap;
  const atticRoom = rooms[ATTIC_INDEX] || [];
  const atticStats = computeStats(atticRoom);
  drawStatsBar(ctx, atticStats, 'Attic', pad, curY, atticTotalW, atticStatsBarH, statIcons, atticRoom.length);
  drawAtticGrid(ctx, atticRoom, pad, curY + atticStatsBarH + 4, atticTotalW, atticH, images);
  curY += atticBlockH + gap;

  // Draw 4 regular rooms in 2x2 grid
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ri = roomOrder[i];
    const room = rooms[ri] || [];
    const stats = computeStats(room);
    const roomLabel = getRoomLabel(ri);

    const rx = pad + col * (gridW + gap);
    const ry = curY + row * (roomBlockH + gap);

    drawStatsBar(ctx, stats, roomLabel, rx, ry, gridW, statsBarH, statIcons, room.length);
    drawGrid(ctx, room, rx, ry + statsBarH + 4, gridW, gridH, images);
  }

  // Watermark
  await drawWatermark(ctx, canvasW, canvasH, favicon);

  downloadCanvas(canvas, 'house.png');
}
