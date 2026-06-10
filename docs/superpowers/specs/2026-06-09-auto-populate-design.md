# Auto-Populate Room Designer — Design Spec

Date: 2026-06-09
Status: Approved

## Goal

Add an "Auto-fill" feature to the room designer that automatically populates
the active room with owned furniture, optimizing for one of three presets:

- **Breeding** — highest comfort + highest stimulation
- **Storage** — moderate comfort + health + low stimulation
- **Mutation** — moderate comfort + highest mutation

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Furniture pool | Owned items only, minus copies already placed in other rooms ("remaining") |
| Non-empty room | Confirm dialog, then wipe and fill fresh |
| Preset semantics | Weighted stat score per item |
| Algorithm | Greedy first-fit (deterministic, instant) |

## Preset Weights

```
score(item) = Σ weight[stat] × item[stat]

breeding: { comfort: 1.0, stimulation: 1.0 }
storage:  { comfort: 0.5, health: 1.0, stimulation: -1.0 }
mutation: { comfort: 0.5, mutation: 1.0 }
```

Items with score ≤ 0 are never placed.

## Architecture

### 1. `src/utils/gridHelpers.ts` (extraction, no behavior change)

Move from `RoomGrid.tsx` (currently module-private):

- `buildOccupancy(placed, cfg, ignoreId?, ignoreIds?)`
- `buildAnchorPointSet(placed, cfg, ignoreId?, ignoreIds?)` — includes floor
  anchors (`row === cfg.rows`) and ceiling anchors (`row === -1` when
  `cfg.hasTopAnchors`)
- `canPlace(item, row, col, occupancy, anchorPointSet, cfg)`

`RoomGrid.tsx` imports these. Auto-populate uses the same functions, so
automatic placement obeys exactly the same rules as manual drag placement.

### 2. `src/utils/autoPopulate.ts` (new, pure logic)

```ts
export type PresetKey = 'breeding' | 'storage' | 'mutation';
export const PRESETS: Record<PresetKey, { label: string; weights: Partial<Record<StatKey, number>> }>;

export function autoPopulateRoom(opts: {
  preset: PresetKey;
  roomIndex: number;                       // getRoomConfig handles attic
  allFurniture: FurnitureItem[];
  ownership: Record<string, number>;
  usedInOtherRooms: Record<string, number>; // item.id -> count
  makeInstanceId: () => string;
}): PlacedFurniture[];
```

Algorithm:

1. Candidates: items where `(ownership[id] ?? 0) − (usedInOtherRooms[id] ?? 0) > 0`
   and weighted score > 0. Sort by score-per-occupied-space desc; ties by
   total score desc, then name asc (deterministic).
2. Loop over candidates best-first. For the current best item, scan the grid
   top-left → bottom-right (offsets that allow anchors above row 0 included:
   start row at `-shapeHeight`); place at first position where `canPlace`
   passes. On placement: decrement remaining, update occupancy and anchor-point
   set incrementally, then restart from the best candidate (new anchor points
   may unlock anchored items).
3. If an item has no valid position, drop it from the candidate list.
4. Stop when candidate list is empty.

Complexity: O(items × cells × shape) per placement round — instant for
16×7 / 31×8 grids and ~hundreds of items.

### 3. UI — `RoomDesignerWorkspace.tsx`

- Header row gains: preset `<select>` (Breeding / Storage / Mutation) +
  "Auto-fill" button, placed next to the Expert View toggle.
- Acts on the active room (existing room selector = room choice).
- If active room non-empty: `window.confirm("Replace N items in <room>?")`.
- If result is empty (no owned furniture fits / none remaining):
  `window.alert` explaining nothing could be placed; room left untouched.

### 4. `App.tsx`

New callback `handleAutoPopulate(preset: PresetKey)`:

- Computes `usedInOtherRooms` (usedCounts minus active room's contribution).
- Calls `autoPopulateRoom`, replaces `rooms[activeRoom]` with result.
- Passes down to `RoomDesignerWorkspace`.

## Error Handling

- No candidates / nothing fits → alert, no state change.
- Confirm declined → no state change.
- All placement validity delegated to shared `canPlace` — no new invariants.

## Testing

Repo has no test infra. Add `vitest` (dev dep only, no config beyond
`vite.config.ts` test block or standalone) and unit-test `autoPopulateRoom`:

- never exceeds remaining counts
- no overlapping solid cells; all placements pass `canPlace`
- respects attic cell validity (roomIndex 4)
- anchored items only placed when anchor support exists
- preset weight ordering: breeding room outranks storage preset on
  comfort+stim total, storage avoids positive-stimulation items, etc.
- empty pool → empty result

UI layer untested (matches repo status quo).

## Out of Scope

- Optimal packing (NP-hard), multi-start randomization, local search
- Fill-around-existing-furniture mode
- Custom user weights / sliders
- Mobile UI (room designer hidden on mobile already)

## Addendum (2026-06-09): Algorithm choice

User feedback: greedy first-fit leaves too many holes. Added user-selectable
algorithm next to the preset dropdown:

- **Quick** (`greedy`) — original deterministic greedy first-fit.
- **Maximize** (`maximize`, default) — multi-start randomized greedy (jittered
  ordering, random scan directions) plus ruin-and-recreate local search
  (remove ~30% incl. anchor cascades, refill), under a ~400ms time budget.
  Keeps the highest-scoring layout (ties: more cells filled). Never worse than
  greedy (greedy run is the baseline candidate). Seeded RNG + fixed iteration
  count give reproducible results in tests; UI uses time-based budget, so each
  click can re-roll a different layout.

Measured in app: same pool filled 92/112 cells (Quick) vs 108/112 (Maximize).

## Addendum (2026-06-10): Stat selection + grouped UX

User feedback: presets too generic; controls felt disconnected.

- Presets replaced by free stat selection: checkboxes for Appeal, Comfort,
  Stimulation, Health, Mutation (equal weight, sum of selected stats;
  score ≤ 0 still never placed). API: `stats: StatKey[]` replaces `preset`.
- UI consolidated into one "Auto-fill ▾" button opening a popover panel:
  stat checkboxes (with stat icons), Quick/Maximize radio, "Fill <room>"
  button (disabled when no stat selected). Outside click closes panel.
