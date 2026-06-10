import type { FurnitureItem, PlacedFurniture, RoomConfig, StatKey } from '../types/furniture';
import { getRoomConfig } from '../types/furniture';
import { buildOccupancy, buildAnchorPointSet, canPlace } from './gridHelpers';
import { findAnchoredPieces } from './anchorHelpers';

export type AlgorithmKey = 'greedy' | 'maximize';

export const ALL_STATS: StatKey[] = ['appeal', 'comfort', 'stimulation', 'health', 'mutation'];

export const STAT_LABELS: Record<StatKey, string> = {
  appeal: 'Appeal',
  comfort: 'Comfort',
  stimulation: 'Stimulation',
  health: 'Health',
  mutation: 'Mutation',
};

export const ALGORITHMS: Record<AlgorithmKey, { label: string; description: string }> = {
  greedy: { label: 'Quick', description: 'Deterministic greedy fill — instant, same result every time' },
  maximize: { label: 'Maximize', description: 'Randomized search — tries many layouts, keeps the best (~0.5s)' },
};

export type StatWeights = Partial<Record<StatKey, number>>;

export function statScore(item: FurnitureItem, weights: StatWeights): number {
  let score = 0;
  for (const [stat, w] of Object.entries(weights)) score += item[stat as StatKey] * w;
  return score;
}

export interface AutoPopulateOptions {
  /** Stat weights; items are scored by the weighted sum (negative = avoid). */
  weights: StatWeights;
  roomIndex: number;
  allFurniture: FurnitureItem[];
  ownership: Record<string, number>;
  usedInOtherRooms: Record<string, number>;
  makeInstanceId: () => string;
  algorithm?: AlgorithmKey;
  /** Time budget for 'maximize' in ms (default 400). */
  budgetMs?: number;
  /** RNG seed for 'maximize'; defaults to Date.now(). Fixed seed = reproducible layout. */
  seed?: number;
  /** Exact number of 'maximize' search rounds; overrides budgetMs. Seed + iterations = fully deterministic. */
  iterations?: number;
  /** Item ids that must be placed (all owned copies) regardless of score — idols, food boxes. */
  mustInclude?: string[];
  /** Minimum room totals to satisfy before maximizing, e.g. { comfort: 4 } for breeding. */
  minStats?: Partial<Record<StatKey, number>>;
}

