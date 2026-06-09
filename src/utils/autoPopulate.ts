import type { FurnitureItem, PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomConfig } from '../types/furniture';
import { buildOccupancy, buildAnchorPointSet, canPlace } from './gridHelpers';

export type PresetKey = 'breeding' | 'storage' | 'mutation';

export interface PresetDef {
  label: string;
  weights: Partial<Record<StatKey, number>>;
}

export const PRESETS: Record<PresetKey, PresetDef> = {
  breeding: { label: 'Breeding', weights: { comfort: 1.0, stimulation: 1.0 } },
  storage: { label: 'Storage', weights: { comfort: 0.5, health: 1.0, stimulation: -1.0 } },
  mutation: { label: 'Mutation', weights: { comfort: 0.5, mutation: 1.0 } },
};

export function presetScore(item: FurnitureItem, preset: PresetKey): number {
  let score = 0;
  for (const [stat, weight] of Object.entries(PRESETS[preset].weights)) {
    score += item[stat as StatKey] * weight;
  }
  return score;
}

export interface AutoPopulateOptions {
  preset: PresetKey;
  roomIndex: number;
  allFurniture: FurnitureItem[];
  ownership: Record<string, number>;
  usedInOtherRooms: Record<string, number>;
  makeInstanceId: () => string;
}

interface Candidate {
  item: FurnitureItem;
  score: number;
  remaining: number;
}

export function autoPopulateRoom(opts: AutoPopulateOptions): PlacedFurniture[] {
  const { preset, roomIndex, allFurniture, ownership, usedInOtherRooms, makeInstanceId } = opts;
  const cfg = getRoomConfig(roomIndex);

  const candidates: Candidate[] = [];
  for (const item of allFurniture) {
    const remaining = (ownership[item.id] ?? 0) - (usedInOtherRooms[item.id] ?? 0);
    if (remaining <= 0) continue;
    const score = presetScore(item, preset);
    if (score <= 0) continue;
    candidates.push({ item, score, remaining });
  }

  // Best score-per-space first; deterministic tie-breaking
  candidates.sort((a, b) =>
    b.score / b.item.spacesOccupied - a.score / a.item.spacesOccupied
    || b.score - a.score
    || a.item.name.localeCompare(b.item.name),
  );

  const placed: PlacedFurniture[] = [];
  const occupancy = buildOccupancy([], cfg);
  const anchorPoints = buildAnchorPointSet([], cfg);

  // Scan top-left to bottom-right; offsets extended so anchor cells (which may
  // hang outside the solid bounding box) can reach floor/ceiling anchor rows.
  const findSpot = (item: FurnitureItem): { row: number; col: number } | null => {
    const h = item.shape.length;
    const w = Math.max(...item.shape.map((r) => r.length));
    for (let row = -h; row <= cfg.rows; row++) {
      for (let col = -w; col <= cfg.cols; col++) {
        if (canPlace(item, row, col, occupancy, anchorPoints, cfg)) return { row, col };
      }
    }
    return null;
  };

  const applyPlacement = (p: PlacedFurniture): boolean => {
    let addedAnchorPoint = false;
    for (let r = 0; r < p.item.shape.length; r++) {
      for (let c = 0; c < p.item.shape[r].length; c++) {
        const t = p.item.shape[r][c];
        if (t === 2 || t === 3) occupancy[p.row + r][p.col + c] = p.instanceId;
        if (t === 3) {
          anchorPoints.add(`${p.row + r},${p.col + c}`);
          addedAnchorPoint = true;
        }
      }
    }
    return addedAnchorPoint;
  };

  // Items that failed to fit; retried only after new anchor points appear
  // (occupancy only ever shrinks options, anchor points can unlock anchored items).
  const failed = new Set<string>();

  for (;;) {
    let progress = false;
    for (const cand of candidates) {
      if (cand.remaining <= 0 || failed.has(cand.item.id)) continue;
      const spot = findSpot(cand.item);
      if (!spot) {
        failed.add(cand.item.id);
        continue;
      }
      const piece: PlacedFurniture = {
        instanceId: makeInstanceId(),
        item: cand.item,
        row: spot.row,
        col: spot.col,
      };
      placed.push(piece);
      if (applyPlacement(piece)) failed.clear();
      cand.remaining -= 1;
      progress = true;
      break; // restart from best candidate
    }
    if (!progress) break;
  }

  return placed;
}
