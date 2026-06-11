import type { FurnitureItem, PlacedFurniture, RoomConfig } from '../types/furniture';
import { ROOM_COLS, ROOM_ROWS } from '../types/furniture';

export function getAnchorPointCells(p: PlacedFurniture): Set<string> {
  const set = new Set<string>();
  for (let r = 0; r < p.item.shape.length; r++) {
    for (let c = 0; c < p.item.shape[r].length; c++) {
      if (p.item.shape[r][c] === 3) {
        set.add(`${p.row + r},${p.col + c}`);
      }
    }
  }
  return set;
}

export function getAnchorCells(p: PlacedFurniture): Set<string> {
  const set = new Set<string>();
  for (let r = 0; r < p.item.shape.length; r++) {
    for (let c = 0; c < p.item.shape[r].length; c++) {
      if (p.item.shape[r][c] === 4) {
        set.add(`${p.row + r},${p.col + c}`);
      }
    }
  }
  return set;
}

/**
 * Recursively find all pieces anchored to the target (directly or transitively).
 */
export function findAllAnchored(targetId: string, placed: PlacedFurniture[]): string[] {
  const found = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = placed.find(p => p.instanceId === currentId);
    if (!current) continue;
    const currentAPs = getAnchorPointCells(current);
    for (const p of placed) {
      if (p.instanceId === targetId || found.has(p.instanceId)) continue;
      const anchors = getAnchorCells(p);
      let isAnchored = false;
      for (const a of anchors) {
        if (currentAPs.has(a)) { isAnchored = true; break; }
      }
      if (isAnchored) {
        found.add(p.instanceId);
        queue.push(p.instanceId);
      }
    }
  }
  return [...found];
}

/**
 * Find all pieces that lose anchor support when targetId is removed (cascade removal).
 */
export function findAnchoredPieces(targetId: string, placed: PlacedFurniture[], config?: RoomConfig): Set<string> {
  const rows = config?.rows ?? ROOM_ROWS;
  const hasTopAnchors = config?.hasTopAnchors ?? true;

  const toRemove = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    const removedAPs = new Set<string>();
    for (const p of placed) {
      if (toRemove.has(p.instanceId)) {
        for (const ap of getAnchorPointCells(p)) removedAPs.add(ap);
      }
    }
    for (const p of placed) {
      if (toRemove.has(p.instanceId)) continue;
      const anchors = getAnchorCells(p);
      for (const a of anchors) {
        if (removedAPs.has(a)) {
          const [rowStr] = a.split(',');
          const ar = parseInt(rowStr);
          let hasOtherSupport = false;
          if (ar === rows) {
            hasOtherSupport = true;
          } else if (ar === -1 && hasTopAnchors) {
            hasOtherSupport = true;
          } else {
            for (const other of placed) {
              if (toRemove.has(other.instanceId)) continue;
              if (other.instanceId === p.instanceId) continue;
              if (getAnchorPointCells(other).has(a)) {
                hasOtherSupport = true;
                break;
              }
            }
          }
          if (!hasOtherSupport) {
            toRemove.add(p.instanceId);
            changed = true;
            break;
          }
        }
      }
    }

    // Anchorless pieces resting on anchor points (attic rule) fall too
    if (config?.looseItemsNeedSupport) {
      const liveAPs = new Set<string>();
      for (const other of placed) {
        if (toRemove.has(other.instanceId)) continue;
        for (const ap of getAnchorPointCells(other)) liveAPs.add(ap);
      }
      for (const p of placed) {
        if (toRemove.has(p.instanceId)) continue;
        if (getAnchorCells(p).size > 0) continue;
        let maxR = -1;
        p.item.shape.forEach((row, r) => row.forEach((t) => {
          if ((t === 2 || t === 3) && r > maxR) maxR = r;
        }));
        if (maxR < 0) continue;
        let supported = false;
        p.item.shape[maxR].forEach((t, c) => {
          if (t !== 2 && t !== 3) return;
          const below = p.row + maxR + 1;
          if (below >= rows || liveAPs.has(`${below},${p.col + c}`)) supported = true;
        });
        if (!supported) {
          toRemove.add(p.instanceId);
          changed = true;
        }
      }
    }
  }
  toRemove.delete(targetId);
  return toRemove;
}

export function wouldCollide(item: FurnitureItem, row: number, col: number, occupancy: Set<string>, config?: RoomConfig): boolean {
  const rows = config?.rows ?? ROOM_ROWS;
  const cols = config?.cols ?? ROOM_COLS;
  const isValidCell = config?.isValidCell;

  for (let r = 0; r < item.shape.length; r++) {
    for (let c = 0; c < item.shape[r].length; c++) {
      const t = item.shape[r][c];
      if (t === 2 || t === 3) {
        const gr = row + r;
        const gc = col + c;
        if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return true;
        if (isValidCell && !isValidCell(gr, gc)) return true;
        if (occupancy.has(`${gr},${gc}`)) return true;
      }
    }
  }
  return false;
}

/**
 * Check if all pieces in a group can be placed at their positions,
 * given occupancy and anchor points from non-group pieces.
 */
export function canPlaceGroup(
  pieces: { item: FurnitureItem; row: number; col: number }[],
  occupancy: (string | null)[][],
  anchorPointSet: Set<string>,
  config?: RoomConfig,
): boolean {
  const rows = config?.rows ?? ROOM_ROWS;
  const cols = config?.cols ?? ROOM_COLS;
  const isValidCell = config?.isValidCell;

  // Build internal anchor points from the group itself
  const groupAPs = new Set(anchorPointSet);
  for (const p of pieces) {
    for (let r = 0; r < p.item.shape.length; r++) {
      for (let c = 0; c < p.item.shape[r].length; c++) {
        if (p.item.shape[r][c] === 3) {
          groupAPs.add(`${p.row + r},${p.col + c}`);
        }
      }
    }
  }

  for (const p of pieces) {
    const shape = p.item.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        const cellType = shape[r][c];
        const gr = p.row + r;
        const gc = p.col + c;
        if (cellType === 2 || cellType === 3) {
          if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return false;
          if (isValidCell && !isValidCell(gr, gc)) return false;
          if (occupancy[gr][gc] !== null) return false;
        }
        if (cellType === 4) {
          if (gc < 0 || gc >= cols) return false;
          if (!groupAPs.has(`${gr},${gc}`)) return false;
        }
        if (cellType === 5) {
          if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return false;
          if (isValidCell && !isValidCell(gr, gc)) return false;
        }
      }
    }
  }
  return true;
}
