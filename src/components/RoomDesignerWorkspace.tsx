import { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import RoomGrid from './RoomGrid';
import RoomStatsSummary from './RoomStatsSummary';
import { getRoomLabel, HOUSE_VIEW, ATTIC_INDEX } from '../types/furniture';
import { captureRoom, captureHouse } from '../utils/roomCapture';
import { ALL_STATS, STAT_LABELS } from '../utils/autoPopulate';
import type { AlgorithmKey, StatWeights, RoomFillPlan } from '../utils/autoPopulate';
import type { V2Settings } from '../utils/autoPopulateV2';
import { DEFAULT_V2_SETTINGS } from '../utils/autoPopulateV2';
import type { StatKey } from '../types/furniture';
import StatIcon from './StatIcon';
import RoomChecklist from './RoomChecklist';
import { STAT_COLORS } from '../utils/statColors';
import HouseView from './HouseView';

const LEGEND: { type: number; color: string; border: string; label: string }[] = [
  { type: 2, color: 'var(--lavender-grey)', border: 'rgba(132,143,165,0.5)', label: 'Solid' },
  { type: 3, color: 'var(--blushed-brick)', border: 'rgba(193,73,83,0.5)', label: 'Anchor Point' },
  { type: 4, color: 'var(--sand-dune)', border: 'rgba(229,220,197,0.5)', label: 'Anchor' },
  { type: 5, color: 'var(--charcoal)', border: 'rgba(76,76,71,0.5)', label: 'Background' },
];

type FillPresetKey = 'breeding' | 'ultrabreeding' | 'sterilebreed' | 'sterile' | 'storage' | 'mutation' | 'fightclub' | 'appeal' | 'random';

const EMPTY_WEIGHTS: Record<StatKey, -2 | -1 | 0 | 1> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };

const V2_PRESETS: Record<string, Partial<V2Settings>> = {
  fast: {},  // pure DEFAULT_V2_SETTINGS
  medium: { defaultMaximizeIterations: 25 },
  long: { defaultMaximizeIterations: 100 },
  extraLong: { defaultMaximizeIterations: 500 },
};

const WORKSPACE_STORAGE_KEY = 'clawset-designer-workspace';

interface WorkspacePersistedState {
  expertView: boolean;
  presetKey: FillPresetKey | 'blank';
  roomPresets: Record<number, FillPresetKey | 'custom' | 'skip'>;
  roomWeights: Record<number, Record<StatKey, -2 | -1 | 0 | 1>>;
  roomIdols: Record<number, string[]>;
  roomFood: Record<number, 0 | 1 | -1>;
  priorityOrder: number[];
  statWeights: Record<StatKey, -2 | -1 | 0 | 1>;
  foodTolerance?: 'auto' | 'maximize' | 'minimize';
  searchMode?: 'fast' | 'medium' | 'long' | 'extraLong';
  selectedIdols: string[];
  excludedIdols: string[];
  roomExcluded: Record<number, string[]>;
  useV2?: boolean;
  v2Settings?: V2Settings;
}

function loadWorkspaceState(): Partial<WorkspacePersistedState> {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<WorkspacePersistedState>;
  } catch { return {}; }
}

function saveWorkspaceState(state: WorkspacePersistedState): void {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
}

const FILL_PRESETS: Record<FillPresetKey, {
  label: string;
  description: string;
  tristate: Partial<Record<StatKey, -2 | -1 | 0 | 1>>;
  minStats?: Partial<Record<StatKey, number>>;
  autoIdolKeys?: string[];
  /** Idol image_url keys to exclude from placements in rooms using this preset. */
  excludeIdolKeys?: string[];
  /** Breeding presets default to no food boxes (cats don't eat). */
  noFood?: true;
}> = {
  breeding: {
    label: 'Breeding',
    description: 'Maximizes stimulation; keeps comfort 4+ for four breeding cats. Auto-includes the Stimulation Idol; excludes the Suppressor (Chastity), Evolution, and Fight Idols.',
    tristate: { stimulation: 1 },
    minStats: { comfort: 4 },
    autoIdolKeys: ['stimulationidol'],
    excludeIdolKeys: ['suppressoridol', 'evolutionidol', 'fightidol'],
    noFood: true,
  },
  ultrabreeding: {
    label: 'Ultrabreeding',
    description: 'Lowers the comfort floor to 2 (frees space vs Breeding); maximizes stimulation, keeps health ≥1, and completely bans mutation items. Auto-includes the Stimulation Idol; excludes Suppressor, Evolution, Fight, and Health Idols.',
    tristate: { stimulation: 1, mutation: -2 },
    minStats: { comfort: 2, health: 1 },
    autoIdolKeys: ['stimulationidol'],
    excludeIdolKeys: ['suppressoridol', 'evolutionidol', 'fightidol', 'healthidol'],
    noFood: true,
  },
  sterilebreed: {
    label: 'Sterile Breeding',
    description: 'Maximizes stimulation for strong offspring while completely banning all mutation items to prevent sterility. Keeps comfort ≥4. Auto-includes the Stimulation Idol; excludes the Evolution (mutation), Suppressor (Chastity), and Fight Idols.',
    tristate: { stimulation: 1, mutation: -2 },
    minStats: { comfort: 4 },
    autoIdolKeys: ['stimulationidol'],
    excludeIdolKeys: ['evolutionidol', 'suppressoridol', 'fightidol'],
    noFood: true,
  },
  storage: {
    label: 'Storage',
    description: 'Maximizes health and comfort. Auto-includes the Suppressor (Chastity) and Health Idols; excludes the Fight Idol.',
    tristate: { health: 1, comfort: 1,  stimulation: -1 },
    autoIdolKeys: ['suppressoridol', 'healthidol'],
    excludeIdolKeys: ['fightidol'],
  },
  sterile: {
    label: 'Sterile Storage',
    description: 'Maximizes health and comfort with zero mutation tolerance — any mutation item is completely banned, never placed. Auto-includes Suppressor and Health Idols; excludes Fight and Evolution Idols.',
    tristate: { health: 1, comfort: 1, mutation: -2,  stimulation: -1 },
    autoIdolKeys: ['suppressoridol', 'healthidol'],
    excludeIdolKeys: ['fightidol', 'evolutionidol'],
  },
  mutation: {
    label: 'Mutation',
    description: 'Maximizes mutation; keeps comfort 4+ for cats. Minimizes stimulation. Auto-includes the Evolution Idol; excludes Stimulation and Fight Idols.',
    tristate: { mutation: 1, stimulation: -1 },
    minStats: { comfort: 8 },
    autoIdolKeys: ['evolutionidol'],
    excludeIdolKeys: ['stimulationidol', 'fightidol'],
  },
  fightclub: {
    label: 'Fight Club',
    description: 'Bans all comfort — only zero-comfort items allowed. Auto-includes the Chaos Idol (deadlier fights, double rewards); excludes Comfort and Suppressor (Chastity) Idols.',
    tristate: { comfort: -2, stimulation: -1 },
    autoIdolKeys: ['fightidol'],
    excludeIdolKeys: ['comfortidol', 'suppressoridol'],
  },
  appeal: {
    label: 'Appeal',
    description: 'Maximizes appeal for stronger base-stat inheritance. Auto-includes the Appeal Idol; no idol exclusions.',
    tristate: { appeal: 1,  stimulation: -2 },
    autoIdolKeys: ['appealidol'],
  },
  random: {
    label: 'Random',
    description: 'No stat preference — fills every gap as densely as possible with any owned furniture, largest pieces first.',
    tristate: {},
  },
};

interface RoomExportEntry {
  id: string;
  row: number;
  col: number;
}

