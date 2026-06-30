import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Filters, SortConfig, SortField, FurnitureItem, RawFurnitureItem, PlacedFurniture } from './types/furniture';
import { getRoomConfig, ATTIC_INDEX, HOUSE_VIEW } from './types/furniture';
import furnitureData from './data/furniture_data.json';
import SplitScreenContainer from './components/SplitScreenContainer';
import FurnitureBrowser from './components/FurnitureBrowser';
import RoomDesignerWorkspace from './components/RoomDesignerWorkspace';
import SaveImportModal from './components/SaveImportModal';
import AppHeader from './components/AppHeader';
import WelcomeHero from './components/WelcomeHero';
import BreedingGuide from './components/BreedingGuide';
import { findAllAnchored, findAnchoredPieces, wouldCollide } from './utils/anchorHelpers';
import { autoPopulateRoomAsync, autoPopulateRoom, statScore, preAllocateItems, pushScore, isConverged } from './utils/autoPopulate';
import type { AlgorithmKey, RoomFillPlan } from './utils/autoPopulate';
import type { AppView } from './components/AppHeader';
import useIsMobile from './hooks/useIsMobile';
import { parseSavegame } from './utils/savegame';
import type { HouseInfo, SavedPlacement } from './utils/savegame';
import type { ParsedCat } from './utils/catParser';
import { saveSavefileHandle, loadSavefileHandle, readRememberedSavefile } from './utils/savefileHandle';
import { applyRoomPlacements } from './utils/placementImport';

