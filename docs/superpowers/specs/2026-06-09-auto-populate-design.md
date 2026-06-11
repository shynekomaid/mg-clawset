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

## Addendum (2026-06-10): Onboarding & game-companion UX

- Welcome modal shows once (dismissal persisted in `mg-clawset-welcome-seen`);
  cat logo reopens it. Modal gains a primary "Load savegame" CTA that opens
  the savefile import dialog.
- Room designer is open by default on desktop; savegame import auto-enables
  the "Owned" filter so the list shows what the player actually has.
- Attic is the default active room.
- Auto-fill is the visually primary (accent) button in the designer header.
- New "Checklist" panel: aggregated items of the active room (icon, count,
  name) with persisted tick-off state (`mg-clawset-checklist`) and an
  "n of m placed in game" progress line — for transferring layouts into
  Mewgenics.
- New "Focus" mode: hides the furniture browser entirely (full-width
  designer) for playing alongside the game; "Exit focus" restores it.

## Addendum (2026-06-10, #2): Room-first layout redesign

User feedback: UI was browser-first with the USP (room filler) hidden in a
side panel; welcome modal was a text wall with buried actions.

- First run: minimal **hero screen** — logo, one-line pitch, primary
  "Load savegame", secondary "Browse without a save". Shown once
  (`mg-clawset-hero-seen`). All how-to text lives behind the cat icon.
- New persistent **header bar**: cat mascot (help), title, always-visible
  "Load / Re-load savegame" button.
- **Room designer is the main view** on desktop, always visible.
- **Furniture browser demoted to a collapsible left drawer** (~460px,
  compact cards). Defaults: open with full catalog when no ownership
  (theorycrafters); closed with "Owned" filter active when a collection
  exists. Toggled via "◂ Furniture" in the designer or the edge arrow.
- "Focus" mode removed — closing the drawer is the same thing.
- Mobile keeps the original browser-only experience (designer needs
  drag-and-drop); the one-time welcome modal still auto-opens there.

## Addendum (2026-06-10, #3): Remembered savefile (one-click re-sync)

- Savefile parsing extracted to `src/utils/savegame.ts` (shared by modal and
  silent reload).
- `src/utils/savefileHandle.ts`: stores the FileSystemFileHandle from
  `showOpenFilePicker` in IndexedDB (`mg-clawset/file-handles`). Chromium
  only; Firefox/Safari keep the classic file input.
- Modal file selection uses the FSA picker when available and reports the
  handle up; App persists it and shows the filename in the header tooltip.
- Header "Re-load savegame": queries/requests read permission on the stored
  handle, re-reads the file from disk, re-imports ownership — one click.
  Any failure (no handle, permission denied, file moved) falls back to the
  import dialog.

## Addendum (2026-06-10, #4): Savefile picker fix, right drawer, house view

- **Picker fix**: Chrome's File System Access picker blocklists %APPDATA%,
  where Mewgenics saves live ("can't open this file… system files"). Modal
  reverted to the classic file input, plus a drag-and-drop zone — dropped
  files yield handles via `DataTransferItem.getAsFileSystemHandle()` even
  from blocklisted paths, so dragging the .sav once still enables one-click
  re-load.
- **Drawer moved to the right**: designer left, furniture drawer right;
  opens via "Furniture ▸" button or a slim slide tab on the right edge;
  closes via the drawer's left-edge arrow or "Hide furniture".
- **Room unlock detection**: `files.house_unlocks` in the savegame is parsed
  (current house + unlock entries; every non-attic entry = one regular
  room). Locked rooms show greyed with a lock in the summary and house
  view, and are skipped by auto-fill. Persisted in
  `mg-clawset-house-unlocks`.
- **House view**: the "House" summary row is selectable and shows all rooms
  in the game's arrangement (attic top, Room 4/3, Room 1/2 — same as the
  image export). Clicking a mini room opens it. Auto-fill in house view
  fills the whole house attic-first with cross-room remaining accounting;
  "Save image of a house" is the capture action.
- Discovered for later: `files.house_state` contains the in-game furniture
  placements (room name + coordinates) — could power "import current
  layout from save".

## Addendum (2026-06-10, #5): Item labels, import options, idols

- **Labels**: "Labels" toggle overlays numbered badges on placed items
  (both views); numbers match the checklist, which auto-opens as the
  legend. Hover tooltips with full names already existed. Chosen over
  always-on name overlays: 60+ items would be unreadable; number + legend
  is the map-key pattern.
