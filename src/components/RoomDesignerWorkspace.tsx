import { useState, useRef, useMemo, useLayoutEffect } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import RoomGrid from './RoomGrid';
import RoomStatsSummary from './RoomStatsSummary';
import { getRoomLabel, HOUSE_VIEW } from '../types/furniture';
import { captureRoom, captureHouse } from '../utils/roomCapture';
import { ALGORITHMS, ALL_STATS, STAT_LABELS } from '../utils/autoPopulate';
import type { AlgorithmKey, StatWeights } from '../utils/autoPopulate';
import type { StatKey } from '../types/furniture';
import StatIcon from './StatIcon';
import RoomChecklist from './RoomChecklist';
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
    weights: StatWeights;
    algorithm: AlgorithmKey;
    mustInclude: string[];
    minStats?: Partial<Record<StatKey, number>>;
  }) => void;
  ownership: Record<string, number>;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  isRoomUnlocked: (i: number) => boolean;
  /** Owned special idols selectable for forced placement. */
  idols: FurnitureItem[];
  /** Owned food box item (null when none owned). */
  foodBox: FurnitureItem | null;
}

export default function RoomDesignerWorkspace({
  visible, placed, rooms, activeRoom, onActiveRoomChange,
  onPlace, onRemove, onMove, onImportRooms, onAutoPopulate, ownership,
  drawerOpen, onToggleDrawer, isRoomUnlocked, idols, foodBox,
}: Props) {
  const [expertView, setExpertView] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [presetKey, setPresetKey] = useState<FillPresetKey | 'custom'>('breeding');
  const [statWeights, setStatWeights] = useState<Record<StatKey, -1 | 0 | 1>>(
    () => ({ ...EMPTY_WEIGHTS, ...FILL_PRESETS.breeding.tristate }),
  );
  const [includeFood, setIncludeFood] = useState(false);
  const [algorithm, setAlgorithm] = useState<AlgorithmKey>('maximize');
  const [selectedIdols, setSelectedIdols] = useState<Set<string>>(() => new Set());
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [labelsOn, setLabelsOn] = useState(false);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [connectorLines, setConnectorLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
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
  }, [hoverItem, checklistOpen, placed, labelsOn]);

  // Legend numbers: alphabetical unique items of the active room (matches checklist order)
  const labelNumbers = useMemo(() => {
    const ids = [...new Map(placed.map((p) => [p.item.id, p.item.name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id]) => id);
    const map: Record<string, number> = {};
    ids.forEach((id, i) => { map[id] = i + 1; });
    return map;
  }, [placed]);

  const applyPreset = (key: FillPresetKey) => {
    const preset = FILL_PRESETS[key];
    setPresetKey(key);
    setStatWeights({ ...EMPTY_WEIGHTS, ...preset.tristate });
    if (preset.autoIdolKey) {
      const idol = idols.find((i) => i.image_url.includes(preset.autoIdolKey!));
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

  const handleAutoFill = () => {
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
    setAutoFillOpen(false);
    const mustInclude = activeRoom === HOUSE_VIEW ? [] : [
      ...idols.filter((i) => selectedIdols.has(i.id)).map((i) => i.id),
      ...(includeFood && foodBox ? [foodBox.id] : []),
    ];
    onAutoPopulate({ weights: activeWeights, algorithm, mustInclude, minStats });
  };

  const IDOL_NOTES: Record<string, string> = {
    suppressoridol: 'Cats will NOT breed in this room',
    fightidol: 'Fights are deadlier; winner gets double stat rewards',
  };
  const idolNote = (item: FurnitureItem): string => {
    const key = Object.keys(IDOL_NOTES).find((k) => item.image_url.includes(k));
    return key ? IDOL_NOTES[key] : 'Stat idol';
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

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
    flexWrap: 'wrap',
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
      <div style={headerStyle}>
        <RoomStatsSummary
          rooms={rooms}
          activeRoom={activeRoom}
          onActiveRoomChange={onActiveRoomChange}
          ownership={ownership}
          isRoomUnlocked={isRoomUnlocked}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start', position: 'relative' }}>
          <button
            style={{
              ...smallBtn,
              background: autoFillOpen ? 'var(--accent-bg)' : 'var(--accent)',
              color: autoFillOpen ? 'var(--accent)' : 'var(--bg)',
              border: '1px solid var(--accent)',
              fontWeight: 600,
              padding: '6px 16px',
            }}
            onClick={() => setAutoFillOpen((v) => !v)}
            title="Automatically fill this room with owned furniture"
          >
            ✨ Auto-fill {autoFillOpen ? '\u25b4' : '\u25be'}
          </button>
          <button
            style={{ ...smallBtn, ...(labelsOn ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
            onClick={() => {
              setLabelsOn((v) => {
                if (!v) setChecklistOpen(true); // numbers need their legend
                return !v;
              });
            }}
            title="Show numbered labels on placed items; the checklist is the legend"
          >
            Labels
          </button>
          <button
            style={{ ...smallBtn, ...(checklistOpen ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}
            onClick={() => setChecklistOpen((v) => !v)}
            title="Tick off this room's items while placing them in the game"
          >
            Checklist
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
          {autoFillOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                onClick={() => setAutoFillOpen(false)}
              />
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 10,
                background: 'var(--code-bg)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 14,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 220,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)' }}>Preset</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(Object.keys(FILL_PRESETS) as FillPresetKey[]).map((key) => (
                    <button
                      key={key}
                      style={{
                        ...smallBtn,
                        fontSize: 11,
                        padding: '4px 8px',
                        ...(presetKey === key ? { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' } : {}),
                      }}
                      onClick={() => applyPreset(key)}
                      title={FILL_PRESETS[key].description}
                    >
                      {FILL_PRESETS[key].label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', marginTop: 2 }}>
                  Stats <span style={{ fontWeight: 400, color: 'var(--text-m)' }}>(click: maximize → avoid → off)</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {ALL_STATS.map((stat) => (
                    <div
                      key={stat}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}
                      onClick={() => cycleStat(stat)}
                    >
                      <span style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 12,
                        background: statWeights[stat] === 1 ? 'var(--accent)' : statWeights[stat] === -1 ? 'var(--charcoal)' : 'var(--social-bg)',
                        color: statWeights[stat] !== 0 ? '#fff' : 'var(--text-m)',
                      }}>
                        {statWeights[stat] === 1 ? '+' : statWeights[stat] === -1 ? '\u2212' : ''}
                      </span>
                      <StatIcon stat={stat} size={14} />
                      {STAT_LABELS[stat]}
                    </div>
                  ))}
                </div>
                {minStats?.comfort !== undefined && (
                  <div style={{ fontSize: 11, color: 'var(--text-m)' }}>
                    Keeps room Comfort ≥ {minStats.comfort} before maximizing.
                  </div>
                )}
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: foodBox ? 'var(--text)' : 'var(--text-m)', cursor: foodBox ? 'pointer' : 'not-allowed', marginTop: 2 }}
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
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', marginTop: 2 }}>Algorithm</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(Object.keys(ALGORITHMS) as AlgorithmKey[]).map((key) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} title={ALGORITHMS[key].description}>
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
                {idols.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', marginTop: 2 }}>
                      Idols (always placed)
                    </div>
                    {activeRoom === HOUSE_VIEW ? (
                      <div style={{ fontSize: 11, color: 'var(--text-m)' }}>
                        Open a single room to force idols into it.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {idols.map((idol) => (
                          <label key={idol.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} title={idolNote(idol)}>
                            <input
                              type="checkbox"
                              checked={selectedIdols.has(idol.id)}
                              onChange={() => toggleIdol(idol.id)}
                            />
                            {idol.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <button
                  style={{
                    ...smallBtn,
                    marginTop: 4,
                    opacity: hasPositiveWeight ? 1 : 0.5,
                    cursor: hasPositiveWeight ? 'pointer' : 'not-allowed',
                  }}
                  disabled={!hasPositiveWeight}
                  onClick={handleAutoFill}
                  title={hasPositiveWeight ? `Fill ${getRoomLabel(activeRoom)}` : 'Set at least one stat to maximize'}
                >
                  Fill {getRoomLabel(activeRoom)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div ref={linkRootRef} style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0, minWidth: 0 }}>
          {activeRoom === HOUSE_VIEW ? (
            <HouseView rooms={rooms} isRoomUnlocked={isRoomUnlocked} onSelectRoom={onActiveRoomChange} />
          ) : (
            <RoomGrid
              placed={placed}
              onPlace={onPlace}
              onRemove={onRemove}
              onMove={onMove}
              expertView={expertView}
              roomIndex={activeRoom}
              labelNumbers={labelsOn ? labelNumbers : null}
              hoverItemId={hoverItem}
              onHoverItem={setHoverItem}
            />
          )}
        </div>
        {checklistOpen && (
          <RoomChecklist
            placed={placed}
            roomIndex={activeRoom}
            numbers={labelsOn ? labelNumbers : null}
            hoverItemId={hoverItem}
            onHoverItem={setHoverItem}
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
