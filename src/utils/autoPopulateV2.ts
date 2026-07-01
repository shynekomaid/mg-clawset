/**
 * autoPopulateV2.ts — Enablement-aware fill algorithm
 *
 * A complete alternative fill algorithm that accounts for:
 *   • Enablement value (type-5 hollow cells + type-3 anchor points)
 *   • Placement difficulty (irregular shapes first)
 *   • Best-fit position scoring (corners, edges, fragmentation)
 *   • Targeted ruin-and-recreate (sparse-area removal)
 *   • Coverage-aware maximize acceptance
 *
 * Self-contained — no imports from autoPopulate.ts (avoids circular deps).
 */

import type { FurnitureItem, PlacedFurniture, RoomConfig, StatKey } from '../types/furniture';
import { getRoomConfig } from '../types/furniture';
import { buildOccupancy, buildAnchorPointSet, canPlace } from './gridHelpers';
import { findAnchoredPieces } from './anchorHelpers';

// ─── Types ────────────────────────────────────────────────────────────────

export type AlgorithmKey = 'maximize-v2';

export type StatWeights = Partial<Record<StatKey, number>>;

/** Tunable parameters for the v2 fill algorithm. */
export interface V2Settings {
  sortEnablementWeight: number;
  sortIrregularityWeight: number;
  sortScoreWeight: number;
  sortEfficiencyWeight: number;
  sortLegoBonus: number;
  bestFitCornerWeight: number;
  bestFitEdgeWeight: number;
  bestFitAnchorExposureWeight: number;
  bestFitHollowAccessWeight: number;
  bestFitVerticalWeight: number;
  bestFitFragmentationPenalty: number;
  coverageBonus: number;
  enablementFillerWeight: number;
  enablementHangerWeight: number;
  legoBonusWeight: number;
  ruinSparseRatio: number;
  defaultMaximizeIterations: number;
  /** 0 = fully deterministic; higher values add more random noise to candidate ordering. */
  temperature: number;
}

export const DEFAULT_V2_SETTINGS: V2Settings = {
  sortEnablementWeight: 0.20,
  sortIrregularityWeight: 0.15,
  sortScoreWeight: 0.62,
  sortEfficiencyWeight: 0.15,
  sortLegoBonus: 0.15,
  bestFitCornerWeight: 2.0,
  bestFitEdgeWeight: 1.5,
  bestFitAnchorExposureWeight: 1.0,
  bestFitHollowAccessWeight: 1.0,
  bestFitVerticalWeight: 0.5,
  bestFitFragmentationPenalty: -0.5,
  coverageBonus: 1.5,
  enablementFillerWeight: 1.0,
  enablementHangerWeight: 1.0,
  legoBonusWeight: 0.5,
  ruinSparseRatio: 0.3,
  temperature: 0,
  defaultMaximizeIterations: 10,
};

let currentSettings: V2Settings = { ...DEFAULT_V2_SETTINGS };

/** Apply settings for the current algorithm run. */
function withSettings<T>(settings: V2Settings | undefined, fn: () => T): T {
  const prev = currentSettings;
  if (settings) currentSettings = settings;
  try { return fn(); } finally { currentSettings = prev; }
}

export interface V2Options {
  weights: StatWeights;
  roomIndex: number;
  allFurniture: FurnitureItem[];
  ownership: Record<string, number>;
  usedInOtherRooms: Record<string, number>;
  makeInstanceId: () => string;
  seed?: number;
  iterations?: number;
  mustInclude?: string[];
  minStats?: Partial<Record<StatKey, number>>;
  noFillers?: boolean;
  excludeItemIds?: string[];
  /** Tunable v2 settings; falls back to DEFAULT_V2_SETTINGS when omitted. */
  v2Settings?: V2Settings;
  /** AbortSignal to cancel an in-progress room fill mid-search. */
  signal?: AbortSignal;
}

export interface ShapeProfile {
  solidCells: number;
  hollowCells: number;
  anchorPoints: number;
  hasAnchors: boolean;
  hasHollow: boolean;
  irregularity: number;
  boundingBox: { height: number; width: number };
  enablementScore: number;
  verticalWasteFactor: number;
  isLego: boolean;
}

interface Candidate {
  item: FurnitureItem;
  score: number;
  profile: ShapeProfile;
  remaining: number;
  mandatory: boolean;
}

type Rng = () => number;

interface MaximizeState {
  rng: Rng;
  best: PlacedFurniture[];
  bestScore: number;
  bestCombined: number;
  round: number;
}

interface FillProgress {
  fraction: number;
  bestScore: number;
  pieces: number;
}

// ─── Constants (now driven by V2Settings, defaults in V2Settings interface above) ─────────────

// ─── Helpers ──────────────────────────────────────────────────────────────

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statScore(item: FurnitureItem, weights: StatWeights): number {
  let score = 0;
  for (const [stat, w] of Object.entries(weights)) score += item[stat as StatKey] * w;
  return score;
}

function getSolidCells(shape: number[][]): number {
  let count = 0;
  for (const row of shape) for (const cell of row) if (cell === 2 || cell === 3) count++;
  return count;
}

function getBoundingBox(shape: number[][]): { height: number; width: number } {
  const height = shape.length;
  const width = Math.max(...shape.map(r => r.length));
  return { height, width };
}

// ─── Shape Profiling ──────────────────────────────────────────────────────

export function computeShapeProfile(item: FurnitureItem): ShapeProfile {
  const { height, width } = getBoundingBox(item.shape);
  const bboxArea = height * width;
  const solid = getSolidCells(item.shape);

  let hollowCells = 0;
  let anchorPoints = 0;
  let hasAnchors = false;

  for (const row of item.shape) {
    for (const cell of row) {
      if (cell === 5) hollowCells++;
      if (cell === 3) anchorPoints++;
      if (cell === 4) hasAnchors = true;
    }
  }

  const irregularity = solid > 0 ? bboxArea / solid : 1;
  const hasHollow = hollowCells > 0;
  const enablementScore =
    hollowCells * currentSettings.enablementFillerWeight +
    anchorPoints * currentSettings.enablementHangerWeight +
    (hasAnchors ? anchorPoints * currentSettings.legoBonusWeight : 0);

  // Vertical waste: items with anchors (type-4) or hollow (type-5) have no waste
  let verticalWasteFactor = 0;
  if (!hasAnchors && !hasHollow && solid > 0) {
    // For solid-only items: find the last row with solid content
    let lastSolidRow = 0;
    for (let r = 0; r < item.shape.length; r++) {
      for (const cell of item.shape[r]) {
        if (cell === 2 || cell === 3) { lastSolidRow = r + 1; break; }
      }
    }
    verticalWasteFactor = item.shape.length > 0 ? (item.shape.length - lastSolidRow) / item.shape.length : 0;
  }

  const isLego = hasAnchors && (anchorPoints > 0 || hollowCells > 0);

  return {
    solidCells: solid,
    hollowCells,
    anchorPoints,
    hasAnchors,
    hasHollow,
    irregularity,
    boundingBox: { height, width },
    enablementScore,
    verticalWasteFactor,
    isLego,
  };
}