- **Import options**: dialog checkboxes for "Owned furniture counts" and
  "Unlocked rooms" (Import disabled when neither). "Current room layouts"
  shown disabled: house_state placement keys (438–624) do not join the
  furniture table keys (1–150), so item identity per placement is not yet
  decodable. Crackable later with a controlled save.
- **Idols**: special furniture (wiki "Special Furniture") selectable in the
  auto-fill panel ("Idols — always placed"). Selected idols are forced
  into the layout via new `mustInclude` option: bypasses the score filter
  (e.g. Idol of Chaos, −5 comfort), placed once each, survives
  ruin-and-recreate. Chastity/Chaos behavioral notes shown as tooltips.
  House-wide fill: idols disabled with a hint to fill a single room.

## Addendum (2026-06-10, #6): Hover linking + house view images

- Bidirectional hover: hovering a checklist row highlights all matching
  placed pieces (outline + tinted, badge turns accent); hovering a placed
  piece highlights its checklist row and scrolls it into view.
- Thin dashed connector lines (SVG overlay across the grid+checklist
  container) drawn from the hovered checklist row to every matching piece;
  measured via data attributes + getBoundingClientRect in a rAF.
- House view mini rooms now render actual furniture images (same placement
  math as the room grid) instead of expert-style colored cells — it looked
  like expert view had been force-enabled. Visual-bounds helpers moved to
  gridHelpers.ts (also fixes react-refresh lint).

## Addendum (2026-06-10, #7): Room layout import — format cracked

Controlled save (single crystal ball at attic bottom-left) revealed the
placement encoding. It lives in the `furniture` table, not `house_state`
(that one is the visual storage pile):

```
furniture.data blob:
  int32 field1, int32 name_len, int32 pad, name,
  int64 quality (0 normal / 2 rare),
  int64 room_len + room name ("" = stored, e.g. "Attic", "Floor1_Small"),
  int32 x, int32 y (bottom-left solid cell), int32 stack-order, ...
```

Coordinate mapping (derived from crystal ball (-8,-10)=attic col0,row7 and
six food boxes (-10, -11..-6)=Floor1_Small col0, rows 6..1):

- regular rooms: col = x + 10, row = −y − 5
- attic:         col = x + 8,  row = −y − 3

Room name → app index: Floor1_Large=Room1, Floor1_Small=Room2,
Floor2_Large=Room3, Floor2_Small=Room4, Attic=Attic (Floor2 names are
inferred, unverified — no Floor2 placements in the sample saves).

"Current room layouts" import option is now enabled (default on); App
converts bottom-left coords to shape-origin cells via visual bounds.

## Addendum (2026-06-10, #8): Goal presets, stat floors, tri-state weights

- Coordinate formulas confirmed for both regular rooms via second controlled
  save (kettle Floor1_Large (-10,-11) = col0/row6; wobble bird Floor1_Small
  (5,-11) = col15/row6).
- Auto-fill panel gains goal presets:
  - **Breeding** — maximize stimulation with a room-comfort floor of 4
    (new `minStats` option; floor satisfied first with the most
    comfort-per-space items, fillers with negative comfort are blocked
    unless headroom is placed alongside them).
  - **Storage** — maximize health + comfort; auto-selects the Idol of
    Chastity when owned.
  - **Mutation** — maximize mutation + comfort, stimulation weighted −1.
- Stat checkboxes upgraded to tri-state (maximize / avoid / off); editing
  switches the preset to Custom. API moved from `stats: StatKey[]` to
  `weights: StatWeights` with negative weights supported.
- "Include food storage" option force-places all owned Food Box copies
  (`mustInclude` now places every owned copy, not one).

## Addendum (2026-06-10, #9): House fit, permanent labels, reload parity

- House view scales to the window (aspect-ratio boxes per room, flex rows;
  no scrolling). Clicking a room remains the way to zoom into detail.
- Numbered item labels are always on; the Labels toggle is gone.
- Hovering any placed item auto-opens the checklist (it is the legend for
  the numbers and the hover highlight).
- One-click "Re-load savegame" now imports room layouts as well, matching
  the dialog's behavior — reload mirrors the full game state. Partial
  imports (e.g. keep generated layouts, refresh counts only) remain
  available through the import dialog's checkboxes.

