// Breeding mechanics + the "Perfect 7" method, ported from the formulas and
// staged plan in frankieg33/MewgenicsBreedingManager (Perfect 7 Planner).
//
// "Perfect 7" = a cat whose seven *base* stats are all at the maximum value of
// 7. You get there by breeding, not buying: each kitten inherits every stat
// from one of its two parents, so you stack parents that already hold 7s and
// push the line until every stat is locked.

import type { PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomLabel } from '../types/furniture';

// ── Cat base stats (the "7") ────────────────────────────────────────────────

export const CAT_STATS = ['STR', 'DEX', 'CON', 'INT', 'SPD', 'CHA', 'LCK'] as const;
export type CatStat = (typeof CAT_STATS)[number];
export const MAX_STAT = 7;

export const CAT_STAT_LABELS: Record<CatStat, string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  SPD: 'Speed',
  CHA: 'Charisma',
  LCK: 'Luck',
};

// ── Game math (mirrors save_parser / breeding.py) ───────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Chance a kitten inherits the HIGHER parent's value for a given stat.
 * Rises with the breeding room's Stimulation: 0.5 at stim 0, 0.6 at 50,
 * ~0.667 at 100. Source: `_stimulation_inheritance_weight`.
 */
export function betterStatChance(stimulation: number): number {
  const s = stimulation;
  return (1 + 0.01 * s) / (2 + 0.01 * s);
}

/**
 * Breeding-success multiplier from a room's Comfort, relative to comfort 0.
 * Overall success = compat² · (1 + 0.1·comfort). Returns null when comfort is
 * below -10 (the game auto-fails the attempt). Source: `breeding_success_chance`.
 */
export function comfortMultiplier(comfort: number): number | null {
  if (comfort < -10) return null;
  return 1 + 0.1 * comfort;
}

/** Ability/passive inheritance odds, also driven by Stimulation. */
export function abilityInheritanceChances(stimulation: number) {
  const s = stimulation;
  return {
    firstActive: clamp01(0.2 + 0.025 * s),
    secondActive: clamp01(0.02 + 0.005 * s),
    passive: clamp01(0.05 + 0.01 * s),
  };
}

// ── Pair coverage projection ────────────────────────────────────────────────

export type StatState = 'locked' | 'reachable' | 'missing';

export interface PairCoverage {
  /** Per-stat state given the two parents' values. */
  states: Record<CatStat, StatState>;
  /** Stats guaranteed 7 (both parents ≥ 7). */
  locked: CatStat[];
  /** Stats that can roll 7 (exactly one parent ≥ 7). */
  reachable: CatStat[];
  /** Stats no parent can pass at 7 — needs an outcross. */
  missing: CatStat[];
  /** Expected number of 7s in a kitten, given room stimulation (the "7s" metric). */
  coverage: number;
}

/**
 * Project a breeding pair's 7-coverage. `coverage` counts locked stats as 1.0
 * and reachable stats by the better-stat chance — the same `seven_plus_total`
 * the Perfect 7 Planner shows as "X/7". Source: `pair_projection`.
 */
export function pairCoverage(
  parentA: Record<CatStat, number>,
  parentB: Record<CatStat, number>,
  stimulation: number,
): PairCoverage {
  const better = betterStatChance(stimulation);
  const states = {} as Record<CatStat, StatState>;
  const locked: CatStat[] = [];
  const reachable: CatStat[] = [];
  const missing: CatStat[] = [];
  let coverage = 0;

  for (const stat of CAT_STATS) {
    const lo = Math.min(parentA[stat], parentB[stat]);
    const hi = Math.max(parentA[stat], parentB[stat]);
    if (lo >= MAX_STAT) {
      states[stat] = 'locked';
      locked.push(stat);
      coverage += 1;
    } else if (hi >= MAX_STAT) {
      states[stat] = 'reachable';
      reachable.push(stat);
      coverage += better;
    } else {
      states[stat] = 'missing';
      missing.push(stat);
    }
  }
  return { states, locked, reachable, missing, coverage };
}

// ── Inbreeding: COI + birth-defect risk (mirrors save_parser.py) ────────────

export interface Pedigreed {
  dbKey: number;
  parents: number[];
}

/**
 * Generation depth per cat (0 = founder/stray, else max parent depth + 1).
 * Used to decide which side the kinship recursion decomposes. Cycle-safe.
 */