// ─── Enablement / Difficulty ──────────────────────────────────────────────

export function computeEnablementScore(profile: ShapeProfile): number {
  return profile.enablementScore;
}

export function isLegoItem(profile: ShapeProfile): boolean {
  return profile.isLego;
}

export function computePlacementDifficulty(profile: ShapeProfile): number {
  const { irregularity } = profile;
  // Bonus for very irregular shapes (niche shapes need priority placement)
  return irregularity + (irregularity > 2 ? 2 : 0);
}

export function isRectangular(shape: number[][]): boolean {
  for (const row of shape) for (const cell of row) if (cell === 1) return false;
  return true;
}

export function getVerticalWasteFactor(profile: ShapeProfile): number {
  return profile.verticalWasteFactor;
}

// ─── Best-Fit Position Quality ────────────────────────────────────────────

export function bestFitQualityScore(
  item: FurnitureItem,
  row: number,
  col: number,
  occupancy: (string | null)[][],
  _anchorPoints: Set<string>,
  cfg: RoomConfig,
  profile: ShapeProfile,
): number {
  let score = 0;
  const { height, width } = profile.boundingBox;

  // 1. Corner preference: positions near room edges
  const distTop = row >= 0 ? row : -row;
  const distBottom = cfg.rows - (row + height);
  const distLeft = col >= 0 ? col : -col;
  const distRight = cfg.cols - (col + width);
  const minHoriz = Math.max(0, Math.min(distLeft, distRight));
  const minVert = Math.max(0, Math.min(distTop, distBottom));
  const cornerBonus = (cfg.rows - minVert) / cfg.rows + (cfg.cols - minHoriz) / cfg.cols;
  score += cornerBonus * currentSettings.bestFitCornerWeight;

  // 2. Edge adjacency: check if any cell of this item touches an occupied cell
  let adjBonus = 0;
  for (let r = 0; r < item.shape.length; r++) {
    for (let c = 0; c < item.shape[r].length; c++) {
      const t = item.shape[r][c];
      if (t !== 2 && t !== 3) continue;
      const gr = row + r;
      const gc = col + c;
      // Check 4 neighbors
      const neighbors = [[gr - 1, gc], [gr + 1, gc], [gr, gc - 1], [gr, gc + 1]];
      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < cfg.rows && nc >= 0 && nc < cfg.cols && occupancy[nr][nc] !== null) {
          adjBonus++;
        }
      }
    }
  }
  score += (adjBonus / Math.max(1, profile.solidCells)) * currentSettings.bestFitEdgeWeight;

  // 3. Anchor exposure: for items with type-3 anchor points, positions where
  //    anchor points face open space (not wall) get bonus
  if (profile.anchorPoints > 0) {
    let exposedAnchors = 0;
    for (let r = 0; r < item.shape.length; r++) {
      for (let c = 0; c < item.shape[r].length; c++) {
        if (item.shape[r][c] !== 3) continue;
        const gr = row + r;
        const gc = col + c;
        // Check if anchor point has at least one open neighbor (not wall, not occupied)
        const neighbors = [[gr - 1, gc], [gr + 1, gc], [gr, gc - 1], [gr, gc + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr >= 0 && nr < cfg.rows && nc >= 0 && nc < cfg.cols && occupancy[nr][nc] === null) {
            exposedAnchors++;
            break;
          }
        }
      }
    }
    score += (exposedAnchors / Math.max(1, profile.anchorPoints)) * currentSettings.bestFitAnchorExposureWeight;
  }

  // 4. Hollow accessibility: for items with type-5, positions where hollow
  //    cells face open space get bonus
  if (profile.hasHollow) {
    let accessibleHollow = 0;
    for (let r = 0; r < item.shape.length; r++) {
      for (let c = 0; c < item.shape[r].length; c++) {
        if (item.shape[r][c] !== 5) continue;
        const gr = row + r;
        const gc = col + c;
        const neighbors = [[gr - 1, gc], [gr + 1, gc], [gr, gc - 1], [gr, gc + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr >= 0 && nr < cfg.rows && nc >= 0 && nc < cfg.cols && occupancy[nr][nc] === null) {
            accessibleHollow++;
            break;
          }
        }
      }
    }
    score += (accessibleHollow / Math.max(1, profile.hollowCells)) * currentSettings.bestFitHollowAccessWeight;
  }

  // 5. Vertical compactness: positions closer to the top (lower row) get bonus
  //    for items without anchors. Anchored items prefer being high.
  if (!profile.hasAnchors) {
    score += ((cfg.rows - row) / cfg.rows) * currentSettings.bestFitVerticalWeight;
  }

  // 6. Fragmentation penalty: scanning for isolated single-cell gaps created
  //    near this placement would be expensive; approximate by checking if we
  //    leave a 1-cell gap at the boundary
  //    (Simplified: check corners of bounding box for isolation)
  let fragCount = 0;
  const checkCells = [
    [row - 1, col - 1], [row - 1, col + width],
    [row + height, col - 1], [row + height, col + width],
  ];
  for (const [fr, fc] of checkCells) {
    if (fr >= 0 && fr < cfg.rows && fc >= 0 && fc < cfg.cols && occupancy[fr][fc] === null) {
      // Check 4 neighbors of the potentially isolated cell
      const isolated = [[fr - 1, fc], [fr + 1, fc], [fr, fc - 1], [fr, fc + 1]]
        .every(([nr, nc]) =>
          nr < 0 || nr >= cfg.rows || nc < 0 || nc >= cfg.cols || occupancy[nr][nc] !== null
        );
      if (isolated) fragCount++;
    }
  }
  score += fragCount * currentSettings.bestFitFragmentationPenalty;

  return score;
}