interface Candidate {
  item: FurnitureItem;
  score: number;
  remaining: number;
  mandatory: boolean;
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScanMode {
  rowsReversed: boolean;
  colsReversed: boolean;
}

function buildCandidates(opts: AutoPopulateOptions): Candidate[] {
  const { weights, allFurniture, ownership, usedInOtherRooms, mustInclude, minStats } = opts;
  const mandatoryIds = new Set(mustInclude ?? []);
  const floorStats = Object.keys(minStats ?? {}) as StatKey[];
  const candidates: Candidate[] = [];
  for (const item of allFurniture) {
    const remaining = (ownership[item.id] ?? 0) - (usedInOtherRooms[item.id] ?? 0);
    if (remaining <= 0) continue;
    const mandatory = mandatoryIds.has(item.id);
    const score = statScore(item, weights);
    // Keep items that score, are forced, or can contribute to a stat floor
    const helpsFloor = floorStats.some((st) => item[st] > 0);
    if (score <= 0 && !mandatory && !helpsFloor) continue;
    candidates.push({ item, score, remaining, mandatory });
  }
  return candidates;
}

/** Sort candidates best score-per-space first. With rng, jitter the key to vary order between runs. */
function sortCandidates(candidates: Candidate[], rng?: Rng): void {
  const jitter = new Map<string, number>();
  if (rng) {
    for (const c of candidates) jitter.set(c.item.id, 1 + (rng() - 0.5) * 0.5);
  }
  const key = (c: Candidate) => (c.score / c.item.spacesOccupied) * (jitter.get(c.item.id) ?? 1);
  candidates.sort((a, b) =>
    Number(b.mandatory) - Number(a.mandatory)
    || key(b) - key(a)
    || b.score - a.score
    || a.item.name.localeCompare(b.item.name),
  );
}

/**
 * Greedy fill into existing state (occupancy + anchor points mutated in place).
 * Candidates' `remaining` is mutated. Returns pieces placed by this call.
 */
function fillGreedy(
  candidates: Candidate[],
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  makeInstanceId: () => string,
  scan: ScanMode = { rowsReversed: false, colsReversed: false },
  minStats?: Partial<Record<StatKey, number>>,
  baseTotals?: Partial<Record<StatKey, number>>,
): PlacedFurniture[] {
  // Scan offsets extended so anchor cells (which may hang outside the solid
  // bounding box) can reach floor/ceiling anchor rows.
  const findSpot = (item: FurnitureItem): { row: number; col: number } | null => {
    const h = item.shape.length;
    const w = Math.max(...item.shape.map((r) => r.length));
    for (let ri = -h; ri <= cfg.rows; ri++) {
      const row = scan.rowsReversed ? cfg.rows - h - ri : ri;
      for (let ci = -w; ci <= cfg.cols; ci++) {
        const col = scan.colsReversed ? cfg.cols - w - ci : ci;
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

  const placed: PlacedFurniture[] = [];
  const totals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };

  const tryPlace = (cand: Candidate): boolean => {
    const spot = findSpot(cand.item);
    if (!spot) return false;
    const piece: PlacedFurniture = {
      instanceId: makeInstanceId(),
      item: cand.item,
      row: spot.row,
      col: spot.col,
    };
    placed.push(piece);
    applyPlacement(piece);
    cand.remaining -= 1;
    for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
    return true;
  };

  // Phase 1: mandatory items (all copies)
  for (const cand of candidates) {
    if (!cand.mandatory) continue;
    while (cand.remaining > 0) {
      if (!tryPlace(cand)) break;
    }
  }

  // Phase 2: satisfy stat floors with the most efficient contributors
  if (minStats) {
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      for (;;) {
        if (totals[stat] + (baseTotals?.[stat] ?? 0) >= min) break;
        const pool = candidates
          .filter((c) => c.remaining > 0 && c.item[stat] > 0)
          .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
        let placedOne = false;
        for (const cand of pool) {
          if (tryPlace(cand)) { placedOne = true; break; }
        }
        if (!placedOne) break; // floor unreachable; fill anyway
      }
    }
  }

  // Phase 3: greedy score fill. Items that failed to fit are retried only
  // after new anchor points appear (occupancy only ever shrinks options,
  // anchor points can unlock anchored items).
  const failed = new Set<string>();

  const wouldBreakFloor = (cand: Candidate): boolean => {
    if (!minStats) return false;
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      if (cand.item[stat] < 0 && totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] < min) return true;
    }
    return false;
  };

  // A floor-blocked filler can be unblocked by placing another floor
  // contributor first (e.g. one more sofa buys room for a -1 comfort toy).
  const addHeadroomFor = (cand: Candidate): boolean => {
    if (!minStats) return false;
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      if (cand.item[stat] >= 0) continue;
      if (totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] >= min) continue;
      const pool = candidates
        .filter((c) => c.remaining > 0 && c.item[stat] > 0)
        .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
      for (const h of pool) {
        if (tryPlace(h)) return true;
      }
    }
    return false;
  };

  for (;;) {
    let progress = false;
    for (const cand of candidates) {
      if (cand.remaining <= 0 || failed.has(cand.item.id) || cand.score <= 0) continue;
      if (wouldBreakFloor(cand)) {
        if (addHeadroomFor(cand)) { progress = true; break; }
        continue;
      }
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
      for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
      progress = true;
      break; // restart from best candidate
    }
    if (!progress) break;
  }

  return placed;
}