export function buildGenerations<T extends Pedigreed>(byKey: Map<number, T>): Map<number, number> {
  const gen = new Map<number, number>();
  const inProgress = new Set<number>();
  const calc = (key: number): number => {
    const cached = gen.get(key);
    if (cached !== undefined) return cached;
    if (inProgress.has(key)) return 0; // cycle: treat as founder
    inProgress.add(key);
    const node = byKey.get(key);
    let g = 0;
    if (node) {
      for (const p of node.parents) {
        if (byKey.has(p)) g = Math.max(g, calc(p) + 1);
      }
    }
    inProgress.delete(key);
    gen.set(key, g);
    return g;
  };
  for (const k of byKey.keys()) calc(k);
  return gen;
}

const CYCLE = Symbol('kinship-cycle');

/**
 * Build a memoised kinship function. Kinship of two cats equals the COI of
 * their hypothetical offspring. Mirrors `_kinship` from save_parser.py:
 *   f(a,a) = ½(1 + f(parents))
 *   decompose whichever cat is the more recent generation toward its parents.
 */
export function makeKinship<T extends Pedigreed>(byKey: Map<number, T>, gen: Map<number, number>) {
  const memo = new Map<string, number | typeof CYCLE>();
  const keyOf = (a: number, b: number) => (a <= b ? `${a}_${b}` : `${b}_${a}`);

  const k = (a: number, b: number): number => {
    const kk = keyOf(a, b);
    const cached = memo.get(kk);
    if (cached !== undefined) return cached === CYCLE ? 0 : cached;
    memo.set(kk, CYCLE);

    let val: number;
    if (a === b) {
      const ps = byKey.get(a)?.parents ?? [];
      const pa = ps[0];
      const pb = ps[1];
      const f = pa !== undefined && pb !== undefined && byKey.has(pa) && byKey.has(pb) ? k(pa, pb) : 0;
      val = 0.5 * (1 + f);
    } else {
      const ga = gen.get(a) ?? 0;
      const gb = gen.get(b) ?? 0;
      let sum = 0;
      if (ga > gb) {
        for (const p of byKey.get(a)?.parents ?? []) if (byKey.has(p)) sum += k(p, b);
      } else {
        for (const p of byKey.get(b)?.parents ?? []) if (byKey.has(p)) sum += k(a, p);
      }
      val = 0.5 * sum;
    }
    memo.set(kk, val);
    return val;
  };
  return k;
}

/** COI of the offspring of a × b (= kinship of the parents). */
export function offspringCoi<T extends Pedigreed>(a: T, b: T, byKey: Map<number, T>): number {
  const gen = buildGenerations(byKey);
  return makeKinship(byKey, gen)(a.dbKey, b.dbKey);
}

/** Birth-defect breakdown from offspring COI (game logic). */
export function maladyBreakdown(coi: number): { disorder: number; defect: number; combined: number } {
  const disorder = 0.02 + 0.4 * Math.min(Math.max(coi - 0.2, 0), 1);
  const defect = coi > 0.05 ? Math.min(1.5 * coi, 1) : 0;
  const combined = 1 - (1 - disorder) * (1 - defect);
  return { disorder, defect, combined };
}

/** Combined birth-defect probability for an a × b offspring, as a 0–100 %. */
export function defectRiskPercent(coi: number): number {
  return Math.max(0, Math.min(100, maladyBreakdown(coi).combined * 100));
}

// ── Room analysis (uses the player's actual designed rooms) ─────────────────

const STIM: StatKey = 'stimulation';
const CMF: StatKey = 'comfort';

export interface RoomBreedingInfo {
  index: number;
  label: string;
  stimulation: number;
  comfort: number;
  /** betterStatChance at this room's stimulation. */
  betterChance: number;
  /** False when comfort < -10 (breeding auto-fails here). */
  viable: boolean;
  itemCount: number;
}

function roomStat(room: PlacedFurniture[], key: StatKey): number {
  let total = 0;
  for (const p of room) total += p.item[key];
  return total;
}

/** Per-room breeding readout for every unlocked room. */
export function analyzeRoomsForBreeding(
  rooms: PlacedFurniture[][],
  isRoomUnlocked: (i: number) => boolean,
): RoomBreedingInfo[] {
  const out: RoomBreedingInfo[] = [];
  for (let i = 0; i < rooms.length; i++) {
    if (!isRoomUnlocked(i)) continue;
    const stimulation = roomStat(rooms[i], STIM);
    const comfort = roomStat(rooms[i], CMF);
    out.push({
      index: i,
      label: getRoomLabel(i),
      stimulation,
      comfort,
      betterChance: betterStatChance(stimulation),
      viable: comfort >= -10,
      itemCount: rooms[i].length,
    });
  }
  return out;
}

/**
 * Pick the best room to run an active breeding pair in: highest Stimulation
 * among viable rooms (Comfort ≥ -10), tie-broken by Comfort. Returns null when
 * no room is viable.
 */
