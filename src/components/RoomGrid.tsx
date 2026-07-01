import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import type { FurnitureItem, PlacedFurniture, RoomConfig } from '../types/furniture';
import { getRoomConfig } from '../types/furniture';
import { findAllAnchored, canPlaceGroup } from '../utils/anchorHelpers';
import { buildOccupancy, buildAnchorPointSet, canPlace, getVisualBounds, getImageAlignment } from '../utils/gridHelpers';
import { SVG_NEEDS_ROTATION } from '../utils/rotationAssets';

// Idols are identified by image_url containing 'special_*idol'
const IDOL_RE = /special_\w*(idol)/i;

function isIdol(item: FurnitureItem): boolean {
  return IDOL_RE.test(item.image_url);
}

function isFoodBox(item: FurnitureItem): boolean {
  return item.image_url.includes('special_foodbox');
}

function getTopAnchorOffset(shape: number[][]): number {
  let offset = 0;
  for (const row of shape) {
    if (row.every(c => c === 1 || c === 4)) offset++;
    else break;
  }
  return offset;
}

const CELL_COLORS: Record<number, string> = {
  1: 'transparent',
  2: 'var(--lavender-grey)',
  3: 'var(--blushed-brick)',
  4: 'var(--sand-dune)',
  5: 'var(--charcoal)',
};

const CELL_BORDERS: Record<number, string> = {
  2: 'rgba(132,143,165,0.5)',
  3: 'rgba(193,73,83,0.5)',
  4: 'rgba(229,220,197,0.5)',
  5: 'rgba(76,76,71,0.5)',
};

interface Props {
  placed: PlacedFurniture[];
  onPlace: (item: FurnitureItem, row: number, col: number) => void;
  onRemove: (instanceId: string) => void;
  onMove: (instanceId: string, row: number, col: number) => void;
  expertView: boolean;
  roomIndex?: number;
  /** itemId -> legend number; badges rendered when set. */
  labelNumbers?: Record<string, number> | null;
  /** Item type currently hovered (grid or checklist); matching pieces glow. */
  hoverItemId?: string | null;
  onHoverItem?: (id: string | null) => void;
  /** Click on a piece (cell-accurate): open its checklist entry. */
  onSelectItem?: (id: string) => void;
  /** When true, render checklist number badges. */
  checklistOpen?: boolean;
}

function buildShapeTypeGrid(placed: PlacedFurniture[], cfg: RoomConfig): (number | null)[][] {
  const grid: (number | null)[][] = Array.from({ length: cfg.rows }, () =>
    Array(cfg.cols).fill(null),
  );
  for (const p of placed) {
    const shape = p.item.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        const cellType = shape[r][c];
        if (cellType !== 1) {
          const gr = p.row + r;
          const gc = p.col + c;
          if (gr >= 0 && gr < cfg.rows && gc >= 0 && gc < cfg.cols) {
            grid[gr][gc] = cellType;
          }
        }
      }
    }
  }
  return grid;
}



type DragPayload =
  | { type: 'new'; item: FurnitureItem }
  | { type: 'move'; instanceId: string; item: FurnitureItem; grabDRow: number; grabDCol: number };

interface HoverInfo {
  shapes: { row: number; col: number; shape: number[][] }[];
  valid: boolean;
}