function totalScore(placed: PlacedFurniture[], weights: StatWeights): number {
  let sum = 0;
  for (const p of placed) sum += statScore(p.item, weights);
  return sum;
}

function runGreedy(opts: AutoPopulateOptions, cfg: RoomConfig, rng?: Rng, scan?: ScanMode): PlacedFurniture[] {
  const candidates = buildCandidates(opts);
  sortCandidates(candidates, rng);
  const occupancy = buildOccupancy([], cfg);
  const anchorPoints = buildAnchorPointSet([], cfg);
  return fillGreedy(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, scan, opts.minStats);
}

/**
 * Remove a random ~ratio of pieces plus everything that loses anchor support,
 * then greedily refill with a fresh random ordering. Returns the new layout.
 */
function ruinAndRecreate(
  layout: PlacedFurniture[],
  opts: AutoPopulateOptions,
  cfg: RoomConfig,
  rng: Rng,
  ratio = 0.3,
): PlacedFurniture[] {
  let kept = [...layout];
  const removeCount = Math.max(1, Math.floor(layout.length * ratio));
  for (let i = 0; i < removeCount && kept.length > 0; i++) {
    const victim = kept[Math.floor(rng() * kept.length)];
    const cascade = findAnchoredPieces(victim.instanceId, kept, cfg);
    const gone = new Set([victim.instanceId, ...cascade]);
    kept = kept.filter((p) => !gone.has(p.instanceId));
  }

  const candidates = buildCandidates(opts);
  const keptCounts: Record<string, number> = {};
  for (const p of kept) keptCounts[p.item.id] = (keptCounts[p.item.id] || 0) + 1;
  for (const c of candidates) c.remaining -= keptCounts[c.item.id] || 0;
  sortCandidates(candidates, rng);

  const keptTotals: Partial<Record<StatKey, number>> = {};
  for (const p of kept) {
    for (const st of ['appeal', 'comfort', 'stimulation', 'health', 'mutation'] as StatKey[]) {
      keptTotals[st] = (keptTotals[st] ?? 0) + p.item[st];
    }
  }

  const occupancy = buildOccupancy(kept, cfg);
  const anchorPoints = buildAnchorPointSet(kept, cfg);
  const added = fillGreedy(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, undefined, opts.minStats, keptTotals);
  return [...kept, ...added];
}

function runMaximize(opts: AutoPopulateOptions, cfg: RoomConfig): PlacedFurniture[] {
  const rng = mulberry32(opts.seed ?? Date.now());
  const deadline = Date.now() + (opts.budgetMs ?? 400);
  const cellsUsed = (layout: PlacedFurniture[]) =>
    layout.reduce((s, p) => s + p.item.spacesOccupied, 0);

  let best = runGreedy(opts, cfg); // deterministic baseline
  let bestScore = totalScore(best, opts.weights);

  const consider = (layout: PlacedFurniture[]) => {
    const score = totalScore(layout, opts.weights);
    if (score > bestScore || (score === bestScore && cellsUsed(layout) > cellsUsed(best))) {
      best = layout;
      bestScore = score;
    }
  };

  let round = 0;
  do {
    // multi-start: fresh randomized greedy with a random scan direction
    consider(runGreedy(opts, cfg, rng, {
      rowsReversed: rng() < 0.5,
      colsReversed: rng() < 0.5,
    }));
    // local search: perturb the current best
    consider(ruinAndRecreate(best, opts, cfg, rng));
    round += 1;
  } while (opts.iterations !== undefined ? round < opts.iterations : Date.now() < deadline);

  return best;
}

export function autoPopulateRoom(opts: AutoPopulateOptions): PlacedFurniture[] {
  const cfg = getRoomConfig(opts.roomIndex);
  if (opts.algorithm === 'maximize') return runMaximize(opts, cfg);
  return runGreedy(opts, cfg);
}
