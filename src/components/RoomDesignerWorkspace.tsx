import { useState, useRef, useMemo, useLayoutEffect } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import RoomGrid from './RoomGrid';
import RoomStatsSummary from './RoomStatsSummary';
import { getRoomLabel, HOUSE_VIEW, ATTIC_INDEX } from '../types/furniture';
import { captureRoom, captureHouse } from '../utils/roomCapture';
import { ALGORITHMS, ALL_STATS, STAT_LABELS } from '../utils/autoPopulate';
import type { AlgorithmKey, StatWeights, RoomFillPlan } from '../utils/autoPopulate';
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

type FillPresetKey = 'breeding' | 'storage' | 'mutation';

const EMPTY_WEIGHTS: Record<StatKey, -1 | 0 | 1> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };

const FILL_PRESETS: Record<FillPresetKey, {
  label: string;
  description: string;
  tristate: Partial<Record<StatKey, -1 | 0 | 1>>;
  minStats?: Partial<Record<StatKey, number>>;
  autoIdolKey?: string;
}> = {
  breeding: {
    label: 'Breeding',
    description: 'Maximize stimulation, keep room comfort at 4+ (enough for 4 cats)',
    tristate: { stimulation: 1 },
    minStats: { comfort: 4 },
  },
  storage: {
    label: 'Storage',
    description: 'Maximize health + comfort; auto-selects the Idol of Chastity if owned (no breeding)',
    tristate: { health: 1, comfort: 1 },
    autoIdolKey: 'suppressoridol',
  },
  mutation: {
    label: 'Mutation',
    description: 'Maximize mutation + comfort with the lowest possible stimulation',
    tristate: { mutation: 1, comfort: 1, stimulation: -1 },
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
  }) => void;
  ownership: Record<string, number>;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  isRoomUnlocked: (i: number) => boolean;
  /** All special idols; unowned ones render disabled. */
  idols: FurnitureItem[];
  /** Owned food box item (null when none owned). */
  foodBox: FurnitureItem | null;
  /** 0..1 while an auto-fill search runs, null when idle. */
  fillProgress?: number | null;
  /** Quality summary of the last auto-fill. */
  fillReport?: string | null;
  /** Undo/redo for room mutations; undefined = nothing to un/redo. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** Clear all furniture from the given rooms (undoable). */
  onEmptyRooms: (roomIndexes: number[]) => void;
}