export default function RoomGrid({ placed, onPlace, onRemove, onMove, expertView, roomIndex = 0, labelNumbers, hoverItemId, onHoverItem, onSelectItem, checklistOpen = false }: Props) {
  const cfg = getRoomConfig(roomIndex);
  const { cols, rows } = cfg;

  const gridRef = useRef<HTMLDivElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState<{ w: number; h: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const dragPayloadRef = useRef<DragPayload | null>(null);

  // Measure available space and fit the grid with square cells.
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const aspect = cols / rows;
      let w: number, h: number;
      if (rect.width / rect.height > aspect) {
        h = rect.height;
        w = h * aspect;
      } else {
        w = rect.width;
        h = w / aspect;
      }
      setGridSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cols, rows]);

  const occupancy = buildOccupancy(placed, cfg);
  const anchorPoints = buildAnchorPointSet(placed, cfg);

  // Overlay divs are bounding boxes; L-shapes leave free cells inside them.
  // Resolve every pointer event to the piece actually occupying the cell.
  const pieceAtEvent = (e: { clientX: number; clientY: number }): PlacedFurniture | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / (rect.width / cols));
    const row = Math.floor((e.clientY - rect.top) / (rect.height / rows));
    if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
    const id = occupancy[row]?.[col];
    if (!id) return null;
    return placed.find((pl) => pl.instanceId === id) ?? null;
  };
  const shapeTypeGrid = expertView ? buildShapeTypeGrid(placed, cfg) : null;

  const getCellFromEvent = useCallback((e: DragEvent): { row: number; col: number } | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const cellW = rect.width / cols;
    const cellH = rect.height / rows;
    const col = Math.floor((e.clientX - rect.left) / cellW);
    const row = Math.floor((e.clientY - rect.top) / cellH);
    if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
    return { row, col };
  }, [cols, rows]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragPayloadRef.current?.type === 'move' ? 'move' : 'copy';
    const cell = getCellFromEvent(e);
    const payload = dragPayloadRef.current;
    if (!cell || !payload) {
      setHoverInfo(null);
      return;
    }

    if (payload.type === 'move') {
      const target = placed.find(p => p.instanceId === payload.instanceId);
      if (!target) { setHoverInfo(null); return; }
      const anchoredIds = findAllAnchored(payload.instanceId, placed);
      const groupIds = new Set([payload.instanceId, ...anchoredIds]);

      const placeRow = cell.row - payload.grabDRow;
      const placeCol = cell.col - payload.grabDCol;
      const dRow = placeRow - target.row;
      const dCol = placeCol - target.col;

      const movedGroup = placed
        .filter(p => groupIds.has(p.instanceId))
        .map(p => ({ item: p.item, row: p.row + dRow, col: p.col + dCol }));

      const occ = buildOccupancy(placed, cfg, undefined, groupIds);
      const ap = buildAnchorPointSet(placed, cfg, undefined, groupIds);
      const valid = canPlaceGroup(movedGroup, occ, ap, cfg);

      const shapes = movedGroup.map(p => ({ row: p.row, col: p.col, shape: p.item.shape }));
      setHoverInfo({ shapes, valid });
    } else {
      const off = getTopAnchorOffset(payload.item.shape);
      const placeRow = cell.row - off;
      const valid = canPlace(payload.item, placeRow, cell.col, occupancy, anchorPoints, cfg);
      setHoverInfo({ shapes: [{ row: placeRow, col: cell.col, shape: payload.item.shape }], valid });
    }
  }, [getCellFromEvent, occupancy, anchorPoints, placed, cfg]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!gridRef.current?.contains(e.relatedTarget as Node)) {
      setHoverInfo(null);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setHoverInfo(null);
    const cell = getCellFromEvent(e);
    if (!cell) return;

    const payload = dragPayloadRef.current;

    if (payload?.type === 'move') {
      const target = placed.find(p => p.instanceId === payload.instanceId);
      if (!target) { dragPayloadRef.current = null; return; }
      const anchoredIds = findAllAnchored(payload.instanceId, placed);
      const groupIds = new Set([payload.instanceId, ...anchoredIds]);

      const placeRow = cell.row - payload.grabDRow;
      const placeCol = cell.col - payload.grabDCol;
      const dRow = placeRow - target.row;
      const dCol = placeCol - target.col;

      const movedGroup = placed
        .filter(p => groupIds.has(p.instanceId))
        .map(p => ({ item: p.item, row: p.row + dRow, col: p.col + dCol }));

      const occ = buildOccupancy(placed, cfg, undefined, groupIds);
      const ap = buildAnchorPointSet(placed, cfg, undefined, groupIds);

      if (canPlaceGroup(movedGroup, occ, ap, cfg)) {
        onMove(payload.instanceId, placeRow, placeCol);
      }
      dragPayloadRef.current = null;
      return;
    }

    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) return;
      const item: FurnitureItem = JSON.parse(data);
      const off = getTopAnchorOffset(item.shape);
      const placeRow = cell.row - off;
      if (canPlace(item, placeRow, cell.col, occupancy, anchorPoints, cfg)) {
        onPlace(item, placeRow, cell.col);
      }
    } catch { /* ignore */ }
    dragPayloadRef.current = null;
  }, [getCellFromEvent, occupancy, anchorPoints, placed, onPlace, onMove, cfg]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as FurnitureItem;
      dragPayloadRef.current = { type: 'new', item: detail };
    };
    window.addEventListener('furniture-drag-start', handler);
    return () => window.removeEventListener('furniture-drag-start', handler);
  }, []);

  const hoverSet = new Set<string>();
  if (hoverInfo) {
    for (const s of hoverInfo.shapes) {
      for (let r = 0; r < s.shape.length; r++) {
        for (let c = 0; c < s.shape[r].length; c++) {
          const t = s.shape[r][c];
          if (t !== 1 && t !== 4) {
            hoverSet.add(`${s.row + r}-${s.col + c}`);
          }
        }
      }
    }
  }

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handlePieceDragStart = useCallback((e: DragEvent, p: PlacedFurniture) => {
    // Record where on the item the user grabbed (offset from anchor cell)
    let grabDRow = 0, grabDCol = 0;
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const cellW = rect.width / cols;
      const cellH = rect.height / rows;
      const cursorCol = Math.floor((e.clientX - rect.left) / cellW);
      const cursorRow = Math.floor((e.clientY - rect.top) / cellH);
      grabDRow = cursorRow - p.row;
      grabDCol = cursorCol - p.col;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.instanceId);
    dragPayloadRef.current = { type: 'move', instanceId: p.instanceId, item: p.item, grabDRow, grabDCol };
    setDraggingId(p.instanceId);
  }, [cols]);

  const handlePieceDragEnd = useCallback(() => {
    setDraggingId(null);
    setHoverInfo(null);
    dragPayloadRef.current = null;
  }, []);

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    width: gridSize ? gridSize.w : '100%',
    height: gridSize ? gridSize.h : 'auto',
    aspectRatio: gridSize ? undefined : `${cols} / ${rows}`,
    background: 'transparent',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  };

  const cellBase: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  // Numbered legend badges — only when the checklist panel is open
  const labelOverlays = labelNumbers && checklistOpen
    ? placed.map((p) => {
        const { minR, minC, maxC } = getVisualBounds(p.item.shape);
        const n = labelNumbers[p.item.id];
        if (!n || hoverItemId === p.item.id) return null;
        const touchesCeiling = (p.row + minR) === 0;
        const touchesLeftWall = (p.col + minC) === 0;
        let labelLeft: string, labelTop: string;
        let labelTransform: string | undefined;
        if (touchesCeiling && touchesLeftWall) {
          labelLeft = `calc(${((p.col + maxC + 1) / cols) * 100}% + 2px)`;
          labelTop = `calc(${((p.row + minR) / rows) * 100}% + 2px)`;
        } else if (touchesCeiling) {
          labelLeft = `${((p.col + minC) / cols) * 100}%`;
          labelTop = `calc(${((p.row + minR) / rows) * 100}% + 2px)`;
          labelTransform = 'translateX(calc(-100% - 2px))';
        } else {
          labelLeft = `calc(${((p.col + minC) / cols) * 100}% + 2px)`;
          labelTop = `calc(${((p.row + minR) / rows) * 100}% + 2px)`;
        }
        return (
          <div
            key={`label-${p.instanceId}`}
            style={{
              position: 'absolute',
              left: labelLeft,
              top: labelTop,
              transform: labelTransform,
              zIndex: 500,
              background: 'rgba(0,0,0,0.7)',
              color: '#fff',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              padding: '0 5px',
              lineHeight: '15px',
              pointerEvents: 'none',
            }}
            title={p.item.name}
          >
            {n}
          </div>
        );
      })
    : null;

  // Image overlays for normal view — sorted by row (ascending) so items closer to the viewer (higher row) render on top;
  // column tiebreaker keeps rendering order deterministic for items on the same row.
  const sortedPlaced = useMemo(() => [...placed].sort((a, b) => a.row - b.row || a.col - b.col), [placed]);
  const imageOverlays = !expertView
    ? sortedPlaced.map((p) => {
const { minR, maxR, minC, maxC } = getVisualBounds(p.item.shape);
        const visualRows = maxR - minR + 1;
        const visualCols = maxC - minC + 1;
        const anchorAlign = getImageAlignment(p.item.shape);
        const needsRotation = SVG_NEEDS_ROTATION.has(p.item.image_url);

        const fixedSrc = p.item.image_url.startsWith('public/')
          ? p.item.image_url.slice(6)
          : p.item.image_url;

        const left = `${((p.col + minC) / cols) * 100}%`;
        const top = `${((p.row + minR) / rows) * 100}%`;
        const width = `${(visualCols / cols) * 100}%`;
        const height = `${(visualRows / rows) * 100}%`;
        const isDragging = draggingId === p.instanceId;

        const isHovered = hoverItemId === p.item.id;
        return (
          <div
            key={p.instanceId}
            data-piece-id={p.item.id}
            draggable
            onDragStart={(e) => {
              const t = pieceAtEvent(e);
              // Fall back to p from closure when cursor is on an empty bounding-box cell (L/T/I shapes)
              handlePieceDragStart(e, t ?? p);
            }}
            onDragEnd={handlePieceDragEnd}
            onMouseMove={(e) => onHoverItem?.(pieceAtEvent(e)?.item.id ?? null)}
            onMouseLeave={() => onHoverItem?.(null)}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              zIndex: 2 + p.row + (isHovered ? 100 : 0),
              borderRadius: 3,
              cursor: 'grab',
              opacity: isDragging ? 0.3 : 1,
              transition: 'opacity 0.15s',
              overflow: 'visible',
              display: 'flex',
              alignItems: anchorAlign === 'bottom' ? 'flex-end' : anchorAlign === 'top' ? 'flex-start' : 'center',
              justifyContent: 'center',
            }}
            title={`${p.item.name} \u2014 drag to move \u00b7 click for checklist \u00b7 right-click to remove`}
            onClick={(e) => {
              const t = pieceAtEvent(e);
              onSelectItem?.((t ?? p).item.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const t = pieceAtEvent(e);
              onRemove((t ?? p).instanceId);
            }}
          >
            {needsRotation ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                <img
                  src={fixedSrc}
                  alt={p.item.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: 'translate(-50%, -50%) rotate(90deg) scale(1.333)',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
                  }}
                />
              </div>
            ) : (
              <img
                src={fixedSrc}
                alt={p.item.name}
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  objectPosition: anchorAlign === 'top' ? 'center top' : anchorAlign === 'bottom' ? 'center bottom' : 'center',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
                }}
              />
            )}
            {isHovered && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.75)',
                borderRadius: 4,
                padding: '3px 6px',
                pointerEvents: 'none',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
              }}>
                {p.item.appeal ? <span style={{ color: '#e06070', fontSize: 9, lineHeight: 1.2 }}>A:{p.item.appeal}</span> : null}
                {p.item.comfort ? <span style={{ color: '#7ab8d4', fontSize: 9, lineHeight: 1.2 }}>C:{p.item.comfort}</span> : null}
                {p.item.stimulation ? <span style={{ color: '#d4b87a', fontSize: 9, lineHeight: 1.2 }}>S:{p.item.stimulation}</span> : null}
                {p.item.health ? <span style={{ color: '#7ad48a', fontSize: 9, lineHeight: 1.2 }}>H:{p.item.health}</span> : null}
                {p.item.mutation ? <span style={{ color: '#c87ad4', fontSize: 9, lineHeight: 1.2 }}>M:{p.item.mutation}</span> : null}
              </div>
            )}
          </div>
        );
      })
    : null;

  // Draggable overlays for expert view
  const expertDragOverlays = expertView
    ? sortedPlaced.map((p) => {
        const shape = p.item.shape;
        let minR = shape.length, maxR = -1, minC = shape[0]?.length ?? 0, maxC = -1;
        for (let r = 0; r < shape.length; r++) {
          for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c] !== 1) {
              if (r < minR) minR = r;
              if (r > maxR) maxR = r;
              if (c < minC) minC = c;
              if (c > maxC) maxC = c;
            }
          }
        }
        if (maxR === -1) return null;

        const left = `${((p.col + minC) / cols) * 100}%`;
        const top = `${((p.row + minR) / rows) * 100}%`;
        const width = `${((maxC - minC + 1) / cols) * 100}%`;
        const height = `${((maxR - minR + 1) / rows) * 100}%`;
        const isDragging = draggingId === p.instanceId;

        return (
          <div
            key={`expert-drag-${p.instanceId}`}
            draggable
            onDragStart={(e) => {
              const t = pieceAtEvent(e);
              handlePieceDragStart(e, t ?? p);
            }}
            onDragEnd={handlePieceDragEnd}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              zIndex: 3 + p.row,
              cursor: 'grab',
              opacity: isDragging ? 0.3 : 1,
              background: 'transparent',
            }}
            title={`${p.item.name} \u2014 drag to move \u00b7 click for checklist \u00b7 right-click to remove`}
            onClick={(e) => {
              const t = pieceAtEvent(e);
              onSelectItem?.((t ?? p).item.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const t = pieceAtEvent(e);
              onRemove((t ?? p).instanceId);
            }}
          />
        );
      })
    : null;

  return (
    <div ref={gridWrapRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflow: 'hidden' }}>
    <div
      ref={gridRef}
      style={gridStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => {
          const key = `${row}-${col}`;
          const valid = cfg.isValidCell(row, col);

          if (!valid) {
            return (
              <div
                key={key}
                style={{
                  ...cellBase,
                  background: 'transparent',
                  border: '1px solid transparent',
                }}
              />
            );
          }

          const shapeType = shapeTypeGrid?.[row][col];
          let bg = 'var(--code-bg)';
          if (expertView && shapeType) {
            bg = CELL_COLORS[shapeType] || 'var(--code-bg)';
          }

          let borderColor = 'var(--border)';
          if (expertView && shapeType && shapeType !== 1) {
            borderColor = CELL_BORDERS[shapeType] || 'var(--border)';
          }

          return (
            <div
              key={key}
              style={{
                ...cellBase,
                background: bg,
                border: `1px solid ${borderColor}`,
              }}
            />
          );
        }),
      )}
      {/* Idol cell overlays */}
      {!expertView && placed.filter((p) => isIdol(p.item)).flatMap((p) =>
        p.item.shape.flatMap((shapeRow, r) =>
          shapeRow.map((t, c) => {
            if (t !== 2 && t !== 3) return null;
            const gr = p.row + r;
            const gc = p.col + c;
            if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return null;
            return (
              <div key={`idol-${p.instanceId}-${r}-${c}`} style={{
                position: 'absolute',
                left: `${(gc / cfg.cols) * 100}%`,
                top: `${(gr / cfg.rows) * 100}%`,
                width: `${(1 / cfg.cols) * 100}%`,
                height: `${(1 / cfg.rows) * 100}%`,
                background: 'rgba(255, 160, 0, 0.25)',
                border: '1px solid rgba(255, 160, 0, 0.5)',
                borderRadius: 2,
                zIndex: 1,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }} />
            );
          }),
        ),
      )}
      {/* Food box cell overlays */}
      {!expertView && placed.filter((p) => isFoodBox(p.item)).flatMap((p) =>
        p.item.shape.flatMap((shapeRow, r) =>
          shapeRow.map((t, c) => {
            if (t !== 2 && t !== 3) return null;
            const gr = p.row + r;
            const gc = p.col + c;
            if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return null;
            return (
              <div key={`food-${p.instanceId}-${r}-${c}`} style={{
                position: 'absolute',
                left: `${(gc / cfg.cols) * 100}%`,
                top: `${(gr / cfg.rows) * 100}%`,
                width: `${(1 / cfg.cols) * 100}%`,
                height: `${(1 / cfg.rows) * 100}%`,
                background: 'rgba(33, 150, 243, 0.25)',
                border: '1px solid rgba(33, 150, 243, 0.5)',
                borderRadius: 2,
                zIndex: 1,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }} />
            );
          }),
        ),
      )}
      {imageOverlays}
      {labelOverlays}
      {expertDragOverlays}
      {/* Hover highlight overlay */}
      {hoverInfo && Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => {
          const key = `hover-${row}-${col}`;
          if (!hoverSet.has(`${row}-${col}`)) return null;
          const valid = hoverInfo.valid;
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                left: `${(col / cols) * 100}%`,
                top: `${(row / rows) * 100}%`,
                width: `${(1 / cols) * 100}%`,
                height: `${(1 / rows) * 100}%`,
                background: valid
                  ? 'rgba(100,200,100,0.35)'
                  : 'rgba(200,100,100,0.35)',
                border: `2px solid ${valid ? 'rgba(100,200,100,0.7)' : 'rgba(200,100,100,0.7)'}`,
                zIndex: 100,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
          );
        }),
      )}
    </div>
    </div>
  );
}
