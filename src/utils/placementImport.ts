import type { FurnitureItem, RoomConfig } from '../types/furniture';
import { getRoomConfig } from '../types/furniture';
import type { SavedPlacement } from './savegame';

export interface ImportedPlacement {
  item: FurnitureItem;
  row: number;
  col: number;
}

const solidOffsets = (shape: number[][]) => {
  const cells: [number, number][] = [];
  shape.forEach((row, r) => row.forEach((t, c) => { if (t === 2 || t === 3) cells.push([r, c]); }));
  return cells;
};

const anchorCells = (shape: number[][]) => {
  const cells: [number, number][] = [];
  shape.forEach((row, r) => row.forEach((t, c) => { if (t === 4) cells.push([r, c]); }));
  return cells;
};

// y semantics depend on the anchor direction of the shape:
// bottom-anchored items reference their bottom solid row, hanging and
// wall items their top solid row.
const anchorDir = (shape: number[][]): 'below' | 'above' | 'none' => {
  const sol = solidOffsets(shape);
  const anc = anchorCells(shape);
  if (anc.length === 0) return 'none';
  const maxS = Math.max(...sol.map(([r]) => r));
  const minS = Math.min(...sol.map(([r]) => r));
  if (anc.every(([r]) => r > maxS)) return 'below';
  if (anc.every(([r]) => r < minS)) return 'above';
  return 'none';
};

/**
 * Convert one room's saved placements (z-ordered) into grid positions.
 *
 * The save stores grid coordinates, but dense in-game stacks reference
 * support relationships we cannot read (anchored trinkets may carry their
 * supporter's cell, and some records leave standing furniture without
 * anything beneath it). Two repairs keep the import physical:
 *  - snap-on-top: a standing item whose coordinate cell is already occupied
 *    sits down on that cell via its own anchor offset;
 *  - settle: a standing item with no support under its anchors (own column,
 *    one column of slack for off-by-one records) slides straight down until
 *    its anchors rest on another item or the floor.
 */
export function applyRoomPlacements(
  roomIndex: number,
  placements: SavedPlacement[],
  byId: Map<string, FurnitureItem>,
): ImportedPlacement[] {
  const cfg = getRoomConfig(roomIndex);
  const occupied = new Set<string>();
  const result: ImportedPlacement[] = [];

  const ordered = [...placements].sort((a, b) => a.order - b.order);
  for (const pl of ordered) {
    const item = byId.get(pl.itemId);
    if (!item) continue;
    const solids = solidOffsets(item.shape);
    const anchors = anchorCells(item.shape);
    const minR = Math.min(...solids.map(([r]) => r));
    const maxR = Math.max(...solids.map(([r]) => r));
    const minC = Math.min(...solids.map(([, c]) => c));
    const dir = anchorDir(item.shape);
    const collides = (row0: number, col0: number) =>
      solids.some(([r, c]) => occupied.has(`${row0 + r},${col0 + c}`));

    // pl.row encodes bottom solid for standing items, top solid otherwise
    let row0 = dir === 'below' ? pl.row - maxR : pl.row - minR;
    let col0 = pl.col - minC;

    if (collides(row0, col0) && dir === 'below' && occupied.has(`${pl.row},${pl.col}`)) {
      // coordinate points at the cell it stands on — sit on top of it
      const [ar, ac] = anchors[0];
      if (!collides(pl.row - ar, pl.col - ac)) {
        row0 = pl.row - ar;
        col0 = pl.col - ac;
      }
    }

    if (dir === 'below') {
      // keep stacked items above the room (negative rows) inside the grid
      if (row0 + minR < 0) row0 = -minR;

      const supportedAt = (r0: number) =>
        anchors.some(([ar, ac]) => {
          const r = r0 + ar;
          if (r >= cfg.rows) return true; // resting on the floor
          return occupied.has(`${r},${col0 + ac}`);
        });

      // support must be directly under an anchor cell - counting adjacent
      // columns let pieces "rest" on taller neighbours and float in mid-air
      while (!supportedAt(row0)) row0++;
    }

    for (const [r, c] of solids) occupied.add(`${row0 + r},${col0 + c}`);
    result.push({ item, row: row0, col: col0 });
  }

  settleUnstableChains(result, cfg);
  return result;
}

/**
 * Whole-chain gravity. The per-item pass keeps pieces that rest on other
 * pieces, but a cluster can justify itself in mid-air (each item "supported"
 * by the next, none touching the floor). Compute stability transitively from
 * the floor and drop every unstable piece in lock-step until its anchors meet
 * a stable piece or the floor — sinking clusters land as intact stacks.
 */
function settleUnstableChains(pieces: ImportedPlacement[], cfg: RoomConfig): void {
  const falls = pieces.map((p) => anchorDir(p.item.shape) === 'below');

  for (let guard = 0; guard < cfg.rows * pieces.length; guard++) {
    const stable = new Set<number>();
    pieces.forEach((_, i) => { if (!falls[i]) stable.add(i); });

    const cellOwner = new Map<string, number>();
    pieces.forEach((p, i) => {
      for (const [r, c] of solidOffsets(p.item.shape)) cellOwner.set(`${p.row + r},${p.col + c}`, i);
    });

    for (let changed = true; changed;) {
      changed = false;
      pieces.forEach((p, i) => {
        if (stable.has(i)) return;
        const anchors = anchorCells(p.item.shape);
        const probe = anchors.length ? anchors : solidOffsets(p.item.shape).filter(
          ([r]) => r === Math.max(...solidOffsets(p.item.shape).map(([rr]) => rr)),
        ).map(([r, c]): [number, number] => [r + 1, c]);
        for (const [ar, ac] of probe) {
          const r = p.row + ar;
          if (r >= cfg.rows) { stable.add(i); changed = true; return; }
          const owner = cellOwner.get(`${r},${p.col + ac}`);
          if (owner !== undefined && owner !== i && stable.has(owner)) {
            stable.add(i); changed = true; return;
          }
        }
      });
    }

    const unstable = pieces.map((_, i) => i).filter((i) => !stable.has(i));
    if (unstable.length === 0) return;
    for (const i of unstable) pieces[i].row += 1;
  }
}
