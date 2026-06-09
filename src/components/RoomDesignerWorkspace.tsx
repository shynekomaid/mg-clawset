import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import RoomGrid from './RoomGrid';
import RoomStatsSummary from './RoomStatsSummary';
import { getRoomLabel } from '../types/furniture';
import { captureRoom, captureHouse } from '../utils/roomCapture';
import { PRESETS, ALGORITHMS } from '../utils/autoPopulate';
import type { PresetKey, AlgorithmKey } from '../utils/autoPopulate';

const LEGEND: { type: number; color: string; border: string; label: string }[] = [
  { type: 2, color: 'var(--lavender-grey)', border: 'rgba(132,143,165,0.5)', label: 'Solid' },
  { type: 3, color: 'var(--blushed-brick)', border: 'rgba(193,73,83,0.5)', label: 'Anchor Point' },
  { type: 4, color: 'var(--sand-dune)', border: 'rgba(229,220,197,0.5)', label: 'Anchor' },
  { type: 5, color: 'var(--charcoal)', border: 'rgba(76,76,71,0.5)', label: 'Background' },
];

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
  onAutoPopulate: (preset: PresetKey, algorithm: AlgorithmKey) => void;
  ownership: Record<string, number>;
}

export default function RoomDesignerWorkspace({
  visible, placed, rooms, activeRoom, onActiveRoomChange,
  onPlace, onRemove, onMove, onImportRooms, onAutoPopulate, ownership,
}: Props) {
  const [expertView, setExpertView] = useState(false);
  const [preset, setPreset] = useState<PresetKey>('breeding');
  const [algorithm, setAlgorithm] = useState<AlgorithmKey>('maximize');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAutoFill = () => {
    if (
      placed.length > 0 &&
      !window.confirm(`Replace ${placed.length} item(s) in ${getRoomLabel(activeRoom)} with an auto-generated ${PRESETS[preset].label} layout?`)
    ) {
      return;
    }
    onAutoPopulate(preset, algorithm);
  };

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--code-bg)',
    borderRadius: 16,
    border: '1px solid var(--border)',
    marginLeft: 16,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    transition: 'flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), margin-left 0.4s cubic-bezier(0.4, 0, 0.2, 1), padding 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    flex: visible ? '1 1 0%' : '0 0 0%',
    opacity: visible ? 1 : 0,
    ...(visible ? {} : { marginLeft: 0, border: 'none' }),
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
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetKey)}
            style={{ ...smallBtn, padding: '5px 8px' }}
            title="Auto-fill preset"
          >
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
              <option key={key} value={key}>{PRESETS[key].label}</option>
            ))}
          </select>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as AlgorithmKey)}
            style={{ ...smallBtn, padding: '5px 8px' }}
            title={ALGORITHMS[algorithm].description}
          >
            {(Object.keys(ALGORITHMS) as AlgorithmKey[]).map((key) => (
              <option key={key} value={key} title={ALGORITHMS[key].description}>{ALGORITHMS[key].label}</option>
            ))}
          </select>
          <button style={smallBtn} onClick={handleAutoFill} title="Automatically fill this room with owned furniture">
            Auto-fill
          </button>
          <button style={toggleBtn} onClick={() => setExpertView((v) => !v)}>
            {expertView ? 'Image View' : 'Expert View'}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
        <RoomGrid
          placed={placed}
          onPlace={onPlace}
          onRemove={onRemove}
          onMove={onMove}
          expertView={expertView}
          roomIndex={activeRoom}
        />
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
          <button style={smallBtn} onClick={() => captureRoom(rooms, activeRoom)} title={`Save image of ${getRoomLabel(activeRoom)}`}>
            Save image of {getRoomLabel(activeRoom)}
          </button>
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