interface Props {
  visible: boolean;
  placed: PlacedFurniture[];
  rooms: PlacedFurniture[][];
  activeRoom: number;
  onActiveRoomChange: (i: number) => void;
  onPlace: (item: FurnitureItem, row: number, col: number) => void;
  onRemove: (instanceId: string) => void;
  onMove: (instanceId: string, row: number, col: number) => void;
  onImportRooms: (entries: RoomExportEntry[][]) => void;
  onAutoPopulate: (config: {
    algorithm: AlgorithmKey;
    plans: RoomFillPlan[];
    searchMode?: 'fast' | 'medium' | 'long' | 'extraLong';
    /** Item ID → house-wide total cap (e.g. food box limit). */
    itemCaps?: Record<string, number>;
    /** V2 tunable settings; ignored by v1. */
    v2Settings?: V2Settings;
  }) => void;
  ownership: Record<string, number>;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  isRoomUnlocked: (i: number) => boolean;
  /** All furniture catalog — used for theoretical max stat calculations. */
  allFurniture: FurnitureItem[];
  /** All special idols; unowned ones render disabled. */
  idols: FurnitureItem[];
  /** Owned food box item (null when none owned). */
  foodBox: FurnitureItem | null;
  /** 0..1 while an auto-fill search runs, null when idle. */
  fillProgress?: number | null;
  /** Quality summary of the last auto-fill. */
  fillReport?: string | null;
  /** Live state while a "keep searching" run is in flight; null when idle. */
  fillSearch?: { passes: number; bestScore: number } | null;
  /** Stop the keep-searching run and apply the best result so far. */
  onStopSearch?: () => void;
  /** Undo/redo for room mutations; undefined = nothing to un/redo. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** Clear all furniture from the given rooms (undoable). */
  onEmptyRooms: (roomIndexes: number[]) => void;
}

