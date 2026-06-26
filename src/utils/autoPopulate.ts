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
  /** Skip the final use-everything phase that packs neutral leftovers into gaps. */
  noFillers?: boolean;
  /** Item ids to exclude from ANY placement in this room (e.g. suppressor idols in Breeding). */
  excludeItemIds?: string[];
}

/** One room's share of an auto-fill request (house fills carry one per room). */
export interface RoomFillPlan {
  roomIndex: number;
  weights: StatWeights;
  mustInclude: string[];
  minStats?: Partial<Record<StatKey, number>>;
  excludeItemIds?: string[];
}

export interface FillProgress {
  /** 0..1 share of the search budget consumed. */
  fraction: number;
  /** Best layout's weighted stat score so far. */
  bestScore: number;
  /** Pieces in the best layout so far. */
  pieces: number;
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
  const { weights, allFurniture, ownership, usedInOtherRooms, mustInclude, minStats, excludeItemIds } = opts;
  const mandatoryIds = new Set(mustInclude ?? []);
  const exclusions = new Set(excludeItemIds ?? []);
  const floorStats = Object.keys(minStats ?? {}) as StatKey[];
  // Stats with weight -2: items with ANY of these stats are completely banned.
  const bannedStats = Object.entries(weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
  const candidates: Candidate[] = [];
  for (const item of allFurniture) {
    const mandatory = mandatoryIds.has(item.id);
    if (exclusions.has(item.id) && !mandatory) continue;
    if (bannedStats.some((st) => item[st] > 0) && !mandatory) continue; // -2 = absolute ban (ignored for must-include)
    const remaining = (ownership[item.id] ?? 0) - (usedInOtherRooms[item.id] ?? 0);
    if (remaining <= 0) continue;
    const score = statScore(item, weights);
    // Keep items that score, are forced, can contribute to a stat floor, or
    // are harmless space fillers (score 0) for the use-everything phase.
    const helpsFloor = floorStats.some((st) => item[st] > 0);
    if (score < 0 && !mandatory && !helpsFloor) continue;
    if (score === 0 && !mandatory && !helpsFloor && opts.noFillers) continue;
    candidates.push({ item, score, remaining, mandatory });
  }
  return candidates;
}

export type SortMode = 'efficiency' | 'sizeFirst';

/**
 * Order candidates for the score phase. 'efficiency' = best score-per-space
 * first (dense trinket walls); 'sizeFirst' = large scoring items first so the
 * big pieces claim floor space before small items plug the gaps they leave.
 * With rng, jitter the key to vary order between runs.
 */
function sortCandidates(candidates: Candidate[], rng?: Rng, mode: SortMode = 'efficiency'): void {
  const jitter = new Map<string, number>();
  if (rng) {
    for (const c of candidates) jitter.set(c.item.id, 1 + (rng() - 0.5) * 0.5);
  }
  const efficiency = (c: Candidate) => (c.score / c.item.spacesOccupied) * (jitter.get(c.item.id) ?? 1);
  const size = (c: Candidate) => (c.score > 0 ? c.item.spacesOccupied : 0) * (jitter.get(c.item.id) ?? 1);
  candidates.sort((a, b) =>
    Number(b.mandatory) - Number(a.mandatory)
    || (mode === 'sizeFirst' ? size(b) - size(a) || b.score - a.score : 0)
    || efficiency(b) - efficiency(a)
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

  const fillLoop = (pool: Candidate[]) => {
    failed.clear();
    for (;;) {
      let progress = false;
      for (const cand of pool) {
        if (cand.remaining <= 0 || failed.has(cand.item.id)) continue;
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
  };

  fillLoop(candidates.filter((c) => c.score > 0));

  // Phase 4: pack the leftover gaps with harmless owned items (score 0) and
  // remaining scoring copies, largest pieces first — use up the collection.
  const fillers = candidates
    .filter((c) => c.remaining > 0 && c.score >= 0)
    .sort((a, b) =>
      b.item.spacesOccupied - a.item.spacesOccupied
      || b.score - a.score
      || a.item.name.localeCompare(b.item.name));
  fillLoop(fillers);

  return placed;
}

function totalScore(placed: PlacedFurniture[], weights: StatWeights): number {
  let sum = 0;
  for (const p of placed) sum += statScore(p.item, weights);
  return sum;
}

function runGreedy(opts: AutoPopulateOptions, cfg: RoomConfig, rng?: Rng, scan?: ScanMode, mode?: SortMode): PlacedFurniture[] {
  const candidates = buildCandidates(opts);
  sortCandidates(candidates, rng, mode);
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
  sortCandidates(candidates, rng, rng() < 0.5 ? 'sizeFirst' : 'efficiency');

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

interface MaximizeState {
  rng: Rng;
  best: PlacedFurniture[];
  bestScore: number;
  round: number;
}

const cellsUsed = (layout: PlacedFurniture[]) =>
  layout.reduce((s, p) => s + p.item.spacesOccupied, 0);

function startMaximize(opts: AutoPopulateOptions, cfg: RoomConfig): MaximizeState {
  const best = runGreedy(opts, cfg); // deterministic baseline
  return {
    rng: mulberry32(opts.seed ?? Date.now()),
    best,
    bestScore: totalScore(best, opts.weights),
    round: 0,
  };
}

function maximizeRound(state: MaximizeState, opts: AutoPopulateOptions, cfg: RoomConfig): void {
  const { rng } = state;
  const consider = (layout: PlacedFurniture[]) => {
    const score = totalScore(layout, opts.weights);
    if (
      score > state.bestScore
      || (score === state.bestScore && cellsUsed(layout) > cellsUsed(state.best))
      || (score === state.bestScore && cellsUsed(layout) === cellsUsed(state.best) && layout.length > state.best.length)
    ) {
      state.best = layout;
      state.bestScore = score;
    }
  };
  // multi-start: fresh randomized greedy with a random scan direction,
  // alternating large-pieces-first and score-density orderings
  consider(runGreedy(opts, cfg, rng, {
    rowsReversed: rng() < 0.5,
    colsReversed: rng() < 0.5,
  }, rng() < 0.5 ? 'sizeFirst' : 'efficiency'));
  // local search: perturb the current best
  consider(ruinAndRecreate(state.best, opts, cfg, rng));
  state.round += 1;
}

function runMaximize(opts: AutoPopulateOptions, cfg: RoomConfig): PlacedFurniture[] {
  const deadline = Date.now() + (opts.budgetMs ?? 400);
  const state = startMaximize(opts, cfg);
  do {
    maximizeRound(state, opts, cfg);
  } while (opts.iterations !== undefined ? state.round < opts.iterations : Date.now() < deadline);
  return state.best;
}

export function autoPopulateRoom(opts: AutoPopulateOptions): PlacedFurniture[] {
  const cfg = getRoomConfig(opts.roomIndex);
  if (opts.algorithm === 'maximize') return runMaximize(opts, cfg);
  return runGreedy(opts, cfg);
}

/**
 * Async variant of autoPopulateRoom that yields to the event loop between
 * search rounds so the UI stays responsive, reporting progress along the way.
 */
export async function autoPopulateRoomAsync(
  opts: AutoPopulateOptions,
  onProgress?: (p: FillProgress) => void,
): Promise<PlacedFurniture[]> {
  const cfg = getRoomConfig(opts.roomIndex);
  if (opts.algorithm !== 'maximize') {
    const result = runGreedy(opts, cfg);
    onProgress?.({ fraction: 1, bestScore: totalScore(result, opts.weights), pieces: result.length });
    return result;
  }

  const budget = opts.budgetMs ?? 400;
  const start = Date.now();
  const state = startMaximize(opts, cfg);
  let lastYield = start;
  for (;;) {
    maximizeRound(state, opts, cfg);
    const now = Date.now();
    const fraction = opts.iterations !== undefined
      ? state.round / opts.iterations
      : Math.min(1, (now - start) / budget);
    if (opts.iterations !== undefined ? state.round >= opts.iterations : now >= start + budget) break;
    if (now - lastYield >= 40) {
      onProgress?.({ fraction, bestScore: state.bestScore, pieces: state.best.length });
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  onProgress?.({ fraction: 1, bestScore: state.bestScore, pieces: state.best.length });
  return state.best;
}