export default function RoomDesignerWorkspace({
  visible, placed, rooms, activeRoom, onActiveRoomChange,
  onPlace, onRemove, onMove, onImportRooms, onAutoPopulate, ownership,
  drawerOpen, onToggleDrawer, isRoomUnlocked, idols, foodBox, fillProgress = null, fillReport = null, onUndo, onRedo, onEmptyRooms,
}: Props) {
  const [expertView, setExpertView] = useState(false);
  const [presetKey, setPresetKey] = useState<FillPresetKey | 'custom'>('breeding');
  // house fill: independent preset per room
  const [roomPresets, setRoomPresets] = useState<Record<number, FillPresetKey | 'custom' | 'skip'>>({});
  // per-room stat weights for rooms set to 'custom' in the house fill
  const [roomWeights, setRoomWeights] = useState<Record<number, Record<StatKey, -1 | 0 | 1>>>({});
  const [statWeights, setStatWeights] = useState<Record<StatKey, -1 | 0 | 1>>(
    () => ({ ...EMPTY_WEIGHTS, ...FILL_PRESETS.breeding.tristate }),
  );
  const [includeFood, setIncludeFood] = useState(false);
  const [algorithm, setAlgorithm] = useState<AlgorithmKey>('maximize');
  const [selectedIdols, setSelectedIdols] = useState<Set<string>>(() => new Set());
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [connectorLines, setConnectorLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  // lightweight hover overlay (item name + stats tag) when the checklist panel is closed
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; text: string; item: FurnitureItem | null; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkRootRef = useRef<HTMLDivElement>(null);

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

    // Hover tag: name + label number next to the hovered piece (checklist closed)
  useLayoutEffect(() => {
    const root = linkRootRef.current;
    if (!hoverItem || checklistOpen || !root) {
      setHoverTip(null);
      return;
    }
    const piece = root.querySelector(`[data-piece-id="${CSS.escape(hoverItem)}"]`);
    if (!piece) {
      setHoverTip(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const r = piece.getBoundingClientRect();
    let item: FurnitureItem | null = null;
    let count = 0;
    for (const room of rooms) {
      for (const pl of room) {
        if (pl.item.id === hoverItem) {
          item = pl.item;
          count++;
        }
      }
    }
    const num = labelNumbers[hoverItem];
    setHoverTip({
      // keep the tag inside the container even for pieces at the edges
      x: Math.min(Math.max(r.left + r.width / 2 - rootRect.left, 70), rootRect.width - 70),
      y: Math.max(r.top - rootRect.top, 44),
      text: `${num ? `#${num} ` : ''}${item?.name ?? ''}${count > 1 ? ` \u00d7${count}` : ''}`,
      item,
      count,
    });
  }, [hoverItem, checklistOpen, rooms, labelNumbers]);

  const handleHoverItem = (id: string | null) => {
    setHoverItem(id);
  };

  const applyPreset = (key: FillPresetKey) => {
    const preset = FILL_PRESETS[key];
    setPresetKey(key);
    setStatWeights({ ...EMPTY_WEIGHTS, ...preset.tristate });
    if (preset.autoIdolKey) {
      const idol = idols.find((i) => i.image_url.includes(preset.autoIdolKey!) && (ownership[i.id] || 0) > 0);
      if (idol) setSelectedIdols((prev) => new Set(prev).add(idol.id));
    }
  };

  const cycleStat = (stat: StatKey) => {
    setPresetKey('custom');
    setStatWeights((prev) => ({
      ...prev,
      [stat]: prev[stat] === 0 ? 1 : prev[stat] === 1 ? -1 : 0,
    }));
  };

  const toggleIdol = (id: string) => {
    setSelectedIdols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeWeights: StatWeights = Object.fromEntries(
    ALL_STATS.filter((st) => statWeights[st] !== 0).map((st) => [st, statWeights[st]]),
  );
  const minStats = presetKey !== 'custom' ? FILL_PRESETS[presetKey].minStats : undefined;
  const hasPositiveWeight = ALL_STATS.some((st) => statWeights[st] > 0);

  const unlockedRooms = ([ATTIC_INDEX, 0, 1, 2, 3] as number[]).filter(isRoomUnlocked);
  // default to one of each preset, remaining rooms start as custom
  const PRESET_CYCLE: FillPresetKey[] = ['breeding', 'storage', 'mutation'];
  const roomChoice = (ri: number): FillPresetKey | 'custom' | 'skip' => {
    if (roomPresets[ri]) return roomPresets[ri];
    const idx = Math.max(0, unlockedRooms.indexOf(ri));
    return idx < PRESET_CYCLE.length ? PRESET_CYCLE[idx] : 'custom';
  };
  const roomWeightsFor = (ri: number): Record<StatKey, -1 | 0 | 1> =>
    roomWeights[ri] ?? EMPTY_WEIGHTS;
  const cycleRoomStat = (ri: number, stat: StatKey) => {
    setRoomWeights((prev) => {
      const cur = prev[ri] ?? EMPTY_WEIGHTS;
      return { ...prev, [ri]: { ...cur, [stat]: cur[stat] === 0 ? 1 : cur[stat] === 1 ? -1 : 0 } };
    });
  };
  // custom rooms need at least one maximized stat; presets always have one
  const fillReady = activeRoom === HOUSE_VIEW
    ? unlockedRooms.some((ri) => roomChoice(ri) !== 'skip')
      && unlockedRooms.every((ri) => roomChoice(ri) !== 'custom' || ALL_STATS.some((st) => roomWeightsFor(ri)[st] > 0))
    : hasPositiveWeight;

  const buildHousePlans = (): RoomFillPlan[] => {
    const plans: RoomFillPlan[] = [];
    for (const ri of unlockedRooms) {
      const choice = roomChoice(ri);
      if (choice === 'skip') continue;
      if (choice === 'custom') {
        const w = roomWeightsFor(ri);
        const weights: StatWeights = Object.fromEntries(
          ALL_STATS.filter((st) => w[st] !== 0).map((st) => [st, w[st]]),
        );
        plans.push({ roomIndex: ri, weights, mustInclude: [] });
        continue;
      }
      const preset = FILL_PRESETS[choice];
      const autoIdol = preset.autoIdolKey
        ? idols.find((i) => i.image_url.includes(preset.autoIdolKey!) && (ownership[i.id] || 0) > 0)
        : undefined;
      plans.push({
        roomIndex: ri,
        weights: Object.fromEntries(Object.entries(preset.tristate)) as StatWeights,
        mustInclude: autoIdol ? [autoIdol.id] : [],
        minStats: preset.minStats,
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
    if (activeRoom === HOUSE_VIEW) {
      const plans = buildHousePlans();
      const replacing = plans.reduce((s, p) => s + rooms[p.roomIndex].length, 0);
      if (
        replacing > 0 &&
        !window.confirm(`Replace ${replacing} item(s) across ${plans.length} room(s) with auto-generated layouts?`)
      ) {
        return;
      }
      onAutoPopulate({ algorithm, plans });
      return;
    }
    const statText = ALL_STATS.filter((st) => statWeights[st] !== 0)
      .map((st) => `${statWeights[st] > 0 ? '+' : '\u2212'}${STAT_LABELS[st]}`)
      .join(' ');
    const label = presetKey !== 'custom' ? FILL_PRESETS[presetKey].label : statText;
    if (
      placed.length > 0 &&
      !window.confirm(`Replace ${placed.length} item(s) in ${getRoomLabel(activeRoom)} with an auto-generated "${label}" layout?`)
    ) {
      return;
    }
    const mustInclude = [
      ...idols.filter((i) => selectedIdols.has(i.id)).map((i) => i.id),
      ...(includeFood && foodBox ? [foodBox.id] : []),
    ];
    onAutoPopulate({
      algorithm,
      plans: [{ roomIndex: activeRoom, weights: activeWeights, mustInclude, minStats }],
    });
  };

  const renderStatChips = (weights: Record<StatKey, -1 | 0 | 1>, onCycle: (stat: StatKey) => void) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-m)' }} title="Click a stat to cycle: maximize \u2192 avoid \u2192 off">Stats:</span>
      {ALL_STATS.map((stat) => (
        <button
          key={stat}
          onClick={() => onCycle(stat)}
          title={`${STAT_LABELS[stat]} \u2014 click to cycle: maximize \u2192 avoid \u2192 off`}
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
            border: `1px solid ${weights[stat] === 1 ? STAT_COLORS[stat] : weights[stat] === -1 ? 'var(--charcoal)' : 'var(--border)'}`,
            background: weights[stat] === 1 ? STAT_COLORS[stat] : weights[stat] === -1 ? 'var(--charcoal)' : 'var(--bg)',
            color: weights[stat] !== 0 ? '#fff' : 'var(--text-m)',
          }}
        >
          <StatIcon stat={stat} size={13} />
          {STAT_LABELS[stat]}
          {weights[stat] === 1 ? ' +' : weights[stat] === -1 ? ' \u2212' : ''}
        </button>
      ))}
    </div>
  );
  const statChips = renderStatChips(statWeights, cycleStat);

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
          flex: '1.2 1 420px',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-h)' }}>✨ Auto-fill</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {(Object.keys(ALGORITHMS) as AlgorithmKey[]).map((key) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} title={ALGORITHMS[key].description}>
                  <input
                    type="radio"
                    name="autofill-algorithm"
                    checked={algorithm === key}
                    onChange={() => setAlgorithm(key)}
                  />
                  {ALGORITHMS[key].label}
                </label>
              ))}
            </div>
            <div style={{ flex: 1 }} />
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
                opacity: fillReady && fillProgress === null ? 1 : 0.6,
                cursor: fillProgress !== null ? 'progress' : fillReady ? 'pointer' : 'not-allowed',
              }}
              disabled={!fillReady || fillProgress !== null}
              onClick={handleAutoFill}
              title={fillReady ? `Fill ${getRoomLabel(activeRoom)}` : 'Set at least one stat to maximize'}
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
              {fillProgress !== null
                ? `Optimizing … ${Math.round(fillProgress * 100)}%`
                : `Fill ${getRoomLabel(activeRoom)}`}
            </button>
          </div>
          {activeRoom === HOUSE_VIEW ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {unlockedRooms.map((ri) => {
                  const choice = roomChoice(ri);
                  const desc = choice === 'custom'
                    ? 'Pick this room\u2019s own stats:'
                    : choice === 'skip'
                      ? 'Keeps the current layout untouched'
                      : FILL_PRESETS[choice].description;
                  return (
                    <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', width: 52, flexShrink: 0 }}>{getRoomLabel(ri)}</span>
                      <select
                        value={choice}
                        onChange={(e) => setRoomPresets((prev) => ({ ...prev, [ri]: e.target.value as FillPresetKey | 'custom' | 'skip' }))}
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
                      <span style={{ fontSize: 11, color: 'var(--text-m)', minWidth: 0 }}>{desc}</span>
                      {choice === 'custom' && (
                        <div style={{ flexBasis: '100%', paddingLeft: 60 }}>
                          {renderStatChips(roomWeightsFor(ri), (stat) => cycleRoomStat(ri, stat))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-m)' }}>Preset:</span>
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
                    {FILL_PRESETS[key].label}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: 'var(--text-m)' }}>
                  {presetKey !== 'custom' ? FILL_PRESETS[presetKey].description : 'Custom: pick stats below'}
                </span>
              </div>
              {statChips}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: foodBox ? 'var(--text)' : 'var(--text-m)', cursor: foodBox ? 'pointer' : 'not-allowed' }}
                  title={foodBox ? 'Force all owned Food Boxes into the layout (+40 max food each)' : 'No Food Box owned'}
                >
                  <input
                    type="checkbox"
                    disabled={!foodBox}
                    checked={includeFood && !!foodBox}
                    onChange={(e) => setIncludeFood(e.target.checked)}
                  />
                  Include food storage
                </label>
                {idols.map((idol) => {
                  const owned = (ownership[idol.id] || 0) > 0;
                  return (
                    <label
                      key={idol.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        color: owned ? 'var(--text)' : 'var(--text-m)',
                        cursor: owned ? 'pointer' : 'not-allowed',
                        opacity: owned ? 1 : 0.55,
                      }}
                      title={owned ? idolNote(idol) : `Not purchased \u2014 ${idolNote(idol)}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!owned}
                        checked={owned && selectedIdols.has(idol.id)}
                        onChange={() => toggleIdol(idol.id)}
                      />
                      {idol.name}
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {fillReport && fillProgress === null && (
            <div style={{ fontSize: 11, color: 'var(--text-m)' }} title="The max assumes every positive-scoring copy fits; real rooms run out of space, so high percentages mean near-perfect.">
              {fillReport}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 'auto', paddingTop: 4 }}>
            <button
              style={{ ...smallBtn, ...(checklistOpen ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
              onClick={() => setChecklistOpen((v) => !v)}
              title="Tick off this room's items while placing them in the game"
            >
              Checklist
            </button>
            <button
              style={smallBtn}
              onClick={handleEmptyRooms}
              title={activeRoom === HOUSE_VIEW ? 'Remove all furniture from every unlocked room' : `Remove all furniture from ${getRoomLabel(activeRoom)}`}
            >
              {activeRoom === HOUSE_VIEW ? 'Empty rooms' : 'Empty room'}
            </button>
            <button
              style={{ ...smallBtn, ...(drawerOpen ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
              onClick={onToggleDrawer}
              title={drawerOpen ? 'Hide the furniture list' : 'Show the furniture list to browse and drag items manually'}
            >
              {drawerOpen ? 'Hide furniture' : 'Furniture ▸'}
            </button>
            <button style={toggleBtn} onClick={() => setExpertView((v) => !v)}>
              {expertView ? 'Image View' : 'Expert View'}
            </button>
          </div>
        </div>
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex' }}>
          <RoomStatsSummary
            rooms={rooms}
            activeRoom={activeRoom}
            onActiveRoomChange={onActiveRoomChange}
            ownership={ownership}
            isRoomUnlocked={isRoomUnlocked}
          />
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
        {hoverTip && (
          <div style={{
            position: 'absolute',
            left: hoverTip.x,
            top: hoverTip.y - 8,
            transform: 'translate(-50%, -100%)',
            background: 'var(--charcoal)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font)',
            padding: '4px 10px',
            borderRadius: 8,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 40,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            // dark pill: stat icons must always render white
            ['--icon-invert' as string]: 'invert(1)',
          } as CSSProperties}>
            <div style={{ textAlign: 'center' }}>{hoverTip.text}</div>
            {hoverTip.item && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 2, fontSize: 11, fontWeight: 700 }}>
                {ALL_STATS.filter((st) => hoverTip.item![st] !== 0).map((st) => {
                  const v = hoverTip.item![st];
                  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
                  return (
                    <span key={st} style={{ color: STAT_COLORS[st], display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <StatIcon stat={st} size={12} />
                      {/* per item; with multiple copies also the room total */}
                      {hoverTip.count > 1 ? `${fmt(v)} (${fmt(v * hoverTip.count)})` : fmt(v)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
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
      {/* Bottom bar: save pic + export/import */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {activeRoom !== HOUSE_VIEW && (
            <button style={smallBtn} onClick={() => captureRoom(rooms, activeRoom)} title={`Save image of ${getRoomLabel(activeRoom)}`}>
              Save image of {getRoomLabel(activeRoom)}
            </button>
          )}
          <button style={smallBtn} onClick={() => captureHouse(rooms)} title="Save image of all rooms">
            Save image of a house
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={smallBtn} onClick={handleExport} title="Export all room layouts as JSON">
            Export to file
          </button>
          <button style={smallBtn} onClick={() => fileInputRef.current?.click()} title="Import room layouts from JSON">
            Import from file
          </button>
        </div>
      </div>
    </div>
  );
}