export default function RoomDesignerWorkspace({
  visible, placed, rooms, activeRoom, onActiveRoomChange,
  onPlace, onRemove, onMove, onImportRooms, onAutoPopulate, ownership,
  drawerOpen, onToggleDrawer, isRoomUnlocked, allFurniture, idols, foodBox, fillProgress = null, fillReport = null,
  fillSearch = null, onStopSearch, onUndo, onRedo, onEmptyRooms,
}: Props) {
  const persisted = useMemo(() => loadWorkspaceState(), []);

  const [expertView, setExpertView] = useState(() => persisted.expertView ?? false);
  // single-room fill: a preset acts as an editable starting point. 'blank' =
  // start from zero. `presetModified` flags hand-edited stats so the label can
  // show "(modified)" while the preset's floor/idol still apply.
  const [presetKey, setPresetKey] = useState<FillPresetKey | 'blank'>(() => persisted.presetKey ?? 'breeding');
  const [presetModified, setPresetModified] = useState(false);
  // house fill: independent preset per room
  const [roomPresets, setRoomPresets] = useState<Record<number, FillPresetKey | 'custom' | 'skip'>>(() => persisted.roomPresets ?? {});
  // per-room stat weights for rooms set to 'custom' in the house fill
  const [roomWeights, setRoomWeights] = useState<Record<number, Record<StatKey, -2 | -1 | 0 | 1>>>(() => persisted.roomWeights ?? {});
  // per-room idol picks for the house fill (in addition to a preset's auto-idol)
  const [roomIdols, setRoomIdols] = useState<Record<number, Set<string>>>(() => {
    const raw = persisted.roomIdols;
    if (!raw) return {};
    const out: Record<number, Set<string>> = {};
    for (const [k, v] of Object.entries(raw)) out[Number(k)] = new Set(v);
    return out;
  });
  // per-room "include a food box" toggle for the house fill
  const [roomFood, setRoomFood] = useState<Record<number, 0 | 1 | -1>>(() => persisted.roomFood ?? {});
  // house fill room priority order (first = gets first pick of shared items)
  const [priorityOrder, setPriorityOrder] = useState<number[]>(() => persisted.priorityOrder ?? [ATTIC_INDEX, 0, 1, 2, 3]);
  const [statWeights, setStatWeights] = useState<Record<StatKey, -2 | -1 | 0 | 1>>(
    () => persisted.statWeights ?? ({ ...EMPTY_WEIGHTS, ...FILL_PRESETS.breeding.tristate } as Record<StatKey, -2 | -1 | 0 | 1>),
  );
  const [foodTolerance, setFoodTolerance] = useState<'auto' | 'maximize' | 'minimize'>(() => {
    const saved = (persisted as Record<string, unknown>).foodTolerance;
    if (saved === 'auto' || saved === 'maximize' || saved === 'minimize') return saved;
    // Migration: old includeFood 0→auto, 1→maximize, −1→minimize
    const old = (persisted as Record<string, unknown>).includeFood;
    if (old === 0) return 'auto';
    if (old === 1) return 'maximize';
    if (old === -1) return 'minimize';
    return 'auto';
  });
  const [useV2, setUseV2] = useState(() => persisted.useV2 ?? false);
  const [v2Settings, setV2Settings] = useState<V2Settings>(() => persisted.v2Settings ?? { ...DEFAULT_V2_SETTINGS });
  const [v2PresetKey, setV2PresetKey] = useState<'fast' | 'medium' | 'long' | 'extraLong' | 'custom'>('fast');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Search is always the randomized "maximize" — fast enough that the old
  // Quick/Maximize choice wasn't worth a widget.
  const algorithm: AlgorithmKey = useV2 ? 'maximize-v2' : 'maximize';
  const [searchMode, setSearchMode] = useState<'fast' | 'medium' | 'long' | 'extraLong'>(() => {
    if (persisted.searchMode) {
      const oldToNew: Record<string, 'fast' | 'medium' | 'long' | 'extraLong'> = { optimal: 'fast', standard: 'medium', extreme: 'extraLong' };
      return oldToNew[persisted.searchMode] ?? persisted.searchMode as 'fast' | 'medium' | 'long' | 'extraLong';
    }
    // Migration: if old keepSearching was enabled → 'long', else → 'fast' (one-shot)
    if ((persisted as Record<string, unknown>).keepSearchingEnabled) return 'long';
    return 'fast';
  });
  // house two-pane: which room the detail drawer is editing (null = first)
  const [detailRoom, setDetailRoom] = useState<number | null>(null);
  const [selectedIdols, setSelectedIdols] = useState<Set<string>>(() => {
    const raw = persisted.selectedIdols;
    return raw ? new Set(raw) : new Set<string>();
  });
  const [excludedIdols, setExcludedIdols] = useState<Set<string>>(() => {
    const raw = persisted.excludedIdols;
    return raw ? new Set(raw) : new Set<string>();
  });
  const [roomExcluded, setRoomExcluded] = useState<Record<number, Set<string>>>(() => {
    const raw = persisted.roomExcluded;
    if (!raw) return {};
    const out: Record<number, Set<string>> = {};
    for (const [k, v] of Object.entries(raw)) out[Number(k)] = new Set(v);
    return out;
  });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [connectorLines, setConnectorLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkRootRef = useRef<HTMLDivElement>(null);
  const prevActiveRoomRef = useRef<number>(activeRoom);

  // Persist workspace inputs to localStorage on every change.
  useEffect(() => {
    saveWorkspaceState({
      expertView,
      presetKey,
      roomPresets,
      roomWeights,
      roomIdols: Object.fromEntries(Object.entries(roomIdols).map(([k, v]) => [k, [...v]])),
      roomFood,
      priorityOrder,
      statWeights,
      foodTolerance,
      searchMode,
      selectedIdols: [...selectedIdols],
      excludedIdols: [...excludedIdols],
      roomExcluded: Object.fromEntries(Object.entries(roomExcluded).map(([k, v]) => [k, [...v]])),
      useV2,
      v2Settings,
    });
  }, [
    expertView, presetKey, roomPresets, roomWeights, roomIdols, roomFood,
    priorityOrder, statWeights, foodTolerance, searchMode, selectedIdols, excludedIdols, roomExcluded, useV2, v2Settings,
  ]);

  const handleHoverItem = (id: string | null) => {
    setHoverItem(id);
  };

  // Load a preset as an editable starting point: its stats fill the chips and
  // its floor/idol travel with it (kept even after the user edits the stats).
  // Also saves the preset choice to the current room's personal template.
  const applyPreset = (key: FillPresetKey) => {
    const preset = FILL_PRESETS[key];
    setPresetKey(key);
    setPresetModified(false);
    setStatWeights({ ...EMPTY_WEIGHTS, ...preset.tristate });
    const autoIds = preset.autoIdolKeys
      ?.map((k) => idols.find((i) => i.image_url.includes(k) && (ownership[i.id] || 0) > 0))
      .filter((i): i is FurnitureItem => !!i)
      .map((i) => i.id) ?? [];
    setSelectedIdols(new Set(autoIds));
    const excludeIds = preset.excludeIdolKeys
      ?.map((k) => idols.find((i) => i.image_url.includes(k) && (ownership[i.id] || 0) > 0))
      .filter((i): i is FurnitureItem => !!i)
      .map((i) => i.id) ?? [];
    setExcludedIdols(new Set(excludeIds));
    if (activeRoom !== HOUSE_VIEW) {
      setRoomPresets((prev) => ({ ...prev, [activeRoom]: key }));
    }
  };

  // Start from zero: no stats, no floor.
  const selectBlank = () => {
    setPresetKey('blank');
    setPresetModified(false);
    setStatWeights({ ...EMPTY_WEIGHTS });
  };

  // Sync the editor preset with the room's saved template on room switch.
  if (prevActiveRoomRef.current !== activeRoom && activeRoom !== HOUSE_VIEW) {
    prevActiveRoomRef.current = activeRoom;
    const rp = roomPresets[activeRoom];
    if (rp === 'skip') {
      selectBlank();
    } else if (rp && rp !== 'custom') {
      applyPreset(rp);
    } else if (rp === 'custom') {
      setPresetKey('blank');
      setPresetModified(true);
      setStatWeights({ ...(roomWeights[activeRoom] ?? EMPTY_WEIGHTS) });
      setSelectedIdols(new Set(roomIdols[activeRoom]));
    }
  }

  // Thin connector lines from the hovered checklist row to every matching placed piece
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = linkRootRef.current;
      if (!hoverItem || !checklistOpen || !root) {
        setConnectorLines([]);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const row = root.querySelector(`[data-check-id="${CSS.escape(hoverItem)}"]`);
      const pieces = root.querySelectorAll(`[data-piece-id="${CSS.escape(hoverItem)}"]`);
      if (!row || pieces.length === 0) {
        setConnectorLines([]);
        return;
      }
      const rowRect = row.getBoundingClientRect();
      const x1 = rowRect.left - rootRect.left;
      const y1 = rowRect.top + rowRect.height / 2 - rootRect.top;
      const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
      pieces.forEach((el) => {
        const r = el.getBoundingClientRect();
        lines.push({
          x1,
          y1,
          x2: r.left + r.width / 2 - rootRect.left,
          y2: r.top + r.height / 2 - rootRect.top,
        });
      });
      setConnectorLines(lines);
    });
    return () => cancelAnimationFrame(id);
  }, [hoverItem, checklistOpen, placed]);

  // Legend numbers: alphabetical unique items of the active room (matches checklist order)
  const labelNumbers = useMemo(() => {
    const ids = [...new Map(placed.map((p) => [p.item.id, p.item.name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id]) => id);
    const map: Record<string, number> = {};
    ids.forEach((id, i) => { map[id] = i + 1; });
    return map;
  }, [placed]);

  // Editing a stat keeps the active preset's floor/idol but marks it modified.
  const cycleStat = (stat: StatKey) => {
    if (presetKey !== 'blank') setPresetModified(true);
    setStatWeights((prev) => ({
      ...prev,
      [stat]: prev[stat] === 0 ? 1 : prev[stat] === 1 ? -1 : prev[stat] === -1 ? -2 : 0,
    }));
  };

  // Three-state idol toggle: neutral → place (selected) → ignore (excluded) → neutral
  const toggleIdol = (id: string) => {
    setPresetModified(true);
    setSelectedIdols((prevSel) => {
      if (prevSel.has(id)) {
        // was place → move to ignore
        setExcludedIdols((prevEx) => new Set(prevEx).add(id));
        const next = new Set(prevSel);
        next.delete(id);
        return next;
      }
      setExcludedIdols((prevEx) => {
        if (prevEx.has(id)) {
          // was ignore → back to neutral
          const next = new Set(prevEx);
          next.delete(id);
          return next;
        }
        return prevEx;
      });
      return prevSel.has(id) ? prevSel : new Set(prevSel).add(id);
    });
  };

  const toggleFood = () => {
    setPresetModified(true);
    setFoodTolerance((prev) => prev === 'auto' ? 'maximize' : prev === 'maximize' ? 'minimize' : 'auto');
  };

  const activeWeights: StatWeights = Object.fromEntries(
    ALL_STATS.filter((st) => statWeights[st] !== 0).map((st) => [st, statWeights[st]]),
  );
  const minStats = presetKey !== 'blank' ? FILL_PRESETS[presetKey].minStats : undefined;
  const hasPositiveWeight = ALL_STATS.some((st) => statWeights[st] > 0);

  // Owned idols only — what the per-room and single-room idol pickers can offer.
  const ownedIdols = idols.filter((i) => (ownership[i.id] || 0) > 0);
  // A house room's idol selection: the user's pick if set, else the preset's
  // auto-idol pre-selected (so presets "just work" but stay overridable).
  const roomIdolsFor = (ri: number): Set<string> => {
    if (roomIdols[ri]) return roomIdols[ri];
    const choice = roomChoice(ri);
    if (choice !== 'custom' && choice !== 'skip') {
      const keys = FILL_PRESETS[choice].autoIdolKeys;
      if (keys) {
        const autoIds = ownedIdols
          .filter((i) => keys.some((k) => i.image_url.includes(k)))
          .map((i) => i.id);
        if (autoIds.length > 0) return new Set(autoIds);
      }
    }
    return new Set();
  };
  const toggleRoomIdol = (ri: number, id: string) => {
    const currentPlaced = roomIdols[ri] ?? roomIdolsFor(ri);
    const currentExcluded = roomExcluded[ri] ?? roomExcludedFor(ri);

    if (currentPlaced.has(id)) {
      // place → ignore
      const nextPlaced = new Set(currentPlaced);
      nextPlaced.delete(id);
      setRoomIdols((prev) => ({ ...prev, [ri]: nextPlaced }));
      const nextExcluded = new Set(currentExcluded);
      nextExcluded.add(id);
      setRoomExcluded((prev) => ({ ...prev, [ri]: nextExcluded }));
    } else if (currentExcluded.has(id)) {
      // ignore → neutral: clear override so room falls back to preset
      const nextExcluded = new Set(currentExcluded);
      nextExcluded.delete(id);
      setRoomExcluded((prev) => {
        const r = { ...prev };
        if (nextExcluded.size > 0) r[ri] = nextExcluded;
        else delete r[ri];
        return r;
      });
    } else {
      // neutral → place
      const nextPlaced = new Set(currentPlaced);
      nextPlaced.add(id);
      setRoomIdols((prev) => ({ ...prev, [ri]: nextPlaced }));
    }
  };

  // A house room's excluded idols: user override, else preset's excludeIdolKeys
  const roomExcludedFor = (ri: number): Set<string> => {
    if (roomExcluded[ri]) return roomExcluded[ri];
    const choice = roomChoice(ri);
    if (choice !== 'custom' && choice !== 'skip') {
      const keys = FILL_PRESETS[choice].excludeIdolKeys;
      if (keys) {
        const excludedIds = ownedIdols
          .filter((i) => keys.some((k) => i.image_url.includes(k)))
          .map((i) => i.id);
        if (excludedIds.length > 0) return new Set(excludedIds);
      }
    }
    return new Set();
  };

  const unlockedRooms = ([ATTIC_INDEX, 0, 1, 2, 3] as number[]).filter(isRoomUnlocked);
  // default to one of each preset, remaining rooms start as custom
  const PRESET_CYCLE: FillPresetKey[] = ['breeding', 'storage', 'fightclub', 'mutation', 'appeal', 'random'];
  const roomChoice = (ri: number): FillPresetKey | 'custom' | 'skip' => {
    if (roomPresets[ri]) return roomPresets[ri];
    const idx = Math.max(0, unlockedRooms.indexOf(ri));
    return idx < PRESET_CYCLE.length ? PRESET_CYCLE[idx] : 'custom';
  };
  const roomWeightsFor = (ri: number): Record<StatKey, -2 | -1 | 0 | 1> =>
    roomWeights[ri] ?? EMPTY_WEIGHTS;
  const cycleRoomStat = (ri: number, stat: StatKey) => {
    setRoomWeights((prev) => {
      const cur = prev[ri] ?? EMPTY_WEIGHTS;
      return { ...prev, [ri]: { ...cur, [stat]: cur[stat] === 0 ? 1 : cur[stat] === 1 ? -1 : cur[stat] === -1 ? -2 : 0 } };
    });
  };
  // The house two-pane always shows a drawer; fall back to the first room when
  // nothing is explicitly selected (or the selection is no longer unlocked).
  const drawerRoom = detailRoom != null && unlockedRooms.includes(detailRoom)
    ? detailRoom
    : (unlockedRooms[0] ?? 0);

  // custom rooms need at least one maximized stat; presets always have one
  const fillReady = activeRoom === HOUSE_VIEW
    ? unlockedRooms.some((ri) => roomChoice(ri) !== 'skip')
      && unlockedRooms.every((ri) => roomChoice(ri) !== 'custom' || ALL_STATS.some((st) => roomWeightsFor(ri)[st] > 0))
    : hasPositiveWeight;

  // Resolve preset excludeIdolKeys to actual item IDs by matching image_url.
  const resolveExcludedIds = (excludeIdolKeys: string[] | undefined): string[] => {
    if (!excludeIdolKeys) return [];
    return excludeIdolKeys
      .map((key) => idols.find((i) => i.image_url.includes(key)))
      .filter((i): i is FurnitureItem => i !== undefined)
      .map((i) => i.id);
  };

  const buildHousePlans = (): RoomFillPlan[] => {
    const plans: RoomFillPlan[] = [];
    const orderedRooms = [...unlockedRooms].sort((a, b) => {
      const ia = priorityOrder.indexOf(a);
      const ib = priorityOrder.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    let foodSlotsUsed = 0;
    for (const ri of orderedRooms) {
      const choice = roomChoice(ri);
      if (choice === 'skip') continue;
      const presetNoFood = choice !== 'custom' && FILL_PRESETS[choice].noFood && roomFood[ri] !== 1;
      const wantsFood = foodTolerance === 'maximize'
        ? !!foodBox && !presetNoFood
        : foodTolerance === 'minimize'
        ? false
        : roomFood[ri] === 1 && foodBox && !presetNoFood;
      const canHaveFood = wantsFood;
      if (wantsFood && canHaveFood) foodSlotsUsed++;
      const mustInclude = [
        ...roomIdolsFor(ri),
        ...(canHaveFood ? [foodBox!.id] : []),
      ];
      const excludeFood = ((roomFood[ri] === -1 || presetNoFood || foodTolerance === 'minimize') && foodBox) ? [foodBox.id] : [];
      if (choice === 'custom') {
        const w = roomWeightsFor(ri);
        const weights: StatWeights = Object.fromEntries(
          ALL_STATS.filter((st) => w[st] !== 0).map((st) => [st, w[st]]),
        );
        const excluded = [...roomExcludedFor(ri), ...excludeFood];
        plans.push({ roomIndex: ri, weights, mustInclude, ...(excluded.length > 0 ? { excludeItemIds: excluded } : {}) });
        continue;
      }
      const preset = FILL_PRESETS[choice];
      const presetExcluded = resolveExcludedIds(preset.excludeIdolKeys);
      const roomExcluded = [...roomExcludedFor(ri)];
      const excludeItemIds = [...new Set([...presetExcluded, ...roomExcluded, ...excludeFood])];
      plans.push({
        roomIndex: ri,
        weights: Object.fromEntries(Object.entries(preset.tristate)) as StatWeights,
        mustInclude,
        minStats: preset.minStats,
        excludeItemIds,
      });
    }
    return plans;
  };

  const handleEmptyRooms = () => {
    const targets = activeRoom === HOUSE_VIEW ? unlockedRooms : [activeRoom];
    const count = targets.reduce((sum, ri) => sum + rooms[ri].length, 0);
    if (count === 0) return;
    if (!window.confirm(`Remove ${count} item(s) from ${activeRoom === HOUSE_VIEW ? 'all unlocked rooms' : getRoomLabel(activeRoom)}?`)) return;
    onEmptyRooms(targets);
  };

  const handleAutoFill = () => {
    const itemCaps = undefined;
    if (activeRoom === HOUSE_VIEW) {
      const plans = buildHousePlans();
      const replacing = plans.reduce((s, p) => s + rooms[p.roomIndex].length, 0);
      if (
        replacing > 0 &&
        !window.confirm(`Replace ${replacing} item(s) across ${plans.length} room(s) with auto-generated layouts?`)
      ) {
        return;
      }
      onAutoPopulate({ algorithm, plans, searchMode, itemCaps, v2Settings });
      return;
    }
    const statText = ALL_STATS.filter((st) => statWeights[st] !== 0)
      .map((st) => `${statWeights[st] > 0 ? '+' : '\u2212'}${STAT_LABELS[st]}`)
      .join(' ');
    const label = presetKey !== 'blank'
      ? `${FILL_PRESETS[presetKey].label}${presetModified ? ' (modified)' : ''}`
      : statText;
    if (
      placed.length > 0 &&
      !window.confirm(`Replace ${placed.length} item(s) in ${getRoomLabel(activeRoom)} with an auto-generated "${label}" layout?`)
    ) {
      return;
    }
    const presetNoFood = presetKey !== 'blank' && FILL_PRESETS[presetKey].noFood && foodTolerance !== 'maximize';
    const mustInclude = [
      ...idols.filter((i) => selectedIdols.has(i.id)).map((i) => i.id),
      ...(foodTolerance === 'maximize' && foodBox && !presetNoFood ? [foodBox.id] : []),
    ];
    const presetExcluded = presetKey !== 'blank' ? resolveExcludedIds(FILL_PRESETS[presetKey].excludeIdolKeys) : [];
    const userExcluded = idols.filter((i) => excludedIdols.has(i.id)).map((i) => i.id);
    const foodExcluded = ((foodTolerance === 'minimize' || presetNoFood) && foodBox) ? [foodBox.id] : [];
    const excludeItemIds = [...new Set([...presetExcluded, ...userExcluded, ...foodExcluded])];
    onAutoPopulate({
      algorithm,
      plans: [{ roomIndex: activeRoom, weights: activeWeights, mustInclude, minStats, excludeItemIds }],
      searchMode,
      itemCaps,
      v2Settings,
    });
  };

  const renderStatChips = (weights: Record<StatKey, -2 | -1 | 0 | 1>, onCycle: (stat: StatKey) => void) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-m)' }} title="Click a stat to cycle: maximize → avoid → ban → off">Stats:</span>
      {ALL_STATS.map((stat) => {
        const w = weights[stat];
        const banned = w === -2;
        return (
        <button
          key={stat}
          onClick={() => onCycle(stat)}
          title={`${STAT_LABELS[stat]} — click to cycle: maximize → avoid → ban → off`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 9px',
            borderRadius: 14,
            fontFamily: 'var(--font)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            border: `1px solid ${w === 1 ? STAT_COLORS[stat] : banned ? '#c62828' : w === -1 ? 'var(--charcoal)' : 'var(--border)'}`,
            background: w === 1 ? STAT_COLORS[stat] : banned ? 'rgba(198,40,40,0.15)' : w === -1 ? 'var(--charcoal)' : 'var(--bg)',
            color: w === 1 || w === -1 ? '#fff' : banned ? '#c62828' : 'var(--text-m)',
          }}
        >
          <StatIcon stat={stat} size={15} />
          {STAT_LABELS[stat]}
          {w === 1 ? ' +' : banned ? ' ✕' : w === -1 ? ' −' : ''}
        </button>
        );
      })}
    </div>
  );
  const statChips = renderStatChips(statWeights, cycleStat);

  // A house room's effective tristate weights (preset's, or the custom ones).
  const roomEffectiveWeights = (ri: number): Record<StatKey, -2 | -1 | 0 | 1> => {
    const choice = roomChoice(ri);
    if (choice === 'custom') return roomWeightsFor(ri);
    if (choice === 'skip') return EMPTY_WEIGHTS;
    return { ...EMPTY_WEIGHTS, ...FILL_PRESETS[choice].tristate };
  };

  // Read-only stat summary for the house room list. Each token is icon-only;
  // hovering floats the full stat name as an overlay (see .af-tok in index.css)
  // so the inline footprint never changes and sibling icons stay put.
  const SUMMARY_ICON = 15;
  const renderWeightSummary = (weights: Record<StatKey, -2 | -1 | 0 | 1>, minStats?: Partial<Record<StatKey, number>>) => {
    const active = ALL_STATS.filter((st) => weights[st] !== 0);
    if (active.length === 0 && !minStats) {
      return <span style={{ fontSize: 12, color: 'var(--blushed-brick)' }}>set stats ▾</span>;
    }
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {active.map((st) => {
          const max = weights[st] === 1;
          const banned = weights[st] === -2;
          return (
            <span key={st} className="af-tok" style={{ color: max ? STAT_COLORS[st] : banned ? '#c62828' : 'var(--lavender-grey)' }}>
              <StatIcon stat={st} size={SUMMARY_ICON} />
              <span style={{ marginLeft: 1 }}>{max ? '+' : banned ? '✕' : '−'}</span>
              <span className="af-name">{STAT_LABELS[st]}{max ? ' +' : banned ? ' ✕' : ' −'}</span>
            </span>
          );
        })}
        {minStats && (Object.entries(minStats) as [StatKey, number][]).map(([st, n]) => (
          <span key={st} className="af-tok" style={{ color: 'var(--text-m)', fontWeight: 600 }}>
            <StatIcon stat={st} size={SUMMARY_ICON} />
            <span style={{ marginLeft: 1 }}>≥{n}</span>
            <span className="af-name">{STAT_LABELS[st]} ≥{n}</span>
          </span>
        ))}
      </span>
    );
  };

  const IDOL_NOTES: Record<string, string> = {
    suppressoridol: 'Cats will NOT breed in this room',
    fightidol: 'Fights are deadlier; winner gets double stat rewards',
  };
  const idolNote = (item: FurnitureItem): string => {
    const key = Object.keys(IDOL_NOTES).find((k) => item.image_url.includes(k));
    if (key) return IDOL_NOTES[key];
    const stats = ALL_STATS
      .filter((st) => item[st] !== 0)
      .map((st) => `${item[st] > 0 ? '+' : ''}${item[st]} ${STAT_LABELS[st]}`)
      .join(', ');
    return stats ? `Stat idol (${stats})` : 'Stat idol';
  };

  // Right-pane editor for the selected house room (two-pane master-detail).
  const renderRoomDrawer = (ri: number) => {
    const choice = roomChoice(ri);
    const presetName = choice === 'custom' ? 'Custom' : choice === 'skip' ? 'Skip' : FILL_PRESETS[choice].label;
    const title = (
      <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {getRoomLabel(ri)} · {presetName}
      </div>
    );
    if (choice === 'skip') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {title}
          <div className="af-skip-note">
            <div className="af-skip-head">Skipped — nothing to configure</div>
            <p>This room is left out of the house fill. Its current layout stays <b>exactly as it is</b>, so stats, idols and food don’t apply here.</p>
            <p style={{ color: 'var(--text-m)' }}>Pick a preset (or <b>Custom</b>) in the dropdown to set this room up.</p>
          </div>
        </div>
      );
    }
    const hasExtras = !!foodBox || ownedIdols.length > 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {title}
        {choice === 'custom'
          ? renderStatChips(roomWeightsFor(ri), (stat) => cycleRoomStat(ri, stat))
          : <div style={{ fontSize: 11, color: 'var(--text-m)' }}>{FILL_PRESETS[choice].description}</div>}
        {hasExtras && <div style={{ height: 1, background: 'var(--border)' }} />}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {foodBox && (() => {
            const state = roomFood[ri] ?? 0;
            let btnStyle: CSSProperties;
            if (state === 1) {
              btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(46,125,50,0.12)', color: '#2e7d32', border: '1px solid rgba(46,125,50,0.35)' };
            } else if (state === -1) {
              btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(198,40,40,0.1)', color: '#c62828', border: '1px solid rgba(198,40,40,0.3)' };
            } else {
              btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px' };
            }
            return (
              <button key="food" onClick={() => setRoomFood((prev) => {
                const cur = prev[ri] ?? 0;
                const next: 0 | 1 | -1 = cur === 0 ? 1 : cur === 1 ? -1 : 0;
                return { ...prev, [ri]: next };
              })} title="Force food box, exclude it, or neutral" style={btnStyle}>
                Food Box
              </button>
            );
          })()}
          {ownedIdols.map((idol) => {
                const placed = roomIdolsFor(ri).has(idol.id);
                const ignored = roomExcludedFor(ri).has(idol.id);
                let btnStyle: CSSProperties;
                if (placed) {
                  btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(46,125,50,0.12)', color: '#2e7d32', border: '1px solid rgba(46,125,50,0.35)' };
                } else if (ignored) {
                  btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(198,40,40,0.1)', color: '#c62828', border: '1px solid rgba(198,40,40,0.3)' };
                } else {
                  btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px' };
                }
                return (
                  <button
                    key={idol.id}
                    onClick={() => toggleRoomIdol(ri, idol.id)}
                    title={idolNote(idol)}
                    style={btnStyle}
                  >
                    {idol.name}
                  </button>
                  );
                })}
              </div>
          {!hasExtras && choice !== 'custom' && (
          <div style={{ fontSize: 11, color: 'var(--text-m)' }}>No idols or food boxes owned — nothing extra to add.</div>
        )}
      </div>
    );
  };

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--code-bg)',
    borderRadius: 16,
    border: '1px solid var(--border)',
    marginRight: 16,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    transition: 'flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1), padding 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    flex: visible ? '1 1 0%' : '0 0 0%',
    opacity: visible ? 1 : 0,
    ...(visible ? {} : { marginRight: 0, border: 'none' }),
    padding: visible ? 16 : 0,
    gap: 12,
  };

  const toggleBtn: CSSProperties = {
    padding: '5px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: expertView ? 'var(--accent-bg)' : 'var(--social-bg)',
    color: expertView ? 'var(--accent)' : 'var(--text-h)',
    fontFamily: 'var(--font)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const legendStyle: CSSProperties = {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: 11,
    color: 'var(--text)',
    flexShrink: 0,
  };

  const smallBtn: CSSProperties = {
    padding: '5px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--social-bg)',
    color: 'var(--text-h)',
    fontFamily: 'var(--font)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const handleExport = () => {
    const data: RoomExportEntry[][] = rooms.map(room =>
      room.map(p => ({ id: p.item.id, row: p.row, col: p.col }))
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'room-layouts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (Array.isArray(parsed)) {
          // Support both old single-room format and new multi-room format
          if (parsed.length > 0 && Array.isArray(parsed[0])) {
            // Multi-room: [[{id,row,col},...], ...]
            onImportRooms(parsed as RoomExportEntry[][]);
          } else {
            // Single-room legacy: [{id,row,col},...]
            onImportRooms([parsed as RoomExportEntry[]]);
          }
        }
      } catch { /* ignore invalid files */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  if (!visible) return <div style={containerStyle} />;

  return (
    <div style={containerStyle}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      {/* Top row: auto-fill functions left, room chooser right */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{
          background: 'var(--social-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: '7 1 360px',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {activeRoom !== HOUSE_VIEW && (
              <button
                style={{ ...smallBtn, fontWeight: 600 }}
                onClick={() => onActiveRoomChange(HOUSE_VIEW)}
                title="Back to the whole-house overview"
              >
                ⌂ House
              </button>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-h)' }}>
              Auto-fill
            </span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              {(['fast', 'medium', 'long', 'extraLong'] as const).map((mode) => {
                const active = useV2 ? v2PresetKey === mode : searchMode === mode;
                const label = mode === 'extraLong' ? 'Extra Long' : mode.charAt(0).toUpperCase() + mode.slice(1);
                return (
                <button
                  key={mode}
                  disabled={fillProgress !== null || fillSearch !== null}
                  onClick={() => {
                    if (useV2) {
                      setV2Settings({ ...DEFAULT_V2_SETTINGS, ...V2_PRESETS[mode] });
                      setV2PresetKey(mode);
                    } else {
                      setSearchMode(mode);
                    }
                  }}
                  title={
                    useV2
                      ? `V2 preset: ${label}`
                      : mode === 'fast'
                      ? 'Original: single pass, deterministic'
                      : mode === 'medium'
                      ? 'Fast: 5 passes, fixed room order'
                      : mode === 'long'
                      ? 'Balanced: up to 15 passes, adaptive exit'
                      : 'Thorough: all 120 room orders, best overall'
                  }
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'var(--accent-bg)' : 'var(--bg)',
                    color: active ? 'var(--accent)' : 'var(--text-h)',
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    fontFamily: 'var(--font)',
                    opacity: fillProgress !== null || fillSearch !== null ? 0.6 : 1,
                  }}
                >
                  {label}
                </button>
                );
              })}
              <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
              <button
                disabled={fillProgress !== null || fillSearch !== null}
                onClick={() => {
                  setUseV2(v => !v);
                  if (useV2) setSearchMode('fast');
                }}
                title={useV2 ? 'Using Fill v2 (enablement-aware algorithm)' : 'Using Fill v1 (original maximize algorithm)'}
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: useV2 ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: useV2 ? 'var(--accent-bg)' : 'var(--bg)',
                  color: useV2 ? 'var(--accent)' : 'var(--text-h)',
                  fontWeight: useV2 ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                  opacity: fillProgress !== null || fillSearch !== null ? 0.6 : 1,
                }}
              >
                v{useV2 ? '2' : '1'}
              </button>
              <button
                disabled={fillProgress !== null || fillSearch !== null}
                onClick={() => setSettingsOpen(true)}
                title="Fill settings"
                style={{
                  fontSize: 14,
                  padding: '3px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-m)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                  lineHeight: 1,
                  opacity: fillProgress !== null || fillSearch !== null ? 0.6 : 1,
                }}
              >
                ⚙
              </button>
            </div>
            {(fillProgress !== null || fillSearch !== null) && (
              <button
                style={{ ...smallBtn, background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 600 }}
                onClick={onStopSearch}
                title="Stop filling and keep the best layout found so far"
              >
                Stop
              </button>
            )}
            <button
              style={{
                ...smallBtn,
                background: 'var(--accent)',
                color: 'var(--bg)',
                border: '1px solid var(--accent)',
                fontWeight: 600,
                padding: '6px 20px',
                position: 'relative',
                overflow: 'hidden',
                opacity: fillReady && fillProgress === null && fillSearch === null ? 1 : 0.6,
                cursor: fillProgress !== null || fillSearch !== null ? 'progress' : fillReady ? 'pointer' : 'not-allowed',
              }}
              disabled={!fillReady || fillProgress !== null || fillSearch !== null}
              onClick={handleAutoFill}
              title={fillReady ? 'Fill all rooms' : 'Set at least one stat to maximize'}
            >
              {fillProgress !== null && (
                <span style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${Math.round(fillProgress * 100)}%`,
                  background: 'rgba(255,255,255,0.35)',
                  transition: 'width 120ms linear',
                  pointerEvents: 'none',
                }} />
              )}
              {fillSearch !== null
                ? `Searching… best ${fillSearch.bestScore} · pass ${fillSearch.passes}`
                : fillProgress !== null
                  ? `Optimizing … ${Math.round(fillProgress * 100)}%`
                  : 'Fill'}
            </button>
          </div>
          {fillReport && fillProgress === null && fillSearch === null && (
            <div style={{ fontSize: 11, color: 'var(--text-m)', lineHeight: 1.4 }} title={fillReport}>
              {fillReport}
            </div>
          )}
          {activeRoom === HOUSE_VIEW ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {/* MASTER: compact room list */}
              <div style={{ flex: '3 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(() => {
                  const activeOrder = [...unlockedRooms].sort((a, b) => {
                    const ia = priorityOrder.indexOf(a);
                    const ib = priorityOrder.indexOf(b);
                    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
                  });
                  return activeOrder.map((ri) => {
                  const choice = roomChoice(ri);
                  const selected = drawerRoom === ri;
                  const idolCount = choice === 'skip' ? 0 : roomIdolsFor(ri).size;
                  const foodState: 0 | 1 | -1 = choice !== 'skip' ? (roomFood[ri] ?? 0) : 0;
                  const hasFood = foodState !== 0 && !!foodBox;
                  const minStats = choice !== 'custom' && choice !== 'skip' ? FILL_PRESETS[choice].minStats : undefined;
                  const pos = activeOrder.indexOf(ri);
                  const canUp = pos > 0;
                  const canDown = pos < activeOrder.length - 1;
                  const moveUp = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setPriorityOrder((prev) => {
                      const idx = prev.indexOf(ri);
                      if (idx <= 0) return prev;
                      const next = [...prev];
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      return next;
                    });
                  };
                  const moveDown = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setPriorityOrder((prev) => {
                      const idx = prev.indexOf(ri);
                      if (idx < 0 || idx >= prev.length - 1) return prev;
                      const next = [...prev];
                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                      return next;
                    });
                  };
                  return (
                    <div
                      key={ri}
                      onClick={() => setDetailRoom(ri)}
                      title={`Edit ${getRoomLabel(ri)}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                        background: selected ? 'var(--accent-bg)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0, marginRight: 2 }}>
                        <button onClick={canUp ? moveUp : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 10, padding: 0, border: 'none', background: 'transparent', color: canUp ? 'var(--text-m)' : 'transparent', cursor: canUp ? 'pointer' : 'default', fontSize: 8, lineHeight: 1 }} title="Move up (higher priority)">{'\u25B2'}</button>
                        <button onClick={canDown ? moveDown : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 10, padding: 0, border: 'none', background: 'transparent', color: canDown ? 'var(--text-m)' : 'transparent', cursor: canDown ? 'pointer' : 'default', fontSize: 8, lineHeight: 1 }} title="Move down (lower priority)">{'\u25BC'}</button>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', width: 48, flexShrink: 0 }}>{getRoomLabel(ri)}</span>
                      <select
                        value={choice}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value as FillPresetKey | 'custom' | 'skip';
                          setRoomPresets((prev) => ({ ...prev, [ri]: v }));
                          setDetailRoom(ri);
                        }}
                        style={{
                          padding: '3px 6px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          color: 'var(--text-h)',
                          fontFamily: 'var(--font)',
                          fontSize: 12,
                          flexShrink: 0,
                        }}
                      >
                        {(Object.keys(FILL_PRESETS) as FillPresetKey[]).map((key) => (
                          <option key={key} value={key}>{FILL_PRESETS[key].label}</option>
                        ))}
                        <option value="custom">Custom</option>
                        <option value="skip">Skip (keep as is)</option>
                      </select>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {choice === 'skip'
                          ? <span style={{ fontSize: 11, color: 'var(--text-m)' }}>keeps current layout</span>
                          : choice === 'random'
                            ? <span style={{ fontSize: 11, color: 'var(--text-m)' }}>dense fill, any items</span>
                            : renderWeightSummary(roomEffectiveWeights(ri), minStats)}
                        {hasFood && (foodState === 1
                          ? <span title="A food box is forced into this room" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#2e7d32', border: '1px solid rgba(46,125,50,0.35)', borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>FOOD</span>
                          : <span title="Food box excluded from this room" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#c62828', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>FOOD</span>
                        )}
                        {idolCount > 0 && <span title={`${idolCount} idol(s) selected`} style={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 12, fontWeight: 700, color: 'var(--blushed-brick)', border: '1px solid currentColor', borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>{'\u2605'}{idolCount > 1 ? ` ${idolCount}` : ''}</span>}
                      </span>
                    </div>
                  );
                })})()}
              </div>
              {/* DETAIL: stable editor for the selected room */}
              <div style={{ flex: '5 1 220px', minWidth: 180, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                {renderRoomDrawer(drawerRoom)}
              </div>
            </div>
          ) : (
            <>
              {/* TARGET — preset + stats, always visible */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', color: 'var(--lavender-grey)', textTransform: 'uppercase', marginRight: 2 }}>Target</span>
                {(Object.keys(FILL_PRESETS) as FillPresetKey[]).map((key) => (
                  <button
                    key={key}
                    style={{
                      ...smallBtn,
                      fontSize: 11,
                      padding: '4px 10px',
                      outline: 'none',
                      ...(presetKey === key ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' } : {}),
                    }}
                    onClick={() => applyPreset(key)}
                    title={FILL_PRESETS[key].description}
                  >
                    {presetKey === key && presetModified ? `${FILL_PRESETS[key].label} *` : FILL_PRESETS[key].label}
                  </button>
                ))}
                <button
                  style={{
                    ...smallBtn,
                    fontSize: 11,
                    padding: '4px 10px',
                    outline: 'none',
                    ...(presetKey === 'blank' ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' } : {}),
                  }}
                  onClick={selectBlank}
                  title="Start from zero — no stats, no comfort floor"
                >
                  Blank
                </button>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-m)' }}>
                {presetKey !== 'blank'
                  ? `${FILL_PRESETS[presetKey].description}${presetModified ? ' · stats edited (rule kept)' : ''}`
                  : 'Blank: pick stats below'}
              </span>
              {statChips}
              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              {/* EXTRAS — food + idols */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', color: 'var(--lavender-grey)', textTransform: 'uppercase' }}>Extras</span>
                {foodBox && (() => {
                  const state = foodTolerance;
                  let btnStyle: CSSProperties;
                  let label: string;
                  if (state === 'maximize') {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(46,125,50,0.12)', color: '#2e7d32', border: '1px solid rgba(46,125,50,0.35)' };
                    label = 'Food Box';
                  } else if (state === 'minimize') {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(198,40,40,0.1)', color: '#c62828', border: '1px solid rgba(198,40,40,0.3)' };
                    label = 'Food Box';
                  } else {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px' };
                    label = 'Food Box';
                  }
                  return (
                    <button key="food" onClick={toggleFood} title="Force food box into the room, exclude it, or neutral" style={btnStyle}>
                      {label}
                    </button>
                  );
                })()}
                {idols.map((idol) => {
                  const owned = (ownership[idol.id] || 0) > 0;
                  const placed = selectedIdols.has(idol.id);
                  const ignored = excludedIdols.has(idol.id);
                  let btnStyle: CSSProperties;
                  if (placed) {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(46,125,50,0.12)', color: '#2e7d32', border: '1px solid rgba(46,125,50,0.35)', cursor: owned ? 'pointer' : 'not-allowed' };
                  } else if (ignored) {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', background: 'rgba(198,40,40,0.1)', color: '#c62828', border: '1px solid rgba(198,40,40,0.3)', cursor: owned ? 'pointer' : 'not-allowed' };
                  } else {
                    btnStyle = { ...smallBtn, fontSize: 11, padding: '3px 9px', cursor: owned ? 'pointer' : 'not-allowed', opacity: owned ? 1 : 0.55 };
                  }
                  return (
                    <button
                      key={idol.id}
                      disabled={!owned}
                      onClick={() => owned && toggleIdol(idol.id)}
                      title={owned ? idolNote(idol) : `Not purchased \u2014 ${idolNote(idol)}`}
                      style={btnStyle}
                    >
                      {idol.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div style={{
          flex: '3 1 360px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'var(--social-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '10px 14px',
        }}>
          {/* header mirrors the Auto-fill card's title row for a consistent top */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-h)' }}>Room stats</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--text-m)' }}>live totals · click a room to open</span>
          </div>
          <div style={{ flex: 1, display: 'flex' }}>
            <RoomStatsSummary
              rooms={rooms}
              activeRoom={activeRoom}
              onActiveRoomChange={onActiveRoomChange}
              ownership={ownership}
              isRoomUnlocked={isRoomUnlocked}
              roomWeights={roomWeights}
              allFurniture={allFurniture}
              roomFunctions={Object.fromEntries(
                [4, 0, 1, 2, 3].filter(i => i < rooms.length).map(i => {
                  const choice = roomChoice(i);
                  return [i, choice === 'custom' ? 'Custom' : choice !== 'skip' ? FILL_PRESETS[choice].label : ''];
                })
              )}
              priorityOrder={priorityOrder}
            />
          </div>
        </div>
      </div>
      <div ref={linkRootRef} style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0, minWidth: 0, position: 'relative' }}>
          {/* Floating undo/redo, centered over the open room, above the bottom bar (hidden in house view) */}
          {activeRoom !== HOUSE_VIEW && (
          <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 50 }}>
            {([
              { fn: onUndo, label: '↶', tip: 'Undo room change (Ctrl+Z)' },
              { fn: onRedo, label: '↷', tip: 'Redo room change (Ctrl+Y)' },
            ] as const).map((b) => (
              <button
                key={b.tip}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: b.fn ? 'var(--text-h)' : 'var(--text-m)',
                  fontSize: 22,
                  fontFamily: 'var(--font)',
                  cursor: b.fn ? 'pointer' : 'not-allowed',
                  opacity: b.fn ? 0.95 : 0.45,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                disabled={!b.fn}
                onClick={b.fn}
                title={b.tip}
              >
                {b.label}
              </button>
            ))}
          </div>
          )}
          {activeRoom === HOUSE_VIEW ? (
            <HouseView
              rooms={rooms}
              isRoomUnlocked={isRoomUnlocked}
              onSelectRoom={onActiveRoomChange}
              labelNumbers={labelNumbers}
              hoverItemId={hoverItem}
              onHoverItem={handleHoverItem}
              onSelectItem={(ri, id) => {
                onActiveRoomChange(ri);
                setChecklistOpen(true);
                setHoverItem(id);
              }}
              expertView={expertView}
              checklistOpen={checklistOpen}
            />
          ) : (
            <RoomGrid
              placed={placed}
              onPlace={onPlace}
              onRemove={onRemove}
              onMove={onMove}
              expertView={expertView}
              roomIndex={activeRoom}
              labelNumbers={labelNumbers}
              hoverItemId={hoverItem}
              onHoverItem={handleHoverItem}
              onSelectItem={(id) => {
                setChecklistOpen(true);
                setHoverItem(id);
              }}
              checklistOpen={checklistOpen}
            />
          )}
        </div>
        {checklistOpen && (
          <RoomChecklist
            placed={placed}
            roomIndex={activeRoom}
            numbers={labelNumbers}
            hoverItemId={hoverItem}
            onHoverItem={handleHoverItem}
          />
        )}
        {connectorLines.length > 0 && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 30 }}>
            {connectorLines.map((l, i) => (
              <line
                key={i}
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
              />
            ))}
          </svg>
        )}
      </div>
      {expertView && (
        <div style={legendStyle}>
          {LEGEND.map((l) => (
            <div key={l.type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: l.color,
                border: `1px solid ${l.border}`,
              }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      )}
      {/* Unified action toolbar: room/view tools (left) + save & share (right) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexShrink: 0,
        flexWrap: 'wrap',
        borderTop: '1px solid var(--border)',
        paddingTop: 10,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={{ ...smallBtn, ...(checklistOpen ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
            onClick={() => setChecklistOpen((v) => !v)}
            title="Tick off this room's items while placing them in the game"
          >
            Checklist
          </button>
          <button style={toggleBtn} onClick={() => setExpertView((v) => !v)}>
            {expertView ? 'Image View' : 'Expert View'}
          </button>
          <button
            style={{ ...smallBtn, ...(drawerOpen ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
            onClick={onToggleDrawer}
            title={drawerOpen ? 'Hide the furniture list' : 'Show the furniture list to browse and drag items manually'}
          >
            {drawerOpen ? 'Hide furniture' : 'Furniture ▸'}
          </button>
          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
          <button
            style={smallBtn}
            onClick={handleEmptyRooms}
            title={activeRoom === HOUSE_VIEW ? 'Remove all furniture from every unlocked room' : `Remove all furniture from ${getRoomLabel(activeRoom)}`}
          >
            {activeRoom === HOUSE_VIEW ? 'Empty rooms' : 'Empty room'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {activeRoom !== HOUSE_VIEW && (
            <button style={smallBtn} onClick={() => captureRoom(rooms, activeRoom)} title={`Save image of ${getRoomLabel(activeRoom)}`}>
              Save room image
            </button>
          )}
          <button style={smallBtn} onClick={() => captureHouse(rooms)} title="Save image of all rooms">
            Save house image
          </button>
          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
          <button style={smallBtn} onClick={handleExport} title="Export all room layouts as JSON">
            Export
          </button>
          <button style={smallBtn} onClick={() => fileInputRef.current?.click()} title="Import room layouts from JSON">
            Import
          </button>
        </div>
      </div>

      {/* ─── Settings Modal ─── */}
      {settingsOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 20px',
              maxWidth: 1500,
              width: '90vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              color: 'var(--text-h)',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Fill Settings</span>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-m)',
                  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>

            {/* ── Food section (house-level) ── */}
            {foodBox && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', color: 'var(--lavender-grey)', textTransform: 'uppercase' }}>Food Box</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {(['auto', 'maximize', 'minimize'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFoodTolerance(opt)}
                    style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 4,
                      border: foodTolerance === opt ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: foodTolerance === opt ? 'var(--accent-bg)' : 'var(--bg)',
                      color: foodTolerance === opt ? 'var(--accent)' : 'var(--text-h)',
                      fontWeight: foodTolerance === opt ? 600 : 400,
                      cursor: 'pointer',
                      fontFamily: 'var(--font)',
                    }}
                  >
                    {opt === 'auto' ? 'Auto' : opt === 'maximize' ? 'Maximize' : 'Minimize'}
                  </button>
                ))}
              </div>
            </div>}


            {/* ── V2 algorithm settings ── */}
            {useV2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', color: 'var(--lavender-grey)', textTransform: 'uppercase' }}>
                V2 Algorithm — Fine Tuning
              </span>
              {([
                { label: 'Sort — Enablement', key: 'sortEnablementWeight' as const, min: 0, max: 1, step: 0.01, desc: 'Weight for ordering candidates by how many other items they enable when placed. Higher = prioritise items that unlock neighbours.' },
                { label: 'Sort — Irregularity', key: 'sortIrregularityWeight' as const, min: 0, max: 1, step: 0.01, desc: 'How much to favour irregularly-shaped items over plain rectangles. Useful when filling odd-shaped corners of a room.' },
                { label: 'Sort — Score', key: 'sortScoreWeight' as const, min: 0, max: 1, step: 0.01, desc: 'How strongly raw stat score influences candidate ordering. Higher = always try the highest-stat item first.' },
                { label: 'Sort — Efficiency', key: 'sortEfficiencyWeight' as const, min: 0, max: 1, step: 0.01, desc: 'Preference for items with a high stat-per-tile ratio. Higher = cram more stats into limited space.' },
                { label: 'Sort — Lego Bonus', key: 'sortLegoBonus' as const, min: 0, max: 1, step: 0.01, desc: 'Extra weight for items whose shape lets them interlock with previously placed pieces. Higher = denser packing.' },
                { label: 'Best-Fit — Corner', key: 'bestFitCornerWeight' as const, min: 0, max: 5, step: 0.1, desc: 'How much the algorithm tries to place items in corner cells. Higher = fill corners first before moving to edges.' },
                { label: 'Best-Fit — Edge', key: 'bestFitEdgeWeight' as const, min: 0, max: 5, step: 0.1, desc: 'How much the algorithm tries to place items along room edges. Higher = wall-hugging layout.' },
                { label: 'Best-Fit — Anchor Exposure', key: 'bestFitAnchorExposureWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Penalty weighting for leaving anchor points (hanging spots) exposed without their paired piece. Lower = more tolerance for unpaired anchors.' },
                { label: 'Best-Fit — Hollow Access', key: 'bestFitHollowAccessWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Bonus for placing items that create accessible hollows or alcoves. Higher = more organically-shaped layouts.' },
                { label: 'Best-Fit — Vertical', key: 'bestFitVerticalWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Weight for stacking items vertically. Higher = prefer tall arrangements over spreading horizontally.' },
                { label: 'Best-Fit — Fragmentation Penalty', key: 'bestFitFragmentationPenalty' as const, min: -5, max: 0, step: 0.1, desc: 'How much to penalise layouts that leave many small disconnected gaps. More negative = strongly prefer contiguous blocks.' },
                { label: 'Coverage Bonus', key: 'coverageBonus' as const, min: 0, max: 5, step: 0.1, desc: 'Bonus for covering a larger fraction of the room floor. Higher = fill every possible tile before stopping.' },
                { label: 'Enablement — Filler', key: 'enablementFillerWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Weight given to items that act as filler in enablement chains — pieces that sit between enablement sources and targets.' },
                { label: 'Enablement — Hanger', key: 'enablementHangerWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Weight for hanging-type items in enablement scoring. Higher = prefer furniture that hangs from anchors.' },
                { label: 'Enablement — Lego Bonus', key: 'legoBonusWeight' as const, min: 0, max: 5, step: 0.1, desc: 'Extra scoring weight for items that form lego-style connections (tab-and-slot shapes). Higher = chain more connected pieces.' },
                { label: 'Ruin Sparse Ratio', key: 'ruinSparseRatio' as const, min: 0, max: 1, step: 0.01, desc: 'Occupancy threshold below which a partial layout is considered sparse enough to tear down and retry. Lower = more willing to scrap and rebuild.' },
                { label: 'Temperature', key: 'temperature' as const, min: 0, max: 2, step: 0.01, desc: 'Randomness in candidate ordering. 0 = fully deterministic (same inputs always produce the same layout). Higher = more variety in placements.' },
                { label: 'Max Iterations', key: 'defaultMaximizeIterations' as const, min: 1, max: 850, step: 1, desc: 'Maximum search iterations per room. Higher = potentially better layouts but slower. 100 is a good balance.' },
              ]).map(({ label, key, min, max, step, desc }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-m)', width: 160, flexShrink: 0 }}>{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={v2Settings[key]}
                    onChange={(e) => {
                      const next = { ...v2Settings, [key]: parseFloat(e.target.value) };
                      const v2Keys = Object.keys(DEFAULT_V2_SETTINGS) as (keyof typeof DEFAULT_V2_SETTINGS)[];
                      const allDefaults = v2Keys.every(
                        k => next[k] === DEFAULT_V2_SETTINGS[k]
                      );
                      if (allDefaults) {
                        setV2PresetKey('fast');
                      } else {
                        const matched = Object.entries(V2_PRESETS).find(([pName, preset]) => {
                          if (pName === 'fast') return false;
                          const merged = { ...DEFAULT_V2_SETTINGS, ...preset };
                          return (Object.keys(merged) as (keyof typeof merged)[]).every(k => next[k] === merged[k]);
                        });
                        setV2PresetKey(matched ? matched[0] as 'fast' | 'medium' | 'long' | 'extraLong' : 'custom');
                      }
                      setV2Settings(next);
                    }}
                    style={{ flex: 1, accentColor: 'var(--accent)' }}
                  />
                  <span style={{
                    fontSize: 11, color: 'var(--text-h)',
                    fontWeight: 600, width: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {v2Settings[key]}
                  </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-m)', lineHeight: 1.4, paddingLeft: 168 }}>{desc}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  onClick={() => {
                    setV2Settings({ ...DEFAULT_V2_SETTINGS });
                    setV2PresetKey('fast');
                  }}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text-m)', cursor: 'pointer', fontFamily: 'var(--font)',
                  }}
                >
                  Reset defaults
                </button>
                <button
                  onClick={() => {
                    const data = JSON.stringify(v2Settings, null, 2);
                    const blob = new Blob([data], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'mg-clawset-v2-settings.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text-h)', cursor: 'pointer', fontFamily: 'var(--font)',
                  }}
                >
                  Export settings
                </button>
                <button
                  onClick={() => document.getElementById('v2-import-input')?.click()}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text-h)', cursor: 'pointer', fontFamily: 'var(--font)',
                  }}
                >
                  Import settings
                </button>
                <input
                  id="v2-import-input"
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const parsed = JSON.parse(reader.result as string);
                        const v2Keys = Object.keys(DEFAULT_V2_SETTINGS) as (keyof typeof DEFAULT_V2_SETTINGS)[];
                        const valid = v2Keys.every(k => typeof parsed[k] === 'number');
                        if (!valid) { alert('Invalid settings file: missing or non-numeric values.'); return; }
                        const allDefaults = v2Keys.every(k => parsed[k] === DEFAULT_V2_SETTINGS[k]);
                        if (allDefaults) { setV2PresetKey('fast'); }
                        else {
                          const matched = Object.entries(V2_PRESETS).find(([pName, preset]) => {
                            if (pName === 'fast') return false;
                            const merged = { ...DEFAULT_V2_SETTINGS, ...preset };
                            return v2Keys.every(k => parsed[k] === merged[k]);
                          });
                          setV2PresetKey(matched ? matched[0] as 'fast' | 'medium' | 'long' | 'extraLong' : 'custom');
                        }
                        setV2Settings(parsed);
                      } catch { alert('Invalid JSON file.'); }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