export function findBestSpot(
  item: FurnitureItem,
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  profile: ShapeProfile,
): { row: number; col: number } | null {
  const h = item.shape.length;
  const w = Math.max(...item.shape.map(r => r.length));
  let bestPos: { row: number; col: number } | null = null;
  let bestScore = -Infinity;

  for (let ri = -h; ri <= cfg.rows; ri++) {
    for (let ci = -w; ci <= cfg.cols; ci++) {
      if (!canPlace(item, ri, ci, occupancy, anchorPoints, cfg)) continue;
      const qs = bestFitQualityScore(item, ri, ci, occupancy, anchorPoints, cfg, profile);
      if (qs > bestScore) {
        bestScore = qs;
        bestPos = { row: ri, col: ci };
      }
    }
  }

  return bestPos;
}

// ─── Sparse findBestSpot for fillLoop (only scans occupied-area neighbors) ─

function findBestSpotSparse(
  item: FurnitureItem,
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  profile: ShapeProfile,
): { row: number; col: number } | null {
  const h = item.shape.length;
  const w = Math.max(...item.shape.map(r => r.length));
  let bestPos: { row: number; col: number } | null = null;
  let bestScore = -Infinity;

  // Collect occupied cell coordinates to scan nearby
  const occupiedCells: [number, number][] = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (occupancy[r][c] !== null) occupiedCells.push([r, c]);
    }
  }

  // Scan a radius around each occupied cell
  const RADIUS = 3;
  const considered = new Set<string>();
  for (const [or, oc] of occupiedCells) {
    for (let dr = -RADIUS - h; dr <= RADIUS; dr++) {
      for (let dc = -RADIUS - w; dc <= RADIUS; dc++) {
        const ri = or + dr;
        const ci = oc + dc;
        const key = `${ri},${ci}`;
        if (considered.has(key)) continue;
        considered.add(key);
        if (!canPlace(item, ri, ci, occupancy, anchorPoints, cfg)) continue;
        const qs = bestFitQualityScore(item, ri, ci, occupancy, anchorPoints, cfg, profile);
        if (qs > bestScore) {
          bestScore = qs;
          bestPos = { row: ri, col: ci };
        }
      }
    }
  }

  // Fallback: full scan if sparse found nothing
  if (!bestPos) {
    return findBestSpot(item, occupancy, anchorPoints, cfg, profile);
  }

  return bestPos;
}

// ─── Sort ─────────────────────────────────────────────────────────────────

function sortCandidatesV2(candidates: Candidate[], rng?: Rng): void {
  if (candidates.length === 0) return;

  // Pre-scan for normalization
  let minEna = Infinity, maxEna = -Infinity;
  let minIrr = Infinity, maxIrr = -Infinity;
  let minScore = Infinity, maxScore = -Infinity;
  let minEff = Infinity, maxEff = -Infinity;

  for (const c of candidates) {
    const prof = c.profile;
    if (prof.enablementScore < minEna) minEna = prof.enablementScore;
    if (prof.enablementScore > maxEna) maxEna = prof.enablementScore;
    if (prof.irregularity < minIrr) minIrr = prof.irregularity;
    if (prof.irregularity > maxIrr) maxIrr = prof.irregularity;
    if (c.score < minScore) minScore = c.score;
    if (c.score > maxScore) maxScore = c.score;
    const efficiency = c.score / Math.max(1, c.item.spacesOccupied);
    if (efficiency < minEff) minEff = efficiency;
    if (efficiency > maxEff) maxEff = efficiency;
  }

  const rangeEna = maxEna - minEna || 1;
  const rangeIrr = maxIrr - minIrr || 1;
  const rangeScore = maxScore - minScore || 1;
  const rangeEff = maxEff - minEff || 1;

  const jitter = new Map<string, number>();
  if (rng) {
    for (const c of candidates) jitter.set(c.item.id, 1 + (rng() - 0.5) * 0.5);
  }

  // Pre-compute temperature noise per item type (reused across copies).
  const tempNoise = new Map<string, number>();
  if (rng && currentSettings.temperature > 0) {
    for (const c of candidates) {
      if (!tempNoise.has(c.item.id)) {
        tempNoise.set(c.item.id, (rng() - 0.5) * currentSettings.temperature);
      }
    }
  }

  candidates.sort((a, b) => {
    // Mandatory items always first
    if (a.mandatory !== b.mandatory) return Number(b.mandatory) - Number(a.mandatory);

    const pA = a.profile;
    const pB = b.profile;

    const enaNormA = (pA.enablementScore - minEna) / rangeEna;
    const enaNormB = (pB.enablementScore - minEna) / rangeEna;
    const irrNormA = (pA.irregularity - minIrr) / rangeIrr;
    const irrNormB = (pB.irregularity - minIrr) / rangeIrr;
    const scoreNormA = (a.score - minScore) / rangeScore;
    const scoreNormB = (b.score - minScore) / rangeScore;
    const effA = (a.score / Math.max(1, a.item.spacesOccupied) - minEff) / rangeEff * (jitter.get(a.item.id) ?? 1);
    const effB = (b.score / Math.max(1, b.item.spacesOccupied) - minEff) / rangeEff * (jitter.get(b.item.id) ?? 1);

    const keyA = (pA.isLego ? currentSettings.sortLegoBonus : 0)
      + currentSettings.sortEnablementWeight * enaNormA
      + currentSettings.sortIrregularityWeight * irrNormA
      + currentSettings.sortScoreWeight * scoreNormA
      + currentSettings.sortEfficiencyWeight * effA
      + (tempNoise.get(a.item.id) ?? 0);

    const keyB = (pB.isLego ? currentSettings.sortLegoBonus : 0)
      + currentSettings.sortEnablementWeight * enaNormB
      + currentSettings.sortIrregularityWeight * irrNormB
      + currentSettings.sortScoreWeight * scoreNormB
      + currentSettings.sortEfficiencyWeight * effB
      + (tempNoise.get(b.item.id) ?? 0);

    return keyB - keyA || a.item.name.localeCompare(b.item.name);
  });
}

// ─── Phase 2b: Hollow Fill ────────────────────────────────────────────────

/**
 * Phase 2b: Fill hollow cells (type-5) inside placed enablers with small items.
 * Only uses items that are NOT needed for stat floor satisfaction.
 */