export function recommendBreedingRoom(infos: RoomBreedingInfo[]): RoomBreedingInfo | null {
  const viable = infos.filter((r) => r.viable);
  if (viable.length === 0) return null;
  return viable.reduce((best, r) =>
    r.stimulation > best.stimulation || (r.stimulation === best.stimulation && r.comfort > best.comfort)
      ? r
      : best,
  );
}

/**
 * Stimulation breakpoints the game *guarantees* an inheritance at (community
 * wiki + Steam guides). Below a breakpoint the corresponding ability/passive is
 * only a chance (see abilityInheritanceChances); at or above it, every kitten
 * gets it. `firstActive` (32) is the first one worth building a den around.
 */
export const STIM_BREAKPOINTS = {
  firstActive: 32,
  passive: 95,
  secondActive: 196,
} as const;

export interface StimGuarantees {
  /** 1st active ability guaranteed (stim ≥ 32). */
  firstActive: boolean;
  /** Passive guaranteed (stim ≥ 95). */
  passive: boolean;
  /** 2nd active ability guaranteed (stim ≥ 196). */
  secondActive: boolean;
}

/** Which inheritances a room's Stimulation guarantees outright. */
export function stimGuarantees(stim: number): StimGuarantees {
  return {
    firstActive: stim >= STIM_BREAKPOINTS.firstActive,
    passive: stim >= STIM_BREAKPOINTS.passive,
    secondActive: stim >= STIM_BREAKPOINTS.secondActive,
  };
}

/**
 * Stimulation a room needs to count as a *dependable* breeding den, not merely
 * a viable one. Anchored to the first real game breakpoint: at stim 32 every
 * kitten inherits a 1st active ability and the better-stat chance is ~56%.
 * Below that, lines barely advance. A den you commit a program to clears this.
 */
export const DEPENDABLE_DEN_STIM = STIM_BREAKPOINTS.firstActive;

/** A room worth running the whole breeding program in: viable and stimulating. */
export function isDependableDen(info: RoomBreedingInfo | null): boolean {
  return !!info && info.viable && info.stimulation >= DEPENDABLE_DEN_STIM;
}

/**
 * Cats past the 4th in a room each cost 1 Comfort (every guide's "keep breeding
 * rooms at exactly 4 cats" rule; poop costs more on top). A den's *effective*
 * Comfort for breeding therefore drops as it gets crowded — two breeding pairs
 * (4 cats) is the sweet spot.
 */
export const COMFORT_FREE_OCCUPANCY = 4;

/** Room Comfort after the over-4 occupancy penalty (excludes poop, unknown from save). */
export function effectiveComfort(baseComfort: number, occupancy: number): number {
  return baseComfort - Math.max(0, occupancy - COMFORT_FREE_OCCUPANCY);
}

/**
 * A training ("fight club") room is the opposite of a den: deliberately LOW
 * Comfort so cats spar and gain combat stats (level/item stats, not the base 7).
 * Pick the lowest-Comfort unlocked room, tie-broken by lowest Stimulation.
 */
export function recommendFightClubRoom(infos: RoomBreedingInfo[]): RoomBreedingInfo | null {
  if (infos.length === 0) return null;
  return infos.reduce((low, r) =>
    r.comfort < low.comfort || (r.comfort === low.comfort && r.stimulation < low.stimulation) ? r : low,
  );
}

// ── The Perfect 7 method (the 4-stage plan, as actionable steps) ────────────

export interface GuideStep {
  id: string;
  /** 2–4 word label for the compact progress tracker. */
  short: string;
  title: string;
  detail: string;
}

export interface GuideStage {
  num: number;
  title: string;
  goal: string;
  summary: string;
  steps: GuideStep[];
  notes: string[];
}

