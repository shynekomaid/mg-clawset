import { describe, it, expect } from 'vitest';
import {
  betterStatChance,
  comfortMultiplier,
  pairCoverage,
  analyzeRoomsForBreeding,
  recommendBreedingRoom,
  isDependableDen,
  stimGuarantees,
  effectiveComfort,
  recommendFightClubRoom,
  DEPENDABLE_DEN_STIM,
  offspringCoi,
  defectRiskPercent,
  maladyBreakdown,
  TOTAL_STEPS,
  nextStep,
  PERFECT7_STAGES,
  type CatStat,
  type Pedigreed,
} from './breeding';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';

function fakeItem(stimulation: number, comfort: number): FurnitureItem {
  return {
    name: 't', image_url: '', shape: [[2]],
    appeal: 0, comfort, stimulation, health: 0, mutation: 0,
    id: 't', spacesOccupied: 1,
    appealPerSpace: 0, comfortPerSpace: 0, stimulationPerSpace: 0, healthPerSpace: 0, mutationPerSpace: 0,
  };
}
function room(stimulation: number, comfort: number): PlacedFurniture[] {
  return [{ instanceId: 'x', item: fakeItem(stimulation, comfort), row: 0, col: 0 }];
}

describe('betterStatChance', () => {
  it('matches the game formula at key stimulations', () => {
    expect(betterStatChance(0)).toBeCloseTo(0.5);
    expect(betterStatChance(50)).toBeCloseTo(0.6);
    expect(betterStatChance(100)).toBeCloseTo(2 / 3);
  });
});

describe('comfortMultiplier', () => {
  it('auto-fails below -10', () => {
    expect(comfortMultiplier(-11)).toBeNull();
    expect(comfortMultiplier(-10)).toBeCloseTo(0);
    expect(comfortMultiplier(0)).toBeCloseTo(1);
    expect(comfortMultiplier(10)).toBeCloseTo(2);
  });
});

describe('pairCoverage', () => {
  const a: Record<CatStat, number> = { STR: 7, DEX: 7, CON: 5, INT: 7, SPD: 4, CHA: 7, LCK: 6 };
  const b: Record<CatStat, number> = { STR: 6, DEX: 7, CON: 7, INT: 5, SPD: 7, CHA: 4, LCK: 7 };

  it('classifies locked/reachable/missing', () => {
    const cov = pairCoverage(a, b, 50);
    expect(cov.locked).toEqual(['DEX']); // both ≥7
    expect(cov.missing).toEqual([]); // every stat reachable by at least one parent
    // STR,CON,INT,SPD,CHA,LCK reachable (one parent ≥7)
    expect(cov.reachable.sort()).toEqual(['CHA', 'CON', 'INT', 'LCK', 'SPD', 'STR']);
  });

  it('coverage = locked + reachable * betterChance', () => {
    const cov = pairCoverage(a, b, 50);
    expect(cov.coverage).toBeCloseTo(1 + 6 * 0.6); // 4.6
  });

  it('flags a missing stat when neither parent has 7', () => {
    const lowA = { ...a, SPD: 3 };
    const lowB = { ...b, SPD: 2 };
    const cov = pairCoverage(lowA, lowB, 50);
    expect(cov.missing).toContain('SPD');
  });
});

describe('room recommendation', () => {
  it('picks highest stimulation among viable rooms', () => {
    const rooms = [room(30, 5), room(80, 2), room(80, 10), room(99, -20)];
    const infos = analyzeRoomsForBreeding(rooms, () => true);
    const best = recommendBreedingRoom(infos);
    expect(best?.index).toBe(2); // stim 80 with higher comfort beats other 80; -20 room excluded
  });

  it('returns null when no room is viable', () => {
    const infos = analyzeRoomsForBreeding([room(50, -50)], () => true);
    expect(recommendBreedingRoom(infos)).toBeNull();
  });

  it('skips locked rooms', () => {
    const infos = analyzeRoomsForBreeding([room(99, 0), room(10, 0)], (i) => i === 1);
    expect(infos).toHaveLength(1);
    expect(infos[0].stimulation).toBe(10);
  });
});

