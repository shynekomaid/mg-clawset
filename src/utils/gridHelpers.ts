import type { FurnitureItem, PlacedFurniture, RoomConfig } from '../types/furniture';

export function buildOccupancy(placed: PlacedFurniture[], cfg: RoomConfig, ignoreId?: string, ignoreIds?: Set<string>): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: cfg.rows }, () =>
    Array(cfg.cols).fill(null),
  );
  for (const p of placed) {
    if (p.instanceId === ignoreId) continue;
    if (ignoreIds?.has(p.instanceId)) continue;
    const shape = p.item.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        const cellType = shape[r][c];
        if (cellType === 2 || cellType === 3) {
          const gr = p.row + r;
          const gc = p.col + c;
          if (gr >= 0 && gr < cfg.rows && gc >= 0 && gc < cfg.cols) {
            grid[gr][gc] = p.instanceId;
          }
        }
      }
    }
  }
  return grid;
}

export function buildAnchorPointSet(placed: PlacedFurniture[], cfg: RoomConfig, ignoreId?: string, ignoreIds?: Set<string>): Set<string> {
  const set = new Set<string>();

  // Bottom boundary anchors
  for (let c = 0; c < cfg.cols; c++) {
    set.add(`${cfg.rows},${c}`);
  }

  // Top boundary anchors (only for rooms that have them)
  if (cfg.hasTopAnchors) {
    for (let c = 0; c < cfg.cols; c++) {
      set.add(`${-1},${c}`);
    }
  }

  for (const p of placed) {
    if (p.instanceId === ignoreId) continue;
    if (ignoreIds?.has(p.instanceId)) continue;
    const shape = p.item.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] === 3) {
          set.add(`${p.row + r},${p.col + c}`);
        }
      }
    }
  }
  return set;
}

export function canPlace(
  item: FurnitureItem,
  row: number,
  col: number,
  occupancy: (string | null)[][],
  anchorPointSet: Set<string>,
  cfg: RoomConfig,
): boolean {
  const shape = item.shape;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      const cellType = shape[r][c];
      const gr = row + r;
      const gc = col + c;
      if (cellType === 2 || cellType === 3) {
        if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return false;
        if (!cfg.isValidCell(gr, gc)) return false;
        if (occupancy[gr][gc] !== null) return false;
      }
      if (cellType === 4) {
        if (gc < 0 || gc >= cfg.cols) return false;
        if (!anchorPointSet.has(`${gr},${gc}`)) return false;
      }
      if (cellType === 5) {
        if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return false;
        if (!cfg.isValidCell(gr, gc)) return false;
      }
    }
  }

  if (cfg.looseItemsNeedSupport) {
    // anchorless items may not float in this room: at least one cell
    // directly below the bottom solid row must be floor or occupied
    let hasAnchor = false;
    let maxR = -1;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] === 4) hasAnchor = true;
        if ((shape[r][c] === 2 || shape[r][c] === 3) && r > maxR) maxR = r;
      }
    }
    if (!hasAnchor && maxR >= 0) {
      let supported = false;
      for (let c = 0; c < shape[maxR].length; c++) {
        if (shape[maxR][c] !== 2 && shape[maxR][c] !== 3) continue;
        const below = row + maxR + 1;
        const gc = col + c;
        if (below >= cfg.rows) { supported = true; break; }
        // resting on an anchor point is fine; plain solids give no grip
        if (anchorPointSet.has(`${below},${gc}`)) { supported = true; break; }
      }
      if (!supported) return false;
    }
  }
  return true;
}

export function getVisualBounds(shape: number[][]): { minR: number; maxR: number; minC: number; maxC: number } {
  let minR = shape.length;
  let maxR = -1;
  let minC = shape[0]?.length ?? 0;
  let maxC = -1;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      const t = shape[r][c];
      if (t === 2 || t === 3 || t === 5) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR === -1) {
    minR = 0;
    maxR = shape.length - 1;
    minC = 0;
    maxC = Math.max(...shape.map((row) => row.length)) - 1;
  }
  return { minR, maxR, minC, maxC };
}

export function getImageAlignment(shape: number[][]): 'top' | 'bottom' | 'center' {
  const vis = getVisualBounds(shape);

  let topHasAnchorPoint = false;
  if (vis.minR >= 0 && vis.minR < shape.length) {
    topHasAnchorPoint = shape[vis.minR].some(c => c === 3);
  }

  let hasAnchorBelow = false;
  for (let r = vis.maxR + 1; r < shape.length; r++) {
    if (shape[r].some(c => c === 4)) { hasAnchorBelow = true; break; }
  }

  if (hasAnchorBelow) return 'bottom';
  if (topHasAnchorPoint) return 'top';
  return 'center';
}