function countSpaces(shape: number[][]): number {
  let count = 0;
  for (const row of shape) {
    for (const cell of row) {
      if (cell === 2 || cell === 3) count++; // solid + anchor point
    }
  }
  return Math.max(count, 1); // avoid division by zero
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const allFurniture: FurnitureItem[] = (furnitureData as RawFurnitureItem[]).map((item, index) => {
  const spaces = countSpaces(item.shape);
  return {
    ...item,
    id: `${item.name}__${index}`,
    spacesOccupied: spaces,
    appealPerSpace: round2(item.appeal / spaces),
    comfortPerSpace: round2(item.comfort / spaces),
    stimulationPerSpace: round2(item.stimulation / spaces),
    healthPerSpace: round2(item.health / spaces),
    mutationPerSpace: round2(item.mutation / spaces),
  };
});

// Map for save file import matching:
// 1. lowercase display name -> id
// 2. internal name (from image_url) -> id
const furnitureIdMap = new Map<string, string>();
for (const item of allFurniture) {
  // Display name match
  const displayKey = item.name.toLowerCase();
  if (!furnitureIdMap.has(displayKey)) {
    furnitureIdMap.set(displayKey, item.id);
  }
  // Internal name match: extract from "graphics/FURNITURE_xxx.svg"
  const match = item.image_url.match(/FURNITURE_(.+)\.svg$/i);
  if (match) {
    const internalKey = match[1].toLowerCase();
    if (!furnitureIdMap.has(internalKey)) {
      furnitureIdMap.set(internalKey, item.id);
    }
  }
}

const HERO_SEEN_KEY = 'mg-clawset-hero-seen';

// Special idols (wiki: "Special Furniture") — unique effects beyond raw stats
const IDOL_RE = /special_\w*(idol)/i;
const idolItems = allFurniture.filter((it) => IDOL_RE.test(it.image_url));
const foodBoxItem = allFurniture.find((it) => it.image_url.includes('special_foodbox')) ?? null;
const HOUSE_UNLOCKS_KEY = 'mg-clawset-house-unlocks';
const CATS_STORAGE_KEY = 'mg-clawset-cats';

function loadHouseInfo(): HouseInfo | null {
  try {
    const raw = localStorage.getItem(HOUSE_UNLOCKS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function loadCats(): ParsedCat[] {
  try {
    const raw = localStorage.getItem(CATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

const defaultFilters: Filters = {
  name: '',
  minAppeal: -20,
  minComfort: -20,
  minStimulation: -20,
  minHealth: -20,
  minMutation: -20,
  onlyOwned: false,
  shapeWidth: null,
  shapeHeight: null,
  exactShape: null,
  anchorFilter: 'any',
  onlyRemaining: false,
};

const defaultSort: SortConfig = { field: 'name', direction: 'asc' };

const ITEMS_PER_PAGE = 50;
const STORAGE_KEY = 'mg-clawset-ownership';
const ROOMS_STORAGE_KEY = 'mg-clawset-rooms';
const NUM_ROOMS = 5;
// Per-room search rounds for one "keep searching" pass: small so passes are
// quick and many run; the outer loop keeps the best house across all passes.
const KEEP_PASS_ITERATIONS = 25;

let nextInstanceId = 1;

function loadRooms(): PlacedFurniture[][] {
  try {
    const raw = localStorage.getItem(ROOMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlacedFurniture[][];
      if (Array.isArray(parsed)) {
        for (const room of parsed) {
          for (const p of room) {
            const num = parseInt(p.instanceId.split('-').pop() || '0', 10);
            if (num >= nextInstanceId) nextInstanceId = num + 1;
          }
        }
        // Pad to NUM_ROOMS if saved with fewer
        while (parsed.length < NUM_ROOMS) parsed.push([]);
        return parsed;
      }
    }
    // Migrate from old single-room key
    const oldRaw = localStorage.getItem('mg-clawset-room');
    if (oldRaw) {
      const oldParsed = JSON.parse(oldRaw) as PlacedFurniture[];
      for (const p of oldParsed) {
        const num = parseInt(p.instanceId.split('-').pop() || '0', 10);
        if (num >= nextInstanceId) nextInstanceId = num + 1;
      }
      const rooms: PlacedFurniture[][] = [oldParsed];
      while (rooms.length < NUM_ROOMS) rooms.push([]);
      return rooms;
    }
  } catch { /* ignore */ }
  return Array.from({ length: NUM_ROOMS }, () => []);
}

function loadOwnership(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

const layoutStyles: Record<string, CSSProperties> = {
  main: {
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: "'Rubik', system-ui, sans-serif",
  },
  browserWrapper: {
    minHeight: 0,
    height: '100%',
    position: 'relative',
    overflow: 'visible',
    transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    flexShrink: 0,
  },
};

function App() {
  const isMobile = useIsMobile();
  const [ownership, setOwnership] = useState<Record<string, number>>(loadOwnership);
  const hasOwnership = Object.keys(ownership).length > 0;
  const [filters, setFilters] = useState<Filters>(
    () => ({ ...defaultFilters, onlyOwned: Object.keys(loadOwnership()).length > 0 }),
  );
  const [sort, setSort] = useState<SortConfig>(defaultSort);
  // Drawer starts open only for users without a collection (theorycrafting)
  const [drawerOpen, setDrawerOpen] = useState(() => Object.keys(loadOwnership()).length === 0);
  const [heroSeen, setHeroSeen] = useState(() => !!localStorage.getItem(HERO_SEEN_KEY));
  const [page, setPage] = useState(0);
  const [rooms, setRooms] = useState<PlacedFurniture[][]>(loadRooms);
  const [activeRoom, setActiveRoom] = useState(HOUSE_VIEW);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [statsPerSpace, setStatsPerSpace] = useState(false);
  const [savefileName, setSavefileName] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [houseInfo, setHouseInfo] = useState<HouseInfo | null>(loadHouseInfo);
  const [cats, setCats] = useState<ParsedCat[]>(loadCats);
  // 0..1 while an auto-fill search runs, null when idle
  const [fillProgress, setFillProgress] = useState<number | null>(null);
  // quality summary of the last auto-fill ("how close to the theoretical max?")
  const [fillReport, setFillReport] = useState<string | null>(null);
  // live state of an unbounded "keep searching" run; null when not running
  const [fillSearch, setFillSearch] = useState<{ passes: number; bestScore: number } | null>(null);
  // flipped by "Use best result" to stop the keep-searching loop
  const stopSearchRef = useRef(false);
  const stopSearch = useCallback(() => { stopSearchRef.current = true; }, []);
  const [view, setView] = useState<AppView>('house');

  const isRoomUnlocked = useCallback((i: number): boolean => {
    if (!houseInfo) return true; // unknown: assume everything available
    if (i === ATTIC_INDEX) return houseInfo.atticUnlocked;
    return i < houseInfo.regularRooms;
  }, [houseInfo]);

  // Surface the remembered savefile (if any) in the header
  useEffect(() => {
    loadSavefileHandle().then((h) => { if (h) setSavefileName(h.name); });
  }, []);

  const placed = activeRoom === HOUSE_VIEW ? rooms.flat() : rooms[activeRoom];

  const dismissHero = useCallback(() => {
    setHeroSeen(true);
    localStorage.setItem(HERO_SEEN_KEY, '1');
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ownership));
  }, [ownership]);

  useEffect(() => {
    try {
      if (cats.length > 0) localStorage.setItem(CATS_STORAGE_KEY, JSON.stringify(cats));
      else localStorage.removeItem(CATS_STORAGE_KEY);
    } catch { /* roster too large for storage: keep it in memory only */ }
  }, [cats]);

  useEffect(() => {
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  }, [rooms]);

  // Undo/redo: every room mutation goes through updateRooms, which snapshots
  // the previous state (rooms arrays are immutable, so references suffice).
  const historyRef = useRef<{ past: PlacedFurniture[][][]; future: PlacedFurniture[][][] }>({ past: [], future: [] });
  const [histVersion, setHistVersion] = useState(0);
  const updateRooms = useCallback((next: PlacedFurniture[][] | ((prev: PlacedFurniture[][]) => PlacedFurniture[][])) => {
    setRooms((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value === prev) return prev;
      const h = historyRef.current;
      h.past.push(prev);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      return value;
    });
    setHistVersion((v) => v + 1);
  }, []);
  const undo = useCallback(() => {
    setRooms((prev) => {
      const h = historyRef.current;
      const last = h.past.pop();
      if (!last) return prev;
      h.future.push(prev);
      return last;
    });
    setHistVersion((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    setRooms((prev) => {
      const h = historyRef.current;
      const next = h.future.pop();
      if (!next) return prev;
      h.past.push(prev);
      return next;
    });
    setHistVersion((v) => v + 1);
  }, []);
  void histVersion; // state only forces re-render so canUndo/canRedo stay fresh
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) anywhere outside text inputs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const updateActiveRoom = useCallback((updater: (prev: PlacedFurniture[]) => PlacedFurniture[]) => {
    updateRooms(prev => prev.map((room, i) => i === activeRoom ? updater(room) : room));
  }, [activeRoom, updateRooms]);

  const handlePlaceFurniture = useCallback((item: FurnitureItem, row: number, col: number) => {
    const instanceId = `placed-${nextInstanceId++}`;
    updateActiveRoom((prev) => [...prev, { instanceId, item, row, col }]);
  }, [updateActiveRoom]);

  const handleRemoveFurniture = useCallback((instanceId: string) => {
    const cfg = getRoomConfig(activeRoom);
    updateActiveRoom((prev) => {
      const cascadeIds = findAnchoredPieces(instanceId, prev, cfg);
      const removeSet = new Set([instanceId, ...cascadeIds]);
      return prev.filter((p) => !removeSet.has(p.instanceId));
    });
  }, [updateActiveRoom, activeRoom]);

  const handleMoveFurniture = useCallback((instanceId: string, newRow: number, newCol: number) => {
    const cfg = getRoomConfig(activeRoom);
    updateActiveRoom((prev) => {
      const target = prev.find(p => p.instanceId === instanceId);
      if (!target) return prev;

      const dRow = newRow - target.row;
      const dCol = newCol - target.col;

      // Recursively find ALL pieces anchored to the moving piece
      const anchoredIds = findAllAnchored(instanceId, prev);
      const movedIds = new Set([instanceId, ...anchoredIds]);

      // Move the target and all anchored pieces by the same delta
      let next = prev.map(p =>
        movedIds.has(p.instanceId)
          ? { ...p, row: p.row + (p.instanceId === instanceId ? newRow - target.row : dRow), col: p.col + (p.instanceId === instanceId ? newCol - target.col : dCol) }
          : p
      );

      // Build occupancy from non-moved pieces to check collisions
      const occupiedByOthers = new Set<string>();
      for (const p of next) {
        if (movedIds.has(p.instanceId)) continue;
        for (let r = 0; r < p.item.shape.length; r++) {
          for (let c = 0; c < p.item.shape[r].length; c++) {
            const t = p.item.shape[r][c];
            if (t === 2 || t === 3) {
              occupiedByOthers.add(`${p.row + r},${p.col + c}`);
            }
          }
        }
      }

      // Remove anchored pieces that now collide or are out of bounds
      const toRemove = new Set<string>();
      for (const aid of anchoredIds) {
        const piece = next.find(p => p.instanceId === aid)!;
        if (wouldCollide(piece.item, piece.row, piece.col, occupiedByOthers, cfg)) {
          toRemove.add(aid);
        }
      }

      if (toRemove.size > 0) {
        // Also cascade-remove anything anchored to the colliding pieces
        for (const rid of toRemove) {
          const cascaded = findAnchoredPieces(rid, next, cfg);
          for (const cid of cascaded) toRemove.add(cid);
        }
        next = next.filter(p => !toRemove.has(p.instanceId));
      }

      return next;
    });
  }, [updateActiveRoom, activeRoom]);



  const handleAutoPopulate = useCallback(async (config: {
    algorithm: AlgorithmKey;
    plans: RoomFillPlan[];
    /** 4-position mode: old=one-shot, standard/long/extreme=keep-searching. */
    searchMode?: 'optimal' | 'standard' | 'long' | 'extreme';
    /** Item ID → house-wide total cap (e.g. food box limit). */
    itemCaps?: Record<string, number>;
  }) => {
    const { algorithm, plans, searchMode } = config;
    if (plans.length === 0) return;
    const makeInstanceId = () => `placed-${nextInstanceId++}`;
    // theorycrafting without a savegame: the whole in-game catalog is available
    const effectiveOwnership = hasOwnership
      ? ownership
      : Object.fromEntries(allFurniture.map((it) => [it.id, 9]));

    const roomCapacity = (ri: number) => {
      const cfg = getRoomConfig(ri);
      let n = 0;
      for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) if (cfg.isValidCell(r, c)) n++;
      }
      return n;
    };

    // Reserved usage + theoretical-max + capacity are identical every pass:
    // they depend only on the rooms left out of this fill and the plan weights.
    const planned = new Set(plans.map((p) => p.roomIndex));
    const reserved: Record<string, number> = {};
    for (let i = 0; i < rooms.length; i++) {
      if (planned.has(i)) continue;
      for (const p of rooms[i]) reserved[p.item.id] = (reserved[p.item.id] || 0) + 1;
    }
    let upperScore = 0;
    let capacity = 0;
    for (const plan of plans) {
      for (const it of allFurniture) {
        const remaining = (effectiveOwnership[it.id] ?? 0) - (reserved[it.id] ?? 0);
        if (remaining <= 0) continue;
        const sc = statScore(it, plan.weights);
        if (sc > 0) upperScore += sc * remaining;
      }
      capacity += roomCapacity(plan.roomIndex);
    }

    // One full-house pass: fill every planned room in order, reserving items as
    // we go. `seedBase` varies the randomized 'maximize' search between passes.
    //
    // Items in other rooms' `mustInclude` are reserved (marked consumed) so the
    // current room cannot steal idols/food assigned to a different room.
    const mustIncludeReservation: Record<string, number> = {};
    for (const plan of plans) {
      for (const id of plan.mustInclude) {
        mustIncludeReservation[id] = (mustIncludeReservation[id] || 0) + 1;
      }
    }

    // Reserve surplus copies of items that appear in mustInclude across multiple
    // rooms. If 3 food boxes are owned but the cap is 2, 1 copy is reserved
    // globally so the total placed across the house doesn't exceed the cap.
    // Only applies to items with an explicit house-wide cap (itemCaps) — auto
    // mode leaves them unrestricted.
    const globalReserved: Record<string, number> = {};
    if (config.itemCaps) {
      for (const [id, cap] of Object.entries(config.itemCaps)) {
        const totalOwned = effectiveOwnership[id] ?? 0;
        if (totalOwned > cap) globalReserved[id] = totalOwned - cap;
      }
    }

    // Cross-room pre-allocation: items whose stat score in one room is >2x the
    // next best are assigned exclusively to that room. This prevents strongly
    // biased items from being consumed by a wrong room in the fill order.
    const preAllocated = preAllocateItems(plans, allFurniture, effectiveOwnership);

    // Compute keep-searching behaviour from the mode.
    // 'optimal' or undefined → one-shot fill (original behavior, single-room fallback).
    type SearchParams = { staleLimit: number; temperature: boolean; permutations: boolean };
    const searchParams: SearchParams | null = searchMode === 'extreme'
      ? { staleLimit: 3, temperature: true, permutations: true }
      : searchMode === 'long'
      ? { staleLimit: 15, temperature: true, permutations: false }
      : searchMode === 'standard'
      ? { staleLimit: 5, temperature: false, permutations: false }
      : null;

    const fillPass = (seedBase: number, roomOrder: RoomFillPlan[] = plans) => {
      const newRooms = rooms.map((room, i) => (planned.has(i) ? [] : [...room]));
      const used: Record<string, number> = { ...reserved, ...globalReserved };
      let placedTotal = 0;
      let achievedScore = 0;
      let cellsUsed = 0;
      for (const plan of roomOrder) {
        // Items assigned to other rooms via mustInclude are off-limits here.
        const otherReserved: Record<string, number> = {};
        for (const [id, count] of Object.entries(mustIncludeReservation)) {
          const forThisRoom = plan.mustInclude.includes(id) ? 1 : 0;
          const remainingReservation = count - forThisRoom;
          if (remainingReservation > 0) otherReserved[id] = remainingReservation;
        }

        // Items pre-allocated to other rooms are off-limits here.
        const otherPreAllocated: Record<string, number> = {};
        for (const [ri, allocItems] of Object.entries(preAllocated)) {
          const roomIdx = Number(ri);
          if (roomIdx === plan.roomIndex) continue;
          for (const [id, count] of Object.entries(allocItems)) {
            otherPreAllocated[id] = (otherPreAllocated[id] || 0) + count;
          }
        }

        // Merge all reservation layers. Use additive merge for preAllocated
        // (distinct copies) and max for otherReserved (same copy counted once).
        const merged: Record<string, number> = { ...used };
        for (const [id, count] of Object.entries(otherReserved)) {
          merged[id] = Math.max(merged[id] || 0, count);
        }
        for (const [id, count] of Object.entries(otherPreAllocated)) {
          merged[id] = (merged[id] || 0) + count;
        }

        const result = autoPopulateRoom({
          weights: plan.weights,
          minStats: plan.minStats,
          mustInclude: plan.mustInclude,
          excludeItemIds: plan.excludeItemIds,
          algorithm,
          iterations: algorithm === 'maximize' ? KEEP_PASS_ITERATIONS : undefined,
          seed: seedBase + plan.roomIndex * 7919,
          roomIndex: plan.roomIndex,
          allFurniture,
          ownership: effectiveOwnership,
          usedInOtherRooms: merged,
          makeInstanceId,
        });
        newRooms[plan.roomIndex] = result;
        placedTotal += result.length;
        for (const p of result) {
          used[p.item.id] = (used[p.item.id] || 0) + 1;
          achievedScore += statScore(p.item, plan.weights);
          cellsUsed += p.item.spacesOccupied;
        }
      }
      return { newRooms, placedTotal, achievedScore, cellsUsed };
    };

    const reportFor = (achievedScore: number, cellsUsed: number) => {
      const pct = upperScore > 0 ? Math.round((achievedScore / upperScore) * 100) : 100;
      return hasOwnership
        ? `Score ${achievedScore} \u2014 ${pct}% of the theoretical max (every scoring copy placed, space ignored) \u00b7 ${cellsUsed}/${capacity} cells used`
        : `Score ${achievedScore} (full catalog, no savegame) \u00b7 ${cellsUsed}/${capacity} cells used`;
    };

    setFillReport(null);

    // --- Keep-searching (searchMode set) vs. one-shot (single-room fill). ---
    if (searchParams) {
      const keepSearching = searchParams.staleLimit;
      stopSearchRef.current = false;
      setFillSearch({ passes: 0, bestScore: 0 });

      // generatePermutations returns all 5! orderings of plans.
      const generatePermutations = <T,>(arr: T[]): T[][] => {
        if (arr.length <= 1) return [arr];
        const result: T[][] = [];
        for (let i = 0; i < arr.length; i++) {
          const rest = generatePermutations(arr.filter((_, j) => j !== i));
          for (const perm of rest) result.push([arr[i], ...perm]);
        }
        return result;
      };

      let bestGlobal: ReturnType<typeof fillPass> | null = null;
      let totalPasses = 0;
      let usedOrders = 1;
      const orders = searchParams.permutations
        ? generatePermutations(plans)
        : [plans];

      try {
        for (let oi = 0; oi < orders.length; oi++) {
          if (stopSearchRef.current) break;
          const order = orders[oi];
          usedOrders = oi + 1;
          let best: ReturnType<typeof fillPass> | null = null;
          let stalePasses = 0;
          const scoreWindow: number[] = [];

          for (
            let pi = 0;
            !stopSearchRef.current && (keepSearching === 0 || stalePasses < keepSearching);
            pi++
          ) {
            const pass = fillPass(0x1234 + totalPasses * 2654435761, order);
            totalPasses += 1;

            if (pass.placedTotal > 0 && (best === null || pass.achievedScore > best.achievedScore)) {
              best = pass;
              stalePasses = 0;
            } else {
              stalePasses += 1;
            }

            // Temperature check: if enabled, exit early when improvement stalls.
            if (searchParams.temperature && best) {
              pushScore(scoreWindow, best.achievedScore, 10);
              if (scoreWindow.length >= 10 && isConverged(scoreWindow, 0.01)) {
                break;
              }
            }

            setFillSearch({ passes: totalPasses, bestScore: best?.achievedScore ?? 0 });
            // yield to the event loop so the UI stays responsive
            await new Promise((r) => setTimeout(r, 0));
          }

          // Track best across all orders
          if (best && (bestGlobal === null || best.achievedScore > bestGlobal.achievedScore)) {
            bestGlobal = best;
          }
        }
      } finally {
        setFillSearch(null);
      }

      if (!bestGlobal) {
        window.alert('Nothing to place: no owned furniture with remaining copies scores positively for the selected stats.');
        return;
      }
      const orderLabel = searchParams.permutations ? ` \u00b7 ${usedOrders}/${orders.length} orders` : '';
      updateRooms(bestGlobal.newRooms);
      setFillReport(`${reportFor(bestGlobal.achievedScore, bestGlobal.cellsUsed)} \u00b7 best of ${totalPasses} passes${orderLabel}`);
      return;
    }

    // --- One-shot fill with the live progress bar (default behavior). ---
    const budgetMs = algorithm === 'maximize' ? 1500 : undefined;
    setFillProgress(0);
    try {
      const newRooms = rooms.map((room, i) => (planned.has(i) ? [] : [...room]));
      const used: Record<string, number> = { ...reserved, ...globalReserved };
      let placedTotal = 0;
      let achievedScore = 0;
      let cellsUsed = 0;
      for (let pi = 0; pi < plans.length; pi++) {
        const plan = plans[pi];
        // Other rooms' mustInclude items are reserved (see fillPass comment).
        const otherReserved: Record<string, number> = {};
        for (const [id, count] of Object.entries(mustIncludeReservation)) {
          const forThisRoom = plan.mustInclude.includes(id) ? 1 : 0;
          const remainingReservation = count - forThisRoom;
          if (remainingReservation > 0) otherReserved[id] = remainingReservation;
        }
        const merged: Record<string, number> = { ...used };
        for (const [id, count] of Object.entries(otherReserved)) {
          merged[id] = Math.max(merged[id] || 0, count);
        }
        const result = await autoPopulateRoomAsync({
          weights: plan.weights,
          minStats: plan.minStats,
          mustInclude: plan.mustInclude,
          excludeItemIds: plan.excludeItemIds,
          algorithm,
          budgetMs,
          roomIndex: plan.roomIndex,
          allFurniture,
          ownership: effectiveOwnership,
          usedInOtherRooms: merged,
          makeInstanceId,
        }, (p) => setFillProgress((pi + p.fraction) / plans.length));
        newRooms[plan.roomIndex] = result;
        placedTotal += result.length;
        for (const p of result) {
          used[p.item.id] = (used[p.item.id] || 0) + 1;
          achievedScore += statScore(p.item, plan.weights);
          cellsUsed += p.item.spacesOccupied;
        }
      }
      if (placedTotal === 0) {
        window.alert('Nothing to place: no owned furniture with remaining copies scores positively for the selected stats.');
        return;
      }
      updateRooms(newRooms);
      setFillReport(reportFor(achievedScore, cellsUsed));
    } finally {
      setFillProgress(null);
    }
  }, [rooms, ownership, hasOwnership, updateRooms]);

  const handleSortChange = useCallback((field: SortField) => {
    setSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(0);
  }, []);

  const handleFiltersChange = useCallback((newFilters: Filters) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const handleIncrement = useCallback((id: string) => {
    setOwnership((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  }, []);

  const handleImportOwnership = useCallback((newOwnership: Record<string, number> | null, newHouseInfo: HouseInfo | null = null, placements: SavedPlacement[] | null = null, newCats?: ParsedCat[]) => {
    if (newCats && newCats.length > 0) setCats(newCats);
    if (newOwnership) {
      setOwnership(newOwnership);
      // After loading a savegame, show what the player actually owns
      setFilters((prev) => ({ ...prev, onlyOwned: true }));
      // ...and get the drawer out of the way: the house is the main view now
      setDrawerOpen(false);
    }
    if (newHouseInfo) {
      setHouseInfo(newHouseInfo);
      localStorage.setItem(HOUSE_UNLOCKS_KEY, JSON.stringify(newHouseInfo));
    }
    if (placements) {
      const byId = new Map(allFurniture.map((f) => [f.id, f]));
      const newRooms: PlacedFurniture[][] = Array.from({ length: NUM_ROOMS }, () => []);
      for (let ri = 0; ri < NUM_ROOMS; ri++) {
        const roomPls = placements.filter((pl) => pl.roomIndex === ri);
        newRooms[ri] = applyRoomPlacements(ri, roomPls, byId).map((p) => ({
          instanceId: `placed-${nextInstanceId++}`,
          item: p.item,
          row: p.row,
          col: p.col,
        }));
      }
      updateRooms(newRooms);
      setActiveRoom(HOUSE_VIEW);
    }
  }, [updateRooms]);

  const openImportModal = useCallback(() => {
    dismissHero();
    setImportModalOpen(true);
  }, [dismissHero]);

  const handleSavefileHandleCaptured = useCallback((handle: FileSystemFileHandle) => {
    setSavefileName(handle.name);
    saveSavefileHandle(handle).catch(() => { /* remembering is best-effort */ });
  }, []);

  // One-click re-import from the remembered file; falls back to the dialog
  const handleLoadSavegame = useCallback(async () => {
    dismissHero();
    setReloading(true);
    try {
      const remembered = await readRememberedSavefile();
      if (remembered) {
        const { ownership: newOwnership, houseInfo: hi, placements, cats: newCats } = await parseSavegame(remembered.data, furnitureIdMap);
        if (Object.keys(newOwnership).length > 0) {
          handleImportOwnership(newOwnership, hi, placements, newCats);
          return;
        }
      }
    } catch { /* fall through to the dialog */ }
    finally {
      setReloading(false);
    }
    setImportModalOpen(true);
  }, [dismissHero, handleImportOwnership]);

  const handleImportRooms = useCallback((allEntries: { id: string; row: number; col: number }[][]) => {
    const furnitureById = new Map(allFurniture.map(f => [f.id, f]));
    const newRooms: PlacedFurniture[][] = allEntries.map(entries => {
      const room: PlacedFurniture[] = [];
      for (const entry of entries) {
        const item = furnitureById.get(entry.id);
        if (!item) continue;
        const instanceId = `placed-${nextInstanceId++}`;
        room.push({ instanceId, item, row: entry.row, col: entry.col });
      }
      return room;
    });
    while (newRooms.length < NUM_ROOMS) newRooms.push([]);
    updateRooms(newRooms);
    setActiveRoom(0);
  }, [updateRooms]);

  const handleDecrement = useCallback((id: string) => {
    setOwnership((prev) => {
      const current = prev[id] || 0;
      if (current <= 0) return prev;
      return { ...prev, [id]: current - 1 };
    });
  }, []);

  // Count furniture used across ALL rooms
  const usedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const room of rooms) {
      for (const p of room) {
        counts[p.item.id] = (counts[p.item.id] || 0) + 1;
      }
    }
    return counts;
  }, [rooms]);

  const filteredAndSorted = useMemo(() => {
    let result = allFurniture.filter((item) => {
      if (filters.name && !item.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
      if (item.appeal < filters.minAppeal) return false;
      if (item.comfort < filters.minComfort) return false;
      if (item.stimulation < filters.minStimulation) return false;
      if (item.health < filters.minHealth) return false;
      if (item.mutation < filters.minMutation) return false;
      if (filters.onlyOwned && !(ownership[item.id] > 0)) return false;
      if (filters.onlyRemaining) {
        const remaining = (ownership[item.id] || 0) - (usedCounts[item.id] || 0);
        if (remaining <= 0) return false;
      }
      // Anchor filter
      if (filters.anchorFilter !== 'any') {
        const hasAnchor = item.shape.some(row => row.some(c => c === 4));
        if (filters.anchorFilter === 'anchored' && !hasAnchor) return false;
        if (filters.anchorFilter === 'not-anchored' && hasAnchor) return false;
      }
      // Compute bounding box excluding anchors and empty cells
      let minR = item.shape.length, maxR = -1, minC = Infinity, maxC = -1;
      for (let r = 0; r < item.shape.length; r++) {
        for (let c = 0; c < item.shape[r].length; c++) {
          if (item.shape[r][c] !== 1 && item.shape[r][c] !== 4) {
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
          }
        }
      }
      const effectiveW = maxR === -1 ? 0 : maxC - minC + 1;
      const effectiveH = maxR === -1 ? 0 : maxR - minR + 1;
      // Shape dimension filter
      if (filters.shapeWidth !== null || filters.shapeHeight !== null) {
        if (filters.shapeWidth !== null && effectiveW !== filters.shapeWidth) return false;
        if (filters.shapeHeight !== null && effectiveH !== filters.shapeHeight) return false;
      }
      // Exact shape filter — offset to effective bounding box
      if (filters.exactShape) {
        const es = filters.exactShape;
        for (let r = 0; r < es.length; r++) {
          for (let c = 0; c < es[r].length; c++) {
            const required = es[r][c];
            if (required === null) continue; // any value ok
            const actual = item.shape[minR + r]?.[minC + c] ?? 1;
            if (actual !== required) return false;
          }
        }
      }
      return true;
    });

    const perSpaceKey: Record<string, keyof FurnitureItem> = {
      appeal: 'appealPerSpace',
      comfort: 'comfortPerSpace',
      stimulation: 'stimulationPerSpace',
      health: 'healthPerSpace',
      mutation: 'mutationPerSpace',
    };

    result = [...result].sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      if (sort.field === 'name') {
        return dir * a.name.localeCompare(b.name);
      }
      if (sort.field === 'owned') {
        return dir * ((ownership[a.id] || 0) - (ownership[b.id] || 0));
      }
      if (sort.field === 'remaining') {
        const remA = (ownership[a.id] || 0) - (usedCounts[a.id] || 0);
        const remB = (ownership[b.id] || 0) - (usedCounts[b.id] || 0);
        return dir * (remA - remB);
      }
      const key = statsPerSpace ? perSpaceKey[sort.field] ?? sort.field : sort.field;
      const diff = (a[key] as number) - (b[key] as number);
      if (diff !== 0) return dir * diff;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [filters, sort, ownership, statsPerSpace, usedCounts]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pagedItems = filteredAndSorted.slice(
    clampedPage * ITEMS_PER_PAGE,
    (clampedPage + 1) * ITEMS_PER_PAGE,
  );

  return (
    <div style={{
      ...layoutStyles.main,
      display: 'flex',
      flexDirection: 'column',
      ...(isMobile ? { height: 'auto', minHeight: '100vh', overflow: 'visible' } : {}),
    }}>
      {!isMobile && !heroSeen && (
        <WelcomeHero onLoadSavegame={openImportModal} onBrowse={dismissHero} />
      )}
      {!isMobile && (
        <AppHeader
          onHome={() => { setView('house'); setActiveRoom(HOUSE_VIEW); }}
          onLoadSavegame={handleLoadSavegame}
          hasOwnership={hasOwnership}
          savefileName={savefileName}
          reloading={reloading}
          view={view}
          onViewChange={setView}
        />
      )}
      {!isMobile && view === 'breeding' ? (
        <BreedingGuide
          rooms={rooms}
          isRoomUnlocked={isRoomUnlocked}
          cats={cats}
          onOpenRoom={(i) => { setView('house'); setActiveRoom(i); }}
          onLoadSavegame={handleLoadSavegame}
        />
      ) : !isMobile && view === 'furniture' ? (
        <div style={{ flex: 1, minHeight: 0, padding: 16, width: '100%', boxSizing: 'border-box' }}>
          <FurnitureBrowser
            items={pagedItems}
            totalItems={filteredAndSorted.length}
            ownership={ownership}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            sort={sort}
            onSortChange={handleSortChange}
            onIncrement={handleIncrement}
            onDecrement={handleDecrement}
            expanded
            onToggle={() => {}}
            showToggle={false}
            page={clampedPage}
            totalPages={totalPages}
            onPageChange={setPage}
            onImportClick={openImportModal}
            isMobile={isMobile}
            statsPerSpace={statsPerSpace}
            onStatsPerSpaceChange={setStatsPerSpace}
            usedCounts={usedCounts}
          />
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <SplitScreenContainer>
        {!isMobile && (
          <RoomDesignerWorkspace
            visible
            placed={placed}
            rooms={rooms}
            activeRoom={activeRoom}
            onActiveRoomChange={setActiveRoom}
            onPlace={handlePlaceFurniture}
            onRemove={handleRemoveFurniture}
            onMove={handleMoveFurniture}
            onImportRooms={handleImportRooms}
            onAutoPopulate={handleAutoPopulate}
            ownership={ownership}
            drawerOpen={drawerOpen}
            onToggleDrawer={() => setDrawerOpen((v) => !v)}
            isRoomUnlocked={isRoomUnlocked}
            allFurniture={allFurniture}
            idols={idolItems}
            foodBox={foodBoxItem && (ownership[foodBoxItem.id] || 0) > 0 ? foodBoxItem : null}
            fillProgress={fillProgress}
            fillReport={fillReport}
            fillSearch={fillSearch}
            onStopSearch={stopSearch}
            onEmptyRooms={(idxs) => updateRooms((prev) => prev.map((room, i) => (idxs.includes(i) ? [] : room)))}
            onUndo={canUndo ? undo : undefined}
            onRedo={canRedo ? redo : undefined}
          />
        )}
        <div
          style={{
            ...layoutStyles.browserWrapper,
            width: isMobile ? '100%' : drawerOpen ? 'min(460px, 42%)' : '0%',
            ...(!drawerOpen && !isMobile ? { overflow: 'hidden', opacity: 0, pointerEvents: 'none' as const } : {}),
            ...(isMobile ? { height: 'auto', overflow: 'visible', transition: 'none', position: 'static' as const } : {}),
          }}
        >
          <FurnitureBrowser
            items={pagedItems}
            totalItems={filteredAndSorted.length}
            ownership={ownership}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            sort={sort}
            onSortChange={handleSortChange}
            onIncrement={handleIncrement}
            onDecrement={handleDecrement}
            expanded={!isMobile}
            onToggle={() => setDrawerOpen((prev) => !prev)}
            page={clampedPage}
            totalPages={totalPages}
            onPageChange={setPage}
            onImportClick={openImportModal}
            isMobile={isMobile}
            statsPerSpace={statsPerSpace}
            onStatsPerSpaceChange={setStatsPerSpace}
            usedCounts={usedCounts}
          />
        </div>
        {!isMobile && !drawerOpen && (
          <button
            onClick={() => setDrawerOpen(true)}
            title="Show furniture list"
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 20,
              height: 60,
              borderRadius: '8px 0 0 8px',
              border: '1px solid var(--border)',
              borderRight: 'none',
              background: 'var(--code-bg)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
              zIndex: 20,
            }}
          >
            ◂
          </button>
        )}
      </SplitScreenContainer>
      </div>
      )}
      <SaveImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportOwnership}
        furnitureIdMap={furnitureIdMap}
        onHandleCaptured={handleSavefileHandleCaptured}
      />
    </div>
  );
}

export default App;