## Addendum (2026-06-10, #10): Placement-import settle pass

Calibrated the layout import against a full-house screenshot of the real
save (pixel-measured against the game's 43.3px wallpaper grid). Confirmed
geometry: regular rooms are 7 rows, the attic is 8 (user-confirmed); the
existing formulas (regular col = x+10 / bottom-solid row = −y−5, attic
col = x+8 / row = −y−4) are correct for floor items, wall/ceiling items
and anchored stacks alike. Two genuine discoveries:

- **Wallmounted blocks are supporters.** `wallmounted_block1` is a single
  anchor-point cell on the wall; standing items (bed, trash cans) anchor
  on top of it mid-air. What looked like floating-item bugs was correct
  data all along.
- **Some records reference support the save doesn't encode.** In dense
  builds a handful of standing items are saved with nothing beneath them
  (their supporter is recorded elsewhere or nudged ±1 column; screenshot
  comparison suggests the game renders front/back depth lanes with a
  one-col/two-row projection offset we cannot read from the record — the
  trailing 8 bytes are constant `01 01` for all 108 placements, so no
  parent reference exists).

Import now runs a **settle pass** (`src/utils/placementImport.ts`,
extracted from App.tsx, unit-tested): standing items whose anchors have
support in their own or an adjacent column stay where the save puts them;
genuinely unsupported items slide straight down until their anchors land
on another item or the floor; stacked items that would start above row 0
are clamped into the room. Verified against the real save via Playwright:
108/108 items imported, zero unsupported floaters (previously the main
visual artifact), out-of-bounds cells 12 → 8. Residual imperfection: a few
items in dense stacks sit one column off versus the in-game render
(depth-lane projection, not recoverable from the save) — item identity,
counts and rooms are always exact, so the checklist workflow is unaffected.

## Addendum (2026-06-11, #11): Size-first packing, use-everything fill, progress UI

Auto-fill now aims to use the whole collection, not just the densest scorers:

- **Size-first rounds.** The maximize search alternates candidate orderings
  between score-per-space ('efficiency') and large-pieces-first
  ('sizeFirst'), so big furniture with relevant stats claims floor space
  before trinkets plug the gaps it leaves. Ruin-and-recreate picks an
  ordering at random per round.
- **Use-everything phase.** After the scoring fill, leftover gaps are packed
  with harmless owned items (weighted score 0, e.g. stats the user didn't
  select), largest pieces first. Negative-score items are still never
  placed. Opt out with `noFillers` (used by tests for the strict contract).
- **Tie-breaking** prefers more cells used, then more pieces, at equal score.
- **Async search with progress.** `autoPopulateRoomAsync` yields to the
  event loop every ~40ms and reports `{fraction, bestScore, pieces}`. The
  maximize budget rose 400ms → 1500ms per room; the Auto-fill button turns
  into a live progress bar ("Optimizing… NN%", house fills aggregate across
  rooms) and fill controls lock while the search runs.

Verified against the real save (Playwright): whole-house Maximize fill packs
Room 1 to 112/112 cells, Room 2 to 109/112, attic to 129/136, with live
progress samples 5%→100%; locked rooms stay untouched. 31 unit tests pass.

## Addendum (2026-06-11, #12): UI rework — tabs, dedicated fill panel, per-room presets

- **Top-bar tabs.** The header gains "House & Rooms" / "Furniture" tabs. The
  furniture browser is now a full-page view (max 1200px, centered); the
  right-side drawer remains available in the house/room view via the
  secondary "Furniture" button.
- **Leaner drawer.** Removed the duplicate mascot/logo from the drawer's
  filter header (the search field now gets that space) and the redundant
  "Import from savefile" button at the drawer bottom (the header button is
  the one place to load saves).
- **Dedicated auto-fill panel.** The Auto-fill dropdown became an always
  visible panel under the stats summary: algorithm radios + prominent
  Fill button (with the progress bar) on the first row, presets/stat
  chips/options below. Checklist, Furniture and Expert View moved to a
  small secondary row beneath it.
- **Per-room house fill.** In house view the panel shows a preset selector
  per unlocked room (Breeding / Storage / Mutation / Custom / Skip).
  Custom uses the panel's stat chips; Skip keeps the room untouched;
  Storage rooms auto-place the Idol of Chastity when owned.
  `onAutoPopulate` now takes `{ algorithm, plans: RoomFillPlan[] }` and the
  App fills each plan sequentially with aggregated progress.

Verified via Playwright on the real save: tabs switch views, panel renders
without opening a dropdown, per-room presets produce distinct stat profiles
(attic Breeding: stimulation 53; Room 1 Storage: comfort 42 + health;
Room 2 Mutation: mutation 6 with stimulation minimized), drawer still
toggles in house view, locked rooms preserved. 31 unit tests pass.

## Addendum (2026-06-11, #13): Panel beside room chooser, inline preset descriptions

- The auto-fill panel (with the Checklist / Furniture / Expert View buttons
  at its bottom) now sits left of the house/room chooser in one top row,
  both at the same height.
- Every per-room preset select shows its preset's description inline, so
  Breeding/Storage/Mutation are self-explanatory without opening anything;
  the single-room view shows the active preset's description next to the
  preset buttons.
- First load defaults to a different preset per room (cycling Breeding →
  Storage → Mutation in room order) instead of all-Breeding.

## Addendum (2026-06-11, #14): Per-room custom weights, checklist/hover split

- Rooms set to "Custom" in the house fill now carry their own tri-state
  stat weights (chips rendered under that room's row), so several custom
  rooms can optimize different stats. The Fill button stays disabled until
  every custom room has at least one maximized stat.
- Checklist and hover are now separate concerns: hovering a placed piece
  shows a lightweight name tag ("#42 Lotion ×2") next to the piece instead
  of auto-opening the checklist panel (which caused a layout shift on every
  mouse-over). The checklist opens only via its button; connector lines
  remain checklist-only. The tag is clamped inside the view for edge
  pieces.

## Addendum (2026-06-11, #15): Cell-accurate interaction, new mouse model, fill quality report

- Placed-piece overlays are bounding boxes, so L-shaped furniture blocked
  the free cells inside its rectangle. All pointer events now resolve to
  the piece actually occupying the cell under the cursor (occupancy
  lookup): hover, click, drag and right-click hit exactly the right item,
  and empty notch cells fall through to the grid.
- New mouse model: click opens the checklist (highlighting the item),
  drag moves, right-click removes. Click-to-remove is gone - accidental
  deletions worked against the user.
- After every auto-fill the panel shows a quality line: achieved weighted
  score vs. a loose upper bound (every remaining positive-scoring copy
  placed, geometry ignored) plus cells used vs. capacity. The maximize
  search is a heuristic (multi-start randomized greedy + ruin-and-recreate)
  with no optimality proof; the report makes "how close?" visible. 100%
  means provably optimal item selection; high 90s mean the room ran out of
  space, not the search out of ideas.

## Addendum (2026-06-11, #16): Attic float rule, undo/redo, per-cell hover

- **Attic floating fixed.** Anchorless (wallmounted) items were placed
  mid-air along the attic slope by the auto-fill — regular rooms have a
  back wall, the attic does not. New `looseItemsNeedSupport` room rule:
  in the attic an anchorless item needs the floor or an anchor point under
  its bottom row (plain solids give no grip). Ruin-and-recreate's cascade
  now also drops loose items whose support it removed (was the source of
  the remaining floaters, e.g. the floating IV).
- **Undo/redo.** Every room mutation (place, move, right-click remove,
  auto-fill, import) snapshots into a 100-step history. Undo/redo buttons
  in the panel + Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) shortcuts.
- **Per-cell hover highlight.** The hover focus no longer draws a rectangle
  over the piece's bounding box (which visually swallowed smaller items in
  the notches of L/T-shaped pieces); only the actual solid cells get the
  accent outline. Combined with cell-accurate pointer events, tetris-style
  pieces no longer block or obscure their neighbours.

## Addendum (2026-06-11, #17): Full idol list in the auto-fill panel

The panel now lists all seven special idols from the wiki's Special
Furniture set (Comfort, Stimulation, Health, Evolution, Appeal, Chastity,
Chaos) instead of only owned ones. Unowned idols render disabled with a
"Not purchased — <effect>" tooltip; owned ones behave as before. Stat
idols without a curated note derive their tooltip from their stats
("Stat idol (+5 Comfort)"). The Storage preset's automatic Idol of
Chastity selection now checks ownership before selecting/forcing it.