function fillHollowCells(
  candidates: Candidate[],
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  makeInstanceId: () => string,
  totals: Record<StatKey, number>,
  minStats?: Partial<Record<StatKey, number>>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _baseTotals?: Partial<Record<StatKey, number>>,
): PlacedFurniture[] {
  const placed: PlacedFurniture[] = [];

  // Find which hollow regions exist in the current occupancy
  // We need to look at what items are placed - but we don't have the main placed list here.
  // Instead, scan occupancy for items with hollow cells by checking if an item has non-null
  // surrounding cells that indicate a hollow region.
  // Approach: scan grid for unoccupied cells that are surrounded by non-null cells (from same item).
  // This is approximate — we detect "cavities" in occupancy.

  const hollowRegions: { cells: { row: number; col: number }[] }[] = [];
  const visited = new Set<string>();

  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (occupancy[r][c] !== null) continue;
      const key = `${r},${c}`;
      if (visited.has(key)) continue;

      // A hollow cell must have at least 3 occupied neighbors (it's inside a placed item)
      const occupiedNeighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        .filter(([nr, nc]) => nr >= 0 && nr < cfg.rows && nc >= 0 && nc < cfg.cols && occupancy[nr][nc] !== null)
        .length;

      if (occupiedNeighbors >= 3) {
        // This cell is likely a hollow interior — collect it
        visited.add(key);
        const cells = [{ row: r, col: c }];

        // Also check adjacent unoccupied cells with the same "enclosed" property
        const queue = [[r, c]];
        while (queue.length > 0) {
          const [qr, qc] = queue.shift()!;
          for (const [nr, nc] of [[qr - 1, qc], [qr + 1, qc], [qr, qc - 1], [qr, qc + 1]]) {
            if (nr < 0 || nr >= cfg.rows || nc < 0 || nc >= cfg.cols) continue;
            if (occupancy[nr][nc] !== null) continue;
            const nk = `${nr},${nc}`;
            if (visited.has(nk)) continue;
            visited.add(nk);
            cells.push({ row: nr, col: nc });
            queue.push([nr, nc]);
          }
        }

        if (cells.length > 0) {
          hollowRegions.push({ cells });
        }
      }
    }
  }

  if (hollowRegions.length === 0) return placed;

  // Build set of item IDs that are needed for stat floors
  const floorNeededIds = new Set<string>();
  if (minStats) {
    for (const c of candidates) {
      if (c.remaining <= 0) continue;
      for (const [stat] of Object.entries(minStats) as [StatKey, number][]) {
        if (c.item[stat] > 0) floorNeededIds.add(c.item.id);
      }
    }
  }

  // Filter candidates to only those that can fit in hollow regions and aren't floor-critical
  const hollowFillers = candidates
    .filter(c => c.remaining > 0 && !floorNeededIds.has(c.item.id) && c.item.spacesOccupied > 0)
    .sort((a, b) => a.item.spacesOccupied - b.item.spacesOccupied); // smallest first

  if (hollowFillers.length === 0) return placed;

  // For each hollow region, try to fill with smallest fitting item
  for (const region of hollowRegions) {
    // Compute bounding box of region
    const minR = Math.min(...region.cells.map(c => c.row));
    const maxR = Math.max(...region.cells.map(c => c.row));
    const minC = Math.min(...region.cells.map(c => c.col));
    const maxC = Math.max(...region.cells.map(c => c.col));
    const regionH = maxR - minR + 1;
    const regionW = maxC - minC + 1;

    // Try filling each cell individually first (1×1 items for single cells)
    for (const cell of region.cells) {
      if (occupancy[cell.row][cell.col] !== null) continue; // already filled

      for (const cand of hollowFillers) {
        if (cand.remaining <= 0) continue;
        const { height, width } = { height: cand.item.shape.length, width: Math.max(...cand.item.shape.map(r => r.length)) };
        if (height > regionH || width > regionW) continue;

        // Check if item fits in this specific cell
        if (canPlace(cand.item, cell.row, cell.col, occupancy, anchorPoints, cfg)) {
          const piece: PlacedFurniture = {
            instanceId: makeInstanceId(),
            item: cand.item,
            row: cell.row,
            col: cell.col,
          };
          placed.push(piece);
          // Apply placement
          for (let r = 0; r < cand.item.shape.length; r++) {
            for (let c = 0; c < cand.item.shape[r].length; c++) {
              const t = cand.item.shape[r][c];
              if (t === 2 || t === 3) occupancy[cell.row + r][cell.col + c] = piece.instanceId;
              if (t === 3) anchorPoints.add(`${cell.row + r},${cell.col + c}`);
            }
          }
          cand.remaining -= 1;
          for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
          break;
        }
      }
    }
  }

  return placed;
}

// ─── Candidate Building ───────────────────────────────────────────────────

