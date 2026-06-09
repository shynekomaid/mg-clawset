import { useState, useMemo, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { Filters, SortConfig, SortField, FurnitureItem, RawFurnitureItem, PlacedFurniture } from './types/furniture';
import { getRoomConfig } from './types/furniture';
import furnitureData from './data/furniture_data.json';
import SplitScreenContainer from './components/SplitScreenContainer';
import FurnitureBrowser from './components/FurnitureBrowser';
import RoomDesignerWorkspace from './components/RoomDesignerWorkspace';
import SaveImportModal from './components/SaveImportModal';
import { findAllAnchored, findAnchoredPieces, wouldCollide } from './utils/anchorHelpers';
import { autoPopulateRoom } from './utils/autoPopulate';
import type { PresetKey, AlgorithmKey } from './utils/autoPopulate';
import useIsMobile from './hooks/useIsMobile';

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
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sort, setSort] = useState<SortConfig>(defaultSort);
  const [ownership, setOwnership] = useState<Record<string, number>>(loadOwnership);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [rooms, setRooms] = useState<PlacedFurniture[][]>(loadRooms);
  const [activeRoom, setActiveRoom] = useState(0);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [statsPerSpace, setStatsPerSpace] = useState(false);

  const placed = rooms[activeRoom];

  // Force collapse room designer on mobile
  useEffect(() => {
    if (isMobile && expanded) setExpanded(false);
  }, [isMobile, expanded]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ownership));
  }, [ownership]);

  useEffect(() => {
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  }, [rooms]);

  const updateActiveRoom = useCallback((updater: (prev: PlacedFurniture[]) => PlacedFurniture[]) => {
    setRooms(prev => prev.map((room, i) => i === activeRoom ? updater(room) : room));
  }, [activeRoom]);

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

  const handleAutoPopulate = useCallback((preset: PresetKey, algorithm: AlgorithmKey) => {
    const usedInOtherRooms: Record<string, number> = {};
    rooms.forEach((room, i) => {
      if (i === activeRoom) return;
      for (const p of room) {
        usedInOtherRooms[p.item.id] = (usedInOtherRooms[p.item.id] || 0) + 1;
      }
    });
    const result = autoPopulateRoom({
      preset,
      algorithm,
      roomIndex: activeRoom,
      allFurniture,
      ownership,
      usedInOtherRooms,
      makeInstanceId: () => `placed-${nextInstanceId++}`,
    });
    if (result.length === 0) {
      window.alert('Nothing to place: no owned furniture with remaining copies scores positively for this preset.');
      return;
    }
    setRooms(prev => prev.map((room, i) => (i === activeRoom ? result : room)));
  }, [rooms, activeRoom, ownership]);

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

  const handleImportOwnership = useCallback((newOwnership: Record<string, number>) => {
    setOwnership(newOwnership);
  }, []);

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
    setRooms(newRooms);
    setActiveRoom(0);
  }, []);

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
      ...(isMobile ? { height: 'auto', minHeight: '100vh', overflow: 'visible' } : {}),
    }}>
      <SplitScreenContainer>
        <div
          style={{
            ...layoutStyles.browserWrapper,
            width: isMobile ? '100%' : expanded ? '45%' : 'calc(100% - 24px)',
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
            expanded={expanded}
            onToggle={() => setExpanded((prev) => !prev)}
            page={clampedPage}
            totalPages={totalPages}
            onPageChange={setPage}
            onImportClick={() => setImportModalOpen(true)}
            isMobile={isMobile}
            statsPerSpace={statsPerSpace}
            onStatsPerSpaceChange={setStatsPerSpace}
            usedCounts={usedCounts}
          />
        </div>
        {!isMobile && (
          <RoomDesignerWorkspace
            visible={expanded}
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
          />
        )}
      </SplitScreenContainer>
      <SaveImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportOwnership}
        furnitureIdMap={furnitureIdMap}
      />
    </div>
  );
}

export default App;