export const PERFECT7_STAGES: GuideStage[] = [
  {
    num: 1,
    title: 'Foundation pairs',
    goal: 'Start the cleanest unrelated lines pushing 7s.',
    summary:
      'Pick your best unrelated pairs and breed them in a high-Stimulation room. These are the fastest, lowest-risk lines toward full 7-base-stat coverage.',
    steps: [
      {
        id: 's1-pairs',
        short: 'Pick foundation pairs',
        title: 'Choose 2–3 unrelated foundation pairs',
        detail:
          'Pick pairs that are NOT family — disjoint pairs let you push several lines at once. Between the two parents you want as many stats at 7 as possible.',
      },
      {
        id: 's1-room',
        short: 'High-Stim breeding room',
        title: 'Put each active pair in your highest-Stimulation room',
        detail:
          'Stimulation raises the odds a kitten inherits the higher parent\'s stat (and abilities). Use the room the guide recommends below; keep Comfort at 0 or above.',
      },
      {
        id: 's1-keep',
        short: 'Keep best son + daughter',
        title: 'Keep the strongest son and daughter per pair',
        detail:
          'Save one of each sex from the best litters. Never plan to breed siblings back together — that collapses the line into inbreeding.',
      },
    ],
    notes: [
      'Foundation pairs are disjoint so you can work multiple lines at once.',
      'Aim for unrelated cats: a clean line keeps inbreeding risk at 0.',
    ],
  },
  {
    num: 2,
    title: 'Separate the lines',
    goal: 'Keep clean branches alive instead of sibling loops.',
    summary:
      'Separate offspring by line and sex into different rooms. This protects multiple clean branches for the next generation instead of breeding within one family.',
    steps: [
      {
        id: 's2-rooms',
        short: 'Split lines by room',
        title: 'Move sons and daughters into different rooms',
        detail:
          'Keep each pair\'s sons and daughters apart from each other and from their parents once they mature, so no two siblings end up as the obvious next match.',
      },
      {
        id: 's2-keeper',
        short: 'Keeper fills a gap',
        title: 'If keeping only one kitten, keep the one raising your lowest missing stat',
        detail:
          'When space is tight, the most valuable keeper is the one that adds coverage for a stat your line is still missing at 7.',
      },
    ],
    notes: [
      'This is the child-separation guidance: avoid collapsing into sibling breeding.',
      'Choose one keeper line per sex, then hold backups aside for future outcrosses.',
    ],
  },
  {
    num: 3,
    title: 'Rotate / outcross',
    goal: 'Bring in fresh blood before a line stalls.',
    summary:
      'When a line is missing specific 7s, rotate in an unrelated (or lower-risk) partner that covers those stats, instead of breeding inward.',
    steps: [
      {
        id: 's3-detect',
        short: 'Spot stalled line',
        title: 'Spot the stalled line',
        detail:
          'A line stalls when it stops gaining new 7s and your only same-line options are siblings or parents. Note exactly which stats are still missing.',
      },
      {
        id: 's3-outcross',
        short: 'Outcross missing 7s',
        title: 'Outcross for the missing stats',
        detail:
          'Bring in a stray or unrelated breeder that holds 7 in the missing stats. Promote the kitten that keeps the old locked stats AND adds the new coverage.',
      },
    ],
    notes: [
      'Rotation is driven by which 7-stats each line is missing.',
      'If no clean candidate exists, wait for a better founder rather than inbreeding.',
    ],
  },
  {
    num: 4,
    title: 'Finish & maintain',
    goal: 'Turn keepers into a self-replenishing perfect line.',
    summary:
      'Use your strongest keepers to finish a line at all seven 7s, then keep it producing: a maxed cat of each sex and live unrelated pairs in a dependable den, instead of letting it decay into inbred maintenance.',
    steps: [
      {
        id: 's4-finish',
        short: 'Finish near-perfect cat',
        title: 'Finish the line through a keeper outcross',
        detail:
          'Once a keeper is close to all 7s, use a Stage 3 rotation target to cover the last stats rather than breeding back into siblings or parents.',
      },
      {
        id: 's4-backup',
        short: 'Opposite-sex backup',
        title: 'Keep an opposite-sex backup in a separate room',
        detail:
          'A finished 7-line survives bad rolls only if you hold a primary breeder and a backup of the opposite sex in different rooms.',
      },
      {
        id: 's4-maintain',
        short: 'Self-replenishing stable',
        title: 'Maintain: a stable that replenishes itself',
        detail:
          'A perfect line is only safe when it can reproduce itself: keep a maxed cat of each sex and at least two live unrelated pairs, all breeding in a dependable den. A single perfect cat is a milestone, not a finished program — bring in an unrelated stray whenever your redundancy drops.',
      },
    ],
    notes: [
      'Optimize toward perfect 7-base-stat coverage, not short-term room fill.',
      'Set your inbreeding tolerance to 0 for the cleanest possible line.',
    ],
  },
];

export const TOTAL_STEPS = PERFECT7_STAGES.reduce((n, s) => n + s.steps.length, 0);

export const ALL_STEP_IDS: string[] = PERFECT7_STAGES.flatMap((s) => s.steps.map((st) => st.id));

/** First unchecked step in plan order, or null when the plan is complete. */
export function nextStep(done: Set<string>): { stage: GuideStage; step: GuideStep } | null {
  for (const stage of PERFECT7_STAGES) {
    for (const step of stage.steps) {
      if (!done.has(step.id)) return { stage, step };
    }
  }
  return null;
}