function buildCandidates(opts: V2Options): Candidate[] {
  const { weights, allFurniture, ownership, usedInOtherRooms, mustInclude, minStats, excludeItemIds } = opts;
  const mandatoryIds = new Set(mustInclude ?? []);
  const exclusions = new Set(excludeItemIds ?? []);
  const floorStats = Object.keys(minStats ?? {}) as StatKey[];
  const bannedStats = Object.entries(weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
  const candidates: Candidate[] = [];
  for (const item of allFurniture) {
    const mandatory = mandatoryIds.has(item.id);
    if (exclusions.has(item.id) && !mandatory) continue;
    if (bannedStats.some((st) => item[st] > 0) && !mandatory) continue;
    const remaining = (ownership[item.id] ?? 0) - (usedInOtherRooms[item.id] ?? 0);
    if (remaining <= 0) continue;
    const score = statScore(item, weights);
    const helpsFloor = floorStats.some((st) => item[st] > 0);
    if (score < 0 && !mandatory && !helpsFloor) continue;
    if (score === 0 && !mandatory && !helpsFloor && opts.noFillers) continue;
    const profile = computeShapeProfile(item);
    candidates.push({ item, score, profile, remaining, mandatory });
  }
  return candidates;
}

// ─── fillGreedyV2 ─────────────────────────────────────────────────────────

function applyPlacement(piece: PlacedFurniture, occupancy: (string | null)[][], anchorPoints: Set<string>): boolean {
  let addedAnchor = false;
  for (let r = 0; r < piece.item.shape.length; r++) {
    for (let c = 0; c < piece.item.shape[r].length; c++) {
      const t = piece.item.shape[r][c];
      if (t === 2 || t === 3) occupancy[piece.row + r][piece.col + c] = piece.instanceId;
      if (t === 3) {
        anchorPoints.add(`${piece.row + r},${piece.col + c}`);
        addedAnchor = true;
      }
    }
  }
  return addedAnchor;
}

function fillGreedyV2(
  candidates: Candidate[],
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  makeInstanceId: () => string,
  minStats?: Partial<Record<StatKey, number>>,
  baseTotals?: Partial<Record<StatKey, number>>,
  opts?: V2Options,
  extraPresent?: Record<string, number>,
): PlacedFurniture[] {
  const placed: PlacedFurniture[] = [];
  const totals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };

  const tryPlace = (cand: Candidate, useSparse = false): boolean => {
    const spot = useSparse
      ? findBestSpotSparse(cand.item, occupancy, anchorPoints, cfg, cand.profile)
      : findBestSpot(cand.item, occupancy, anchorPoints, cfg, cand.profile);
    if (!spot) return false;
    const piece: PlacedFurniture = {
      instanceId: makeInstanceId(),
      item: cand.item,
      row: spot.row,
      col: spot.col,
    };
    placed.push(piece);
    applyPlacement(piece, occupancy, anchorPoints);
    cand.remaining -= 1;
    for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
    return true;
  };

  // Phase 1: Mandatory items first (all copies)
  for (const cand of candidates) {
    if (!cand.mandatory) continue;
    while (cand.remaining > 0) {
      if (!tryPlace(cand)) break;
    }
  }

  // Phase 0: Enablers (items with enablement value) — use full search
  const enablers = candidates.filter(c => c.remaining > 0 && (c.profile.isLego || c.profile.enablementScore > 0));
  sortCandidatesV2(enablers);
  for (const cand of enablers) {
    while (cand.remaining > 0) {
      if (!tryPlace(cand, false)) break;
    }
  }

  // Phase 2: Stat floor satisfaction
  const wouldBreakFloor = (cand: Candidate): boolean => {
    if (!minStats) return false;
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      if (cand.item[stat] < 0 && totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] < min) return true;
    }
    return false;
  };

  if (minStats) {
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      for (;;) {
        if (totals[stat] + (baseTotals?.[stat] ?? 0) >= min) break;
        const pool = candidates
          .filter(c => c.remaining > 0 && c.item[stat] > 0)
          .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
        let placedOne = false;
        for (const cand of pool) {
          if (tryPlace(cand, false)) { placedOne = true; break; }
        }
        if (!placedOne) break;
      }
    }
  }

  // Phase 2b: Fill hollow cells inside placed enablers (only items NOT needed for floors)
  const hollowFillItems = fillHollowCells(candidates, occupancy, anchorPoints, cfg, makeInstanceId, totals, minStats, baseTotals);
  for (const p of hollowFillItems) placed.push(p);

  // Phase 3: Greedy score fill (with sparse scan for speed)
  const failed = new Set<string>();

  const addHeadroomFor = (cand: Candidate): boolean => {
    if (!minStats) return false;
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      if (cand.item[stat] >= 0) continue;
      if (totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] >= min) continue;
      const pool = candidates
        .filter(c => c.remaining > 0 && c.item[stat] > 0)
        .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
      for (const h of pool) {
        if (tryPlace(h, true)) return true;
      }
    }
    return false;
  };

  const fillLoop = (pool: Candidate[], useSparse = true) => {
    failed.clear();
    for (;;) {
      let progress = false;
      for (const cand of pool) {
        if (cand.remaining <= 0 || failed.has(cand.item.id)) continue;
        if (wouldBreakFloor(cand)) {
          if (addHeadroomFor(cand)) { progress = true; break; }
          continue;
        }
        if (!tryPlace(cand, useSparse)) {
          failed.add(cand.item.id);
          continue;
        }
        progress = true;
        break;
      }
      if (!progress) break;
    }
  };

  fillLoop(candidates.filter(c => c.score > 0), true);

  // Phase 4: Neutral fillers (score=0 items, largest first)
  const fillers = candidates
    .filter(c => c.remaining > 0 && c.score >= 0)
    .sort((a, b) => b.item.spacesOccupied - a.item.spacesOccupied || b.score - a.score || a.item.name.localeCompare(b.item.name));
  fillLoop(fillers, true);

  // Phase 5: Squeeze pass (smallest first)
  const squeezers = candidates
    .filter(c => c.remaining > 0 && c.score >= 0)
    .sort((a, b) => a.item.spacesOccupied - b.item.spacesOccupied || b.score - a.score);
  fillLoop(squeezers, true);

  // Phase 6: Last chance — all remaining items
  if (opts && !opts.noFillers) {
    const placedHere = new Map<string, number>();
    for (const p of placed) placedHere.set(p.item.id, (placedHere.get(p.item.id) ?? 0) + 1);
    const exclusions = new Set(opts.excludeItemIds ?? []);
    const mandatoryIds = new Set(opts.mustInclude ?? []);
    const lastPool: Candidate[] = [];
    for (const item of opts.allFurniture) {
      if (exclusions.has(item.id) && !mandatoryIds.has(item.id)) continue;
      const remaining = (opts.ownership[item.id] ?? 0) - (opts.usedInOtherRooms[item.id] ?? 0) - (placedHere.get(item.id) ?? 0) - (extraPresent?.[item.id] ?? 0);
      if (remaining <= 0) continue;
      const bannedStats = Object.entries(opts.weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
      if (bannedStats.some((st) => item[st] > 0) && !mandatoryIds.has(item.id)) continue;
      lastPool.push({
        item,
        score: statScore(item, opts.weights),
        profile: computeShapeProfile(item),
        remaining,
        mandatory: false,
      });
    }
    lastPool.sort((a, b) => b.item.spacesOccupied - a.item.spacesOccupied || b.score - a.score || a.item.name.localeCompare(b.item.name));
    fillLoop(lastPool, true);

    // Phase 7: Dumb single pass
    const dumpPool: Candidate[] = [];
    for (const item of opts.allFurniture) {
      if (exclusions.has(item.id) && !mandatoryIds.has(item.id)) continue;
      const remaining = (opts.ownership[item.id] ?? 0) - (opts.usedInOtherRooms[item.id] ?? 0) - (placedHere.get(item.id) ?? 0) - (extraPresent?.[item.id] ?? 0);
      if (remaining <= 0) continue;
      const bannedStats = Object.entries(opts.weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
      if (bannedStats.some((st) => item[st] > 0) && !mandatoryIds.has(item.id)) continue;
      dumpPool.push({
        item,
        score: statScore(item, opts.weights),
        profile: computeShapeProfile(item),
        remaining,
        mandatory: false,
      });
    }
    for (const cand of dumpPool) {
      if (cand.remaining <= 0) continue;
      const spot = findBestSpotSparse(cand.item, occupancy, anchorPoints, cfg, cand.profile);
      if (!spot) continue;
      const piece: PlacedFurniture = {
        instanceId: makeInstanceId(),
        item: cand.item,
        row: spot.row,
        col: spot.col,
      };
      placed.push(piece);
      applyPlacement(piece, occupancy, anchorPoints);
      cand.remaining -= 1;
      for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
    }
  }

  return placed;
}

// ─── Async Greedy Fill V2 (with yielding for browser responsiveness) ──────

const yieldToBrowser = () => new Promise<void>(r => setTimeout(r, 0));

async function asyncFillLoop(
  candidates: Candidate[],
  placed: PlacedFurniture[],
  totals: Record<StatKey, number>,
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  makeInstanceId: () => string,
  failed: Set<string>,
  minStats: Partial<Record<StatKey, number>> | undefined,
  baseTotals: Partial<Record<StatKey, number>> | undefined,
  useSparse = true,
  yieldEvery = 5,
): Promise<void> {
  let sinceYield = 0;
  for (;;) {
    let progress = false;
    for (const cand of candidates) {
      if (cand.remaining <= 0 || failed.has(cand.item.id)) continue;

      if (minStats) {
        let wouldBreak = false;
        for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
          if (cand.item[stat] < 0 && totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] < min) {
            wouldBreak = true;
            break;
          }
        }
        if (wouldBreak) {
          let headroomPlaced = false;
          for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
            if (cand.item[stat] >= 0) continue;
            if (totals[stat] + (baseTotals?.[stat] ?? 0) + cand.item[stat] >= min) continue;
            const pool = candidates
              .filter(c => c.remaining > 0 && c.item[stat] > 0)
              .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
            for (const h of pool) {
              const spot = findBestSpotSparse(h.item, occupancy, anchorPoints, cfg, h.profile);
              if (spot) {
                const piece: PlacedFurniture = { instanceId: makeInstanceId(), item: h.item, row: spot.row, col: spot.col };
                placed.push(piece);
                applyPlacement(piece, occupancy, anchorPoints);
                h.remaining -= 1;
                for (const st of Object.keys(totals) as StatKey[]) totals[st] += h.item[st];
                headroomPlaced = true;
                break;
              }
            }
            if (headroomPlaced) break;
          }
          if (headroomPlaced) { progress = true; break; }
          continue;
        }
      }

      const spot = useSparse
        ? findBestSpotSparse(cand.item, occupancy, anchorPoints, cfg, cand.profile)
        : findBestSpot(cand.item, occupancy, anchorPoints, cfg, cand.profile);

      if (!spot) {
        failed.add(cand.item.id);
        continue;
      }

      const piece: PlacedFurniture = { instanceId: makeInstanceId(), item: cand.item, row: spot.row, col: spot.col };
      placed.push(piece);
      applyPlacement(piece, occupancy, anchorPoints);
      cand.remaining -= 1;
      for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];

      sinceYield++;
      if (yieldEvery > 0 && sinceYield >= yieldEvery) {
        await yieldToBrowser();
        sinceYield = 0;
      }

      progress = true;
      break;
    }
    if (!progress) break;
  }
}