describe('dependable den + stim breakpoints', () => {
  it('anchors the dependable-den bar to the 1st-active breakpoint (32)', () => {
    expect(DEPENDABLE_DEN_STIM).toBe(32);
    const [low, ok] = analyzeRoomsForBreeding([room(31, 0), room(32, 0)], () => true);
    expect(isDependableDen(low)).toBe(false); // stim 31 < 32
    expect(isDependableDen(ok)).toBe(true);   // stim 32, comfort viable
    expect(isDependableDen(null)).toBe(false);
  });

  it('does not count a viable-but-low-stim room as dependable', () => {
    const [info] = analyzeRoomsForBreeding([room(0, 10)], () => true); // comfy but no stim
    expect(info.viable).toBe(true);
    expect(isDependableDen(info)).toBe(false);
  });

  it('reports which inheritances a stim guarantees', () => {
    expect(stimGuarantees(20)).toEqual({ firstActive: false, passive: false, secondActive: false });
    expect(stimGuarantees(32)).toEqual({ firstActive: true, passive: false, secondActive: false });
    expect(stimGuarantees(95)).toEqual({ firstActive: true, passive: true, secondActive: false });
    expect(stimGuarantees(196)).toEqual({ firstActive: true, passive: true, secondActive: true });
  });
});

describe('comfort occupancy (4-cat rule)', () => {
  it('charges 1 comfort per cat past the 4th', () => {
    expect(effectiveComfort(8, 4)).toBe(8);  // two pairs, no penalty
    expect(effectiveComfort(8, 6)).toBe(6);  // 2 over → -2
    expect(effectiveComfort(8, 2)).toBe(8);  // under 4, no bonus
  });
});

describe('fight club room', () => {
  it('picks the lowest-comfort room for stat training', () => {
    const infos = analyzeRoomsForBreeding([room(80, 10), room(20, -5), room(50, 2)], () => true);
    expect(recommendFightClubRoom(infos)?.comfort).toBe(-5);
  });
  it('is null with no rooms', () => {
    expect(recommendFightClubRoom([])).toBeNull();
  });
});

describe('offspringCoi', () => {
  // Pedigree: P and Q are founders; A and B are their children (full siblings);
  // C is unrelated; D is a child of A (parent line).
  const byKey = new Map<number, Pedigreed>();
  const add = (dbKey: number, parents: number[]) => byKey.set(dbKey, { dbKey, parents });
  add(1, []); // P
  add(2, []); // Q
  add(3, [1, 2]); // A
  add(4, [1, 2]); // B (sibling of A)
  add(5, []); // C (unrelated founder)
  add(6, [3, 5]); // D (child of A and unrelated C)
  const g = (k: number) => byKey.get(k)!;

  it('is 0 for unrelated cats', () => {
    expect(offspringCoi(g(3), g(5), byKey)).toBeCloseTo(0);
  });
  it('is 0.25 for full siblings', () => {
    expect(offspringCoi(g(3), g(4), byKey)).toBeCloseTo(0.25);
  });
  it('is 0.25 for parent × child', () => {
    expect(offspringCoi(g(3), g(6), byKey)).toBeCloseTo(0.25);
  });
});

describe('defect risk (game CoI formula)', () => {
  it('unrelated pairs carry only the base disorder chance (~2%)', () => {
    expect(defectRiskPercent(0)).toBeCloseTo(2, 5);
  });
  it('a sibling-level COI (0.25) is ~40%', () => {
    expect(defectRiskPercent(0.25)).toBeCloseTo(40, 0);
  });
  it('breakdown combines disorder and part-defect independently', () => {
    const { disorder, defect, combined } = maladyBreakdown(0.25);
    expect(disorder).toBeCloseTo(0.04);
    expect(defect).toBeCloseTo(0.375);
    expect(combined).toBeCloseTo(1 - (1 - 0.04) * (1 - 0.375));
  });
});

describe('plan steps', () => {
  it('counts every step across stages', () => {
    const sum = PERFECT7_STAGES.reduce((n, s) => n + s.steps.length, 0);
    expect(TOTAL_STEPS).toBe(sum);
  });

  it('nextStep walks in order and ends null when complete', () => {
    expect(nextStep(new Set())?.step.id).toBe(PERFECT7_STAGES[0].steps[0].id);
    const all = new Set(PERFECT7_STAGES.flatMap((s) => s.steps.map((st) => st.id)));
    expect(nextStep(all)).toBeNull();
  });
});