/**
 * Async variant of fillGreedyV2 that yields to the event loop every few
 * placements so the browser stays responsive and doesn't show a "page
 * unresponsive" warning.
 */
async function asyncFillGreedyV2(
  candidates: Candidate[],
  occupancy: (string | null)[][],
  anchorPoints: Set<string>,
  cfg: RoomConfig,
  makeInstanceId: () => string,
  minStats: Partial<Record<StatKey, number>> | undefined,
  baseTotals: Partial<Record<StatKey, number>> | undefined,
  opts: V2Options | undefined,
  extraPresent: Record<string, number> | undefined,
): Promise<PlacedFurniture[]> {
  const placed: PlacedFurniture[] = [];
  const totals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };

  const tryPlace = (cand: Candidate, useSparse = false): boolean => {
    const spot = useSparse
      ? findBestSpotSparse(cand.item, occupancy, anchorPoints, cfg, cand.profile)
      : findBestSpot(cand.item, occupancy, anchorPoints, cfg, cand.profile);
    if (!spot) return false;
    const piece: PlacedFurniture = { instanceId: makeInstanceId(), item: cand.item, row: spot.row, col: spot.col };
    placed.push(piece);
    applyPlacement(piece, occupancy, anchorPoints);
    cand.remaining -= 1;
    for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
    return true;
  };

  // Phase 1: Mandatory items
  for (const cand of candidates) {
    if (!cand.mandatory) continue;
    while (cand.remaining > 0) { if (!tryPlace(cand)) break; }
  }
  await yieldToBrowser();

  // Phase 0: Enablers
  const enablers = candidates.filter(c => c.remaining > 0 && (c.profile.isLego || c.profile.enablementScore > 0));
  sortCandidatesV2(enablers);
  for (const cand of enablers) {
    while (cand.remaining > 0) { if (!tryPlace(cand, false)) break; }
  }
  await yieldToBrowser();

  // Phase 2: Stat floor
  if (minStats) {
    for (const [stat, min] of Object.entries(minStats) as [StatKey, number][]) {
      for (;;) {
        if (totals[stat] + (baseTotals?.[stat] ?? 0) >= min) break;
        const pool = candidates
          .filter(c => c.remaining > 0 && c.item[stat] > 0)
          .sort((a, b) => b.item[stat] / b.item.spacesOccupied - a.item[stat] / a.item.spacesOccupied);
        let placedOne = false;
        for (const cand of pool) {
          if (tryPlace(cand, false)) { placedOne = true; break; }
        }
        if (!placedOne) break;
      }
    }
  }
  await yieldToBrowser();

  // Phase 2b: Hollow fill
  const hollowFillItems = fillHollowCells(candidates, occupancy, anchorPoints, cfg, makeInstanceId, totals, minStats, baseTotals);
  for (const p of hollowFillItems) placed.push(p);
  await yieldToBrowser();

  // Phase 3: Score fill (async with yielding)
  const failed = new Set<string>();
  const scorePool = candidates.filter(c => c.score > 0);
  await asyncFillLoop(scorePool, placed, totals, occupancy, anchorPoints, cfg, makeInstanceId, failed, minStats, baseTotals, true, 5);
  await yieldToBrowser();

  // Phase 4: Neutral fillers
  const fillers = candidates
    .filter(c => c.remaining > 0 && c.score >= 0)
    .sort((a, b) => b.item.spacesOccupied - a.item.spacesOccupied || b.score - a.score || a.item.name.localeCompare(b.item.name));
  failed.clear();
  const syncFillLoop = (pool: Candidate[], us: boolean) => {
    for (;;) {
      let p = false;
      for (const c of pool) {
        if (c.remaining <= 0 || failed.has(c.item.id)) continue;
        if (!tryPlace(c, us)) { failed.add(c.item.id); continue; }
        p = true; break;
      }
      if (!p) break;
    }
  };
  syncFillLoop(fillers, true);

  // Phase 5: Squeeze
  const squeezers = candidates
    .filter(c => c.remaining > 0 && c.score >= 0)
    .sort((a, b) => a.item.spacesOccupied - b.item.spacesOccupied || b.score - a.score);
  failed.clear();
  syncFillLoop(squeezers, true);

  // Phase 6: Last chance
  if (opts && !opts.noFillers) {
    const placedHere = new Map<string, number>();
    for (const p of placed) placedHere.set(p.item.id, (placedHere.get(p.item.id) ?? 0) + 1);
    const exclusions = new Set(opts.excludeItemIds ?? []);
    const mandatoryIds = new Set(opts.mustInclude ?? []);
    const lastPool: Candidate[] = [];
    for (const item of opts.allFurniture) {
      if (exclusions.has(item.id) && !mandatoryIds.has(item.id)) continue;
      const remaining = (opts.ownership[item.id] ?? 0) - (opts.usedInOtherRooms[item.id] ?? 0) - (placedHere.get(item.id) ?? 0) - (extraPresent?.[item.id] ?? 0);
      if (remaining <= 0) continue;
      const bannedStats = Object.entries(opts.weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
      if (bannedStats.some((st) => item[st] > 0) && !mandatoryIds.has(item.id)) continue;
      lastPool.push({ item, score: statScore(item, opts.weights), profile: computeShapeProfile(item), remaining, mandatory: false });
    }
    lastPool.sort((a, b) => b.item.spacesOccupied - a.item.spacesOccupied || b.score - a.score || a.item.name.localeCompare(b.item.name));
    failed.clear();
    syncFillLoop(lastPool, true);

    // Phase 7: Dumb single pass
    const dumpPool: Candidate[] = [];
    for (const item of opts.allFurniture) {
      if (exclusions.has(item.id) && !mandatoryIds.has(item.id)) continue;
      const remaining = (opts.ownership[item.id] ?? 0) - (opts.usedInOtherRooms[item.id] ?? 0) - (placedHere.get(item.id) ?? 0) - (extraPresent?.[item.id] ?? 0);
      if (remaining <= 0) continue;
      const bannedStats = Object.entries(opts.weights).filter(([, w]) => w === -2).map(([stat]) => stat as StatKey);
      if (bannedStats.some((st) => item[st] > 0) && !mandatoryIds.has(item.id)) continue;
      dumpPool.push({ item, score: statScore(item, opts.weights), profile: computeShapeProfile(item), remaining, mandatory: false });
    }
    for (const cand of dumpPool) {
      if (cand.remaining <= 0) continue;
      const spot = findBestSpotSparse(cand.item, occupancy, anchorPoints, cfg, cand.profile);
      if (!spot) continue;
      const piece: PlacedFurniture = { instanceId: makeInstanceId(), item: cand.item, row: spot.row, col: spot.col };
      placed.push(piece);
      applyPlacement(piece, occupancy, anchorPoints);
      cand.remaining -= 1;
      for (const st of Object.keys(totals) as StatKey[]) totals[st] += cand.item[st];
    }
  }

  return placed;
}

// ─── Run Greedy V2 ────────────────────────────────────────────────────────

function runGreedyV2(opts: V2Options, cfg: RoomConfig, rng?: Rng): PlacedFurniture[] {
  const candidates = buildCandidates(opts);
  sortCandidatesV2(candidates, rng);
  const occupancy = buildOccupancy([], cfg);
  const anchorPoints = buildAnchorPointSet([], cfg);
  return fillGreedyV2(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, opts.minStats, undefined, opts);
}

async function asyncRunGreedyV2(opts: V2Options, cfg: RoomConfig): Promise<PlacedFurniture[]> {
  const candidates = buildCandidates(opts);
  sortCandidatesV2(candidates);
  const occupancy = buildOccupancy([], cfg);
  const anchorPoints = buildAnchorPointSet([], cfg);
  return asyncFillGreedyV2(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, opts.minStats, undefined, opts, undefined);
}

// ─── Targeted Ruin-and-Recreate ───────────────────────────────────────────

/**
 * Remove items from low-density (sparse) areas first, then greedily refill.
 */
function targetedRuinAndRecreate(
  layout: PlacedFurniture[],
  opts: V2Options,
  cfg: RoomConfig,
  rng: Rng,
): PlacedFurniture[] {
  if (layout.length === 0) return runGreedyV2(opts, cfg, rng);

  // Compute local density for each placed item
  const itemDensity: { piece: PlacedFurniture; density: number }[] = [];
  for (const p of layout) {
    const { height, width } = getBoundingBox(p.item.shape);
    const bboxArea = Math.max(1, height * width);
    // Count occupied cells in the item's bounding box on the grid
    let occupiedInBBox = 0;
    for (let r = p.row; r < p.row + height && r < cfg.rows; r++) {
      for (let c = p.col; c < p.col + width && c < cfg.cols; c++) {
        // Use a 1-cell padding for the neighborhood
        for (let nr = Math.max(0, r - 1); nr <= Math.min(cfg.rows - 1, r + 1); nr++) {
          for (let nc = Math.max(0, c - 1); nc <= Math.min(cfg.cols - 1, c + 1); nc++) {
            // Check if any placed item occupies this cell
            for (const op of layout) {
              if (op === p) continue;
              for (let or = 0; or < op.item.shape.length; or++) {
                for (let oc = 0; oc < op.item.shape[or].length; oc++) {
                  const t = op.item.shape[or][oc];
                  if ((t === 2 || t === 3) && op.row + or === nr && op.col + oc === nc) {
                    occupiedInBBox++;
                  }
                }
              }
            }
          }
        }
      }
    }
    const density = occupiedInBBox / (bboxArea * 9); // 3×3 neighborhood per cell
    itemDensity.push({ piece: p, density });
  }

  // Sort by density ascending (sparsest first)
  itemDensity.sort((a, b) => a.density - b.density);

  // Remove from sparsest areas
  const removeCount = Math.max(1, Math.floor(layout.length * currentSettings.ruinSparseRatio));
  const toRemove = new Set(itemDensity.slice(0, removeCount).map(ed => ed.piece.instanceId));

  // Cascade removal for anchored pieces
  let kept = layout.filter(p => !toRemove.has(p.instanceId));
  for (const id of toRemove) {
    const cascade = findAnchoredPieces(id, layout, cfg);
    kept = kept.filter(p => !cascade.has(p.instanceId));
  }

  if (kept.length === 0) return runGreedyV2(opts, cfg, rng);

  // Refill
  const candidates = buildCandidates(opts);
  const keptCounts: Record<string, number> = {};
  for (const p of kept) keptCounts[p.item.id] = (keptCounts[p.item.id] || 0) + 1;
  for (const c of candidates) c.remaining -= keptCounts[c.item.id] || 0;
  sortCandidatesV2(candidates, rng);

  const keptTotals: Partial<Record<StatKey, number>> = {};
  for (const p of kept) {
    for (const st of ['appeal', 'comfort', 'stimulation', 'health', 'mutation'] as StatKey[]) {
      keptTotals[st] = (keptTotals[st] ?? 0) + p.item[st];
    }
  }

  const occupancy = buildOccupancy(kept, cfg);
  const anchorPoints = buildAnchorPointSet(kept, cfg);
  const added = fillGreedyV2(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, opts.minStats, keptTotals, opts, keptCounts);
  return [...kept, ...added];
}

// ─── Maximize ─────────────────────────────────────────────────────────────

function totalScore(placed: PlacedFurniture[], weights: StatWeights): number {
  let sum = 0;
  for (const p of placed) sum += statScore(p.item, weights);
  return sum;
}

const cellsUsed = (layout: PlacedFurniture[]) =>
  layout.reduce((s, p) => s + p.item.spacesOccupied, 0);

function startMaximizeV2(opts: V2Options, cfg: RoomConfig): MaximizeState {
  const best = runGreedyV2(opts, cfg);
  const bestCoverage = cellsUsed(best);
  return {
    rng: mulberry32(opts.seed ?? Date.now()),
    best,
    bestScore: totalScore(best, opts.weights),
    bestCombined: totalScore(best, opts.weights) + bestCoverage * currentSettings.coverageBonus,
    round: 0,
  };
}

function maximizeRoundV2(state: MaximizeState, opts: V2Options, cfg: RoomConfig): void {
  const { rng } = state;

  const consider = (layout: PlacedFurniture[]) => {
    const score = totalScore(layout, opts.weights);
    const coverage = cellsUsed(layout);
    const combined = score + coverage * currentSettings.coverageBonus;
    if (combined > state.bestCombined) {
      state.best = layout;
      state.bestScore = score;
      state.bestCombined = combined;
    }
  };

  // Multi-start: fresh randomized greedy
  consider(runGreedyV2(opts, cfg, rng));

  // Local search: targeted ruin from sparse areas
  consider(targetedRuinAndRecreate(state.best, opts, cfg, rng));

  // Alternate random removal when layout is dense (sometimes shake things up)
  // 50% chance: remove 20% random items from dense areas to explore alternatives
  if (rng() < 0.5 && state.best.length > 5) {
    const copy = [...state.best];
    const removeCount = Math.max(1, Math.floor(copy.length * 0.20));
    for (let i = 0; i < removeCount && copy.length > 0; i++) {
      const idx = Math.floor(rng() * copy.length);
      const victim = copy[idx];
      const cascade = findAnchoredPieces(victim.instanceId, copy, cfg);
      const gone = new Set([victim.instanceId, ...cascade]);
      copy.splice(idx, 1); // Remove victim
      // Filter out cascaded
      for (let ci = copy.length - 1; ci >= 0; ci--) {
        if (gone.has(copy[ci].instanceId)) copy.splice(ci, 1);
      }
    }
    if (copy.length > 0) {
      const candidates = buildCandidates(opts);
      const keptCounts: Record<string, number> = {};
      for (const p of copy) keptCounts[p.item.id] = (keptCounts[p.item.id] || 0) + 1;
      for (const c of candidates) c.remaining -= keptCounts[c.item.id] || 0;
      sortCandidatesV2(candidates, rng);
      const keptTotals: Partial<Record<StatKey, number>> = {};
      for (const p of copy) {
        for (const st of ['appeal', 'comfort', 'stimulation', 'health', 'mutation'] as StatKey[]) {
          keptTotals[st] = (keptTotals[st] ?? 0) + p.item[st];
        }
      }
      const occupancy = buildOccupancy(copy, cfg);
      const anchorPoints = buildAnchorPointSet(copy, cfg);
      const added = fillGreedyV2(candidates, occupancy, anchorPoints, cfg, opts.makeInstanceId, opts.minStats, keptTotals, opts, keptCounts);
      consider([...copy, ...added]);
    }
  }

  state.round += 1;
}

function runMaximizeV2(opts: V2Options, cfg: RoomConfig): PlacedFurniture[] {
  const maxIterations = opts.iterations ?? currentSettings.defaultMaximizeIterations;
  const state = startMaximizeV2(opts, cfg);
  while (state.round < maxIterations) {
    maximizeRoundV2(state, opts, cfg);
  }
  return state.best;
}

// ─── Entry Points ─────────────────────────────────────────────────────────

export function autoPopulateRoomV2(opts: V2Options): PlacedFurniture[] {
  return withSettings(opts.v2Settings, () => {
    const cfg = getRoomConfig(opts.roomIndex);
    if (!opts.iterations) return runGreedyV2(opts, cfg);
    return runMaximizeV2(opts, cfg);
  });
}

/**
 * Async variant with yielding so the browser stays responsive.
 * For one-shot greedy: yields between phases and every 5 placements in score fill.
 * For maximize: yields between each iteration.
 */
export async function autoPopulateRoomV2Async(
  opts: V2Options,
  onProgress?: (p: FillProgress) => void,
): Promise<PlacedFurniture[]> {
  return withSettings(opts.v2Settings, async () => {
    const cfg = getRoomConfig(opts.roomIndex);

    // Greedy pass with yielding
    if (!opts.iterations) {
      const result = await asyncRunGreedyV2(opts, cfg);
      onProgress?.({ fraction: 1, bestScore: totalScore(result, opts.weights), pieces: result.length });
      return result;
    }

    // Maximize with yielding between iterations
    const state = startMaximizeV2(opts, cfg);
    while (state.round < opts.iterations) {
      maximizeRoundV2(state, opts, cfg);
      const progress = state.round / opts.iterations;
      onProgress?.({ fraction: progress, bestScore: state.bestScore, pieces: state.best.length });
      if (opts.signal?.aborted) break;
      await yieldToBrowser();
      if (opts.signal?.aborted) break;
    }
    onProgress?.({ fraction: 1, bestScore: state.bestScore, pieces: state.best.length });
    return state.best;
  });
}
