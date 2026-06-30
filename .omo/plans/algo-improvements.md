# Algorithm Improvements — Auto-Fill Enhancements

## TL;DR

> **Quick Summary**: Add 5 algorithm improvements to the house auto-fill: 3-mode Keep Searching (Standard/Long/Extreme with room order permutation), temperature-based adaptive exit, anchor-aware ruin-and-recreate for maximize mode, and cross-room item pre-allocation.
>
> **Deliverables**:
> - `src/utils/autoPopulate.ts` — anchor-aware `ruinAndRecreate` variant + convergence helper
> - `src/components/RoomDesignerWorkspace.tsx` — 3-position search mode selector replaces checkbox+number
> - `src/App.tsx` — searchMode plumbing, Extreme permutation loop, pre-allocation, temperature exit
> - `src/utils/autoPopulate.test.ts` — new tests for anchor clusters, convergence, pre-allocation
>
> **Estimated Effort**: Medium (5-8 focused changes, no new deps)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: searchMode state → App.tsx handleAutoPopulate → Extreme loop → tests

---

## Context

### Original Request
Improve the house auto-fill algorithm with targeted enhancements to keep-searching UX, anchor handling in maximize mode, room order exploration, and cross-room item allocation.

### Interview Summary
**Key Discussions**:
- Keep Searching becomes 3-position: Standard / Long / Extreme (replaces checkbox + staleLimit number)
- Extreme mode tries all 5! = 120 room order permutations, keeping the best result
- Temperature-based adaptive exit: last 10 passes window, exit when improvement < 1%
- Ruin-and-recreate should remove anchor clusters (shelf + hanging items), not random pieces
- Cross-room pre-allocation: items go to the room where they score highest (>2x threshold)
- Banned stats (-2) stays as-is
- Algorithm stays house-wide (no per-room choice)

**Research Findings**:
- `findAnchoredPieces` already exists in `src/utils/anchorHelpers.ts`
- `KEEP_PASS_ITERATIONS = 25` constant in App.tsx
- Current staleLimit defaults to 99; checkbox enables/disables
- Room order is hardcoded as `[ATTIC_INDEX, 0, 1, 2, 3]`
- 88 tests all pass; build is clean
- `WorkspacePersistedState` includes `staleLimit` and `keepSearchingEnabled`

---

## Work Objectives

### Core Objective
Enhance the auto-fill algorithm with 5 targeted improvements to produce better room layouts through smarter search strategies and cross-room item allocation.

### Concrete Deliverables
- 3-position search mode (Standard/Long/Extreme) in the house fill UI
- Extreme mode iterates all 120 room orderings
- Temperature-based early exit in keep-searching loops
- Anchor-aware cluster removal in maximize's ruin-and-recreate
- Cross-room item pre-allocation: items assigned to room where they score highest

### Definition of Done
- [ ] `npm test` — 5 test files pass (88 existing + new tests)
- [ ] `npm run build` — clean build with no TS errors
- [ ] Manual QA: verify each search mode produces plausible layouts
- [ ] Manual QA: verify Extreme finds layouts not found in Standard

### Must Have
1. `searchMode: 'standard' | 'long' | 'extreme'` replaces `keepSearchingEnabled + staleLimit`
2. Standard = staleLimit:5, no temperature; Long = staleLimit:15 + temperature; Extreme = iterate 5! orders × staleLimit:3 per order + temperature
3. Temperature exit: track last 10 house-level scores, exit when max improvement < 1%
4. Ruin-and-recreate: 50% chance pick anchor-providing pieces (type-3 cells) for cluster removal
5. Cross-room allocation: `preAllocateItems()` assigns items to rooms where `statScore > 2x` next best

### Must NOT Have (Guardrails)
- No per-room algorithm selection — house-wide algorithm stays
- No changes to banned stats (-2) behavior
- No changes to core `fillGreedy` algorithm (phases, scanning, floor logic)
- No new dependencies
- No changes to single-room fill (house fill only)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: Tests-after (new tests for new behavior)
- **Framework**: vitest

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.omo/evidence/task-{N}-{slug}.{ext}`.

- **Core logic**: Bash (bun test) — run specific test files, assert pass/fail counts
- **UI changes**: Playwright — open app, interact with new controls, verify state
- **Integration**: Bash — build check + test run

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — independent changes, MAX PARALLEL):
├── Task 1: searchMode type + state (RoomDesignerWorkspace + WorkspacePersistedState)
├── Task 2: Temperature convergence helper (new/util or autoPopulate.ts)
├── Task 3: Anchor-aware ruinAndRecreate variant (autoPopulate.ts)
├── Task 4: Cross-room preAllocateItems function (new utility or autoPopulate.ts)
└── Task 5: Update `preAllocateItems` signature in `RoomFillPlan` if needed

Wave 2 (Integration — depends on Wave 1):
├── Task 6: Wire searchMode + temperature + Extreme permutation into App.tsx
├── Task 7: Wire pre-allocation into App.tsx fillPass per-room usedInOtherRooms
├── Task 8: UI 3-position selector + remove old checkbox+number (RoomDesignerWorkspace)
└── Task 9: Update localStorage persistence types + effect

Wave 3 (Tests — depends on Wave 1 & 2):
├── Task 10: Tests for anchor-aware ruinAndRecreate
├── Task 11: Tests for cross-room preAllocateItems
├── Task 12: Tests for temperature convergence
├── Task 13: Integration test for Extreme mode flow
└── Task 14: Build + lint + full test suite

Wave FINAL (After ALL tasks):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
```

### Dependency Matrix
- **1-5**: - => 6-9
- **6**: 1, 2 => 13, 14
- **7**: 1, 4, 5 => 13, 14
- **8**: 1 => 9, 13
- **9**: 8 => 13, 14
- **10**: 3 => 13
- **11**: 4 => 13
- **12**: 2 => 13
- **13**: 6, 7, 9-12 => 14
- **14**: -, 10-13 => F1-F4

---

## TODOs

- [ ] 1. **Add `searchMode` type + state to RoomDesignerWorkspace**

  **What to do**:
  - Replace `keepSearchingEnabled: boolean` and `staleLimit: number` in `WorkspacePersistedState` with `searchMode: 'standard' | 'long' | 'extreme'`
  - Replace same in component state (`useState` default from persisted or `'standard'`)
  - Update `Props.onAutoPopulate` config interface: replace `keepSearching?: number` with `searchMode: 'standard' | 'long' | 'extreme'`
  - Update `App.tsx` `handleAutoPopulate` signature to accept `searchMode` instead of `keepSearching`
  - Keep backward compat: if `keepSearching` is passed (from old localStorage), map truthy → `'long'`

  **Must NOT do**:
  - Don't change `WorkspacePersistedState` structure yet for persistence (Task 9)
  - Don't change the UI rendering yet (Task 8)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical type/state changes across 2 files, no logic
  - **Skills**: none needed
  - **Skills Evaluated but Omitted**: none

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: None

  **References**:
  - `WorkspacePersistedState` in RoomDesignerWorkspace.tsx (lines 29-45) — current type structure
  - `useState` lines 225-226 — current `staleLimit` + `keepSearchingEnabled` state
  - `Props.onAutoPopulate` line 157 — current `keepSearching?: number`
  - `handleAutoPopulate` in App.tsx lines 377-390 — current config type + destructuring

  **Acceptance Criteria**:
  - [ ] `searchMode` exists as state in RoomDesignerWorkspace
  - [ ] `Props.onAutoPopulate` accepts `searchMode` instead of `keepSearching`
  - [ ] App.tsx `handleAutoPopulate` accepts the new config shape
  - [ ] Old localStorage with `keepSearchingEnabled`/`staleLimit` doesn't crash (backward compat)

  **QA Scenarios**:
  ```
  Scenario: New config type is accepted by App.tsx
    Tool: Bash (tsc)
    Preconditions: Code changes applied
    Steps:
      1. Run `npx tsc --noEmit`
    Expected Result: No type errors
    Evidence: .omo/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): add searchMode type + state replacing keepSearchingEnabled/staleLimit`
  - Files: `src/App.tsx`, `src/components/RoomDesignerWorkspace.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 2. **Add temperature convergence helper**

  **What to do**:
  - Create a helper function (in `autoPopulate.ts` or a small utility) that tracks convergence:
    ```typescript
    export function isConverged(
      scoreWindow: number[],   // sliding window from last N passes
      threshold: number,       // min relative improvement to stay (e.g. 0.01 = 1%)
    ): boolean
    ```
  - Windowing: take last `scoreWindow.length` scores, compute `max - min` relative to max
  - If last N aren't available yet → not converged
  - Export as a pure function (no side effects, easy to test)
  - Also export a helper to update the window: `pushScore(window: number[], score: number, maxLen: number): number[]`

  **Must NOT do**:
  - Don't modify App.tsx loop to use it yet (Task 6)
  - No UI changes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small pure function, ~20 lines
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 6, 12
  - **Blocked By**: None

  **References**:
  - `autoPopulate.ts` — existing exports pattern (line 18-21)
  - `autoPopulate.test.ts` — test patterns (line 29-45)

  **Acceptance Criteria**:
  - [ ] `isConverged` exported and works correctly
  - [ ] `pushScore` exported for window maintenance
  - [ ] Both functions are testable (pure, no side effects)

  **QA Scenarios**:
  ```
  Scenario: Pure function works correctly
    Tool: Bash (bun test fragment)
    Preconditions: Helper implemented
    Steps:
      1. Import isConverged in a test
      2. Test: window [100, 100, 101], threshold 0.01 → not converged (max-min=1, 1/101=0.0099 < 0.01)
      3. Test: window [100, 100, 100], threshold 0.01 → converged
      4. Test: window [100], threshold 0.01 → not converged (too few)
    Expected Result: All 3 assertions pass
    Evidence: .omo/evidence/task-2-convergence.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): add temperature convergence helper (isConverged + pushScore)`
  - Files: `src/utils/autoPopulate.ts`, `src/utils/autoPopulate.test.ts`

- [ ] 3. **Anchor-aware ruin-and-recreate variant**

  **What to do**:
  - Modify the existing `ruinAndRecreate` function in `autoPopulate.ts` to use anchor-aware victim selection:
  - When picking each victim, 50% chance: only pick from pieces that have type-3 (anchor point) cells in their shape → this removes a full anchor cluster (shelf + everything hanging from it)
  - 50% chance: pick randomly from ALL pieces (current behavior) for smaller perturbations
  - Fallback: if no anchor providers exist, fall back to random selection
  - The rest of the function (rebuild occupancy, refill with kept + greedied) stays identical
  - Keep the existing `findAnchoredPieces` usage for cascade removal

  **Must NOT do**:
  - No changes to `fillGreedy` or `runGreedy`
  - No changes to other maximize functions
  - No changes to function signature

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Changes search exploration dynamics; must verify invariant (all anchors remain valid)
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 10
  - **Blocked By**: None

  **References**:
  - `autoPopulate.ts` lines 330-363 — current `ruinAndRecreate`
  - `autoPopulate.ts` lines 239-266 — grid cell types (2=solid, 3=anchor-point, 4=anchor)
  - `anchorHelpers.ts` — `findAnchoredPieces` function (already imported in autoPopulate.ts)
  - `autoPopulate.test.ts` lines 238-267 — existing test for anchored pieces in maximize

  **Acceptance Criteria**:
  - [ ] `ruinAndRecreate` picks anchor providers 50% of the time when available
  - [ ] `ruinAndRecreate` never crashes on rooms with no anchor pieces
  - [ ] All existing anchor-related tests still pass
  - [ ] Anchor chain invariant maintained (no orphaned anchors after removal)

  **QA Scenarios**:
  ```
  Scenario: Anchor providers are preferred when available
    Tool: Bash (bun test)
    Preconditions: Function modified
    Steps:
      1. Run existing test suite: `npm test`
      2. Run specific anchor test: `npx vitest run src/utils/autoPopulate.test.ts -t "anchored pieces remain supported"`
    Expected Result: All tests pass
    Evidence: .omo/evidence/task-3-test-pass.txt

  Scenario: Fallback works when no anchor providers exist
    Tool: Bash (node REPL or test)
    Preconditions: Function modified
    Steps:
      1. Create a layout with no type-3 cells (all 1x1 items)
      2. Run ruinAndRecreate on it
    Expected Result: No crash, normal random removal
    Evidence: .omo/evidence/task-3-fallback.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): anchor-aware ruinAndRecreate with 50% cluster-bias`
  - Files: `src/utils/autoPopulate.ts`

- [ ] 4. **Cross-room item pre-allocation function**

  **What to do**:
  - Add a `preAllocateItems` function to `autoPopulate.ts` (or a new utility if cleaner):
    ```typescript
    export function preAllocateItems(
      plans: RoomFillPlan[],
      allFurniture: FurnitureItem[],
      ownership: Record<string, number>,
    ): Record<number, Record<string, number>>
    ```
  - Logic per item:
    - If item is in ANY plan's `mustInclude` → skip (handled by existing reservation system)
    - Score item in each room using `statScore(item, plan.weights)`
    - If only ONE room scores positive → all copies to that room
    - If multiple rooms score positive → best room (>2x next best score) gets all copies
    - Items with close scores or zero scores → not allocated (remain in shared pool)
  - Return: per-room ownership map of allocated items

  **Must NOT do**:
  - MustInclude items should NOT be double-handled (existing system already reserves them)
  - Don't modify RoomFillPlan type unless necessary
  - Don't integrate into App.tsx yet (Task 7)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: One pure function, well-defined logic, ~40 lines
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 7, 11
  - **Blocked By**: None

  **References**:
  - `autoPopulate.ts` lines 31-63 — `AutoPopulateOptions`, `RoomFillPlan`, `statScore`
  - `autoPopulate.ts` lines 25-29 — `statScore` implementation

  **Acceptance Criteria**:
  - [ ] `preAllocateItems` returns correct allocations
  - [ ] MustInclude items are skipped (not double-allocated)
  - [ ] Items with no positive score → not allocated
  - [ ] Items where best room >2x next best → allocated to best room
  - [ ] Items with close scores → not allocated (remain shared)

  **QA Scenarios**:
  ```
  Scenario: Item clearly better in one room gets allocated there
    Tool: Bash (bun test)
    Preconditions: Function implemented
    Steps:
      1. Plan A: weights={comfort:1}, Plan B: weights={stimulation:1}
      2. Item with comfort:5, stimulation:0
      3. preAllocateItems → all copies to Plan A room
    Expected Result: Single-room allocation
    Evidence: .omo/evidence/task-4-alloc-clear.txt

  Scenario: Close-scoring item stays shared
    Tool: Bash (bun test)
    Preconditions: Function implemented
    Steps:
      1. Plan A: weights={comfort:1}, Plan B: weights={comfort:1}
      2. Item scores 5 in both → not allocated
    Expected Result: No pre-allocation for this item
    Evidence: .omo/evidence/task-4-alloc-shared.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): add preAllocateItems for cross-room item assignment`
  - Files: `src/utils/autoPopulate.ts`, `src/utils/autoPopulate.test.ts`

- [ ] 5. **Update `RoomFillPlan` type if needed for pre-allocation**

  **What to do**:
  - Check if `RoomFillPlan` needs any additional fields for the pre-allocation system
  - Currently it has: `roomIndex`, `weights`, `mustInclude`, `minStats`, `excludeItemIds`
  - If pre-allocation works purely from these fields → no change needed
  - If something is missing (e.g. per-room noFood flag for allocation logic) → add it
  - The `preAllocateItems` function needs `weights` (already exists) and `mustInclude` (already exists) to function correctly

  **Must NOT do**:
  - Don't add fields that aren't strictly necessary for the 5 planned changes
  - No per-room algorithm field (house-wide only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type check only, likely no changes needed
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `autoPopulate.ts` lines 57-63 — `RoomFillPlan` type
  - `App.tsx` — where `RoomFillPlan[]` is built from workspace state

  **Acceptance Criteria**:
  - [ ] `RoomFillPlan` has all fields needed for `preAllocateItems`
  - [ ] No unnecessary new fields added

  **QA Scenarios**:
  ```
  Scenario: Type compiles correctly
    Tool: Bash (tsc)
    Preconditions: Any type changes applied
    Steps:
      1. Run `npx tsc --noEmit`
    Expected Result: Clean compile
    Evidence: .omo/evidence/task-5-typecheck.txt
  ```

  **Commit**: YES (grouped with Task 4)
  - Message: `feat(algo): add preAllocateItems for cross-room item assignment`
  - Files: `src/utils/autoPopulate.ts`

- [ ] 6. **Wire searchMode + temperature + Extreme permutation into App.tsx**

  **What to do**:
  - Update `handleAutoPopulate` to accept `searchMode` and compute behavior:
    ```
    standard → staleLimit:5, no temp, fixed order
    long     → staleLimit:15, temp active, fixed order
    extreme  → iterate all 5! room orders, staleLimit:3 per order, temp active
    ```
  - For Standard and Long: existing keep-searching loop with new staleLimit values
  - For Long: after each pass, call `isConverged()` on a rolling window → early exit
  - For Extreme:
    - Generate all 120 permutations of the room indices (NOT including Attic which stays first)
    - For each permutation, run a sub-search (like keep-searching with staleLimit:3)
    - Track global best (rooms + score) across all permutations
    - Use the best as the result
    - Report which permutation gave the best result (for diagnostics)
  - For temperature window: use `pushScore` after each pass to maintain a rolling window of scores

  **Must NOT do**:
  - Don't change the one-shot fill (non-keepSearching path) — it still uses fixed order
  - Don't change per-room iteration budget (`KEEP_PASS_ITERATIONS = 25`)
  - No UI changes here

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex orchestration logic, permutation generation, multiple search modes
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential)
  - **Parallel Group**: Wave 2 (with Tasks 7, 8)
  - **Blocks**: Tasks 13, 14
  - **Blocked By**: Task 1, Task 2

  **References**:
  - `App.tsx` lines 377-589 — entire `handleAutoPopulate`
  - `App.tsx` lines 504-535 — keep-searching loop
  - `App.tsx` lines 393-420 — room capacity, reserved, upperScore computation
  - `autoPopulate.ts` — `isConverged`, `pushScore` (from Task 2)

  **Acceptance Criteria**:
  - [ ] Standard mode: staleLimit=5, no temperature
  - [ ] Long mode: staleLimit=15, temperature active
  - [ ] Extreme mode: all 120 orders tried, staleLimit=3 per order, keeps best
  - [ ] Extreme mode generates correct permutations (not re-including Attic)
  - [ ] Temperature exits early when improvement stalls
  - [ ] Report shows which permutation was best (Extreme)

  **QA Scenarios**:
  ```
  Scenario: Standard mode runs and produces a layout
    Tool: Playwright
    Preconditions: App running, with ownership data (theorycraft mode)
    Steps:
      1. Set house fill to Standard mode
      2. Click Auto-Fill
    Expected Result: Rooms are filled, report shows score
    Evidence: .omo/evidence/task-6-standard.png

  Scenario: Extreme mode produces a DIFFERENT layout
    Tool: Playwright + Bash
    Preconditions: App running with same data as Standard
    Steps:
      1. Click "Empty all" to clear rooms
      2. Set Extreme mode, click Auto-Fill
    Expected Result: Score is >= Standard score
    Evidence: .omo/evidence/task-6-extreme.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): wire searchMode + temperature + Extreme permutation`
  - Files: `src/App.tsx`
  - Pre-commit: `npm test && npm run build`

- [ ] 7. **Wire cross-room pre-allocation into App.tsx fill path**

  **What to do**:
  - In `handleAutoPopulate`, before the fill loop, call `preAllocateItems(plans, allFurniture, effectiveOwnership)`
  - In both `fillPass` and the one-shot fill: compute a combined `unavailable` count per room:
    - `reserved` (unplanned rooms) + `globalReserved` (caps)
    - \+ items placed in earlier rooms (physical tracked `used`)
    - \+ items pre-allocated to OTHER rooms (from `preAllocateItems`)
    - \+ `mustIncludeReservation` for other rooms (existing logic)
  - Use ADDITIVE merge (not Math.max) for pre-allocated items since they represent distinct copies
  - The pre-allocation is applied in addition to the existing reservation system (which handles mustInclude items separately)

  **Must NOT do**:
  - Don't change mustInclude reservation logic (existing `otherReserved` should continue to work)
  - Don't apply pre-allocation to single-room fill (it's house-fill only)
  - Pre-allocation is additive, NOT replacing existing reservation

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Integration logic, must correctly combine 3 reservation layers
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential)
  - **Parallel Group**: Wave 2 (with Tasks 6, 8)
  - **Blocks**: Tasks 13
  - **Blocked By**: Tasks 1, 4, 5

  **References**:
  - `App.tsx` lines 447-493 — `fillPass` function
  - `App.tsx` lines 538-588 — one-shot fill path
  - `App.tsx` lines 425-445 — existing reservation logic
  - `autoPopulate.ts` — `preAllocateItems` (from Task 4)

  **Acceptance Criteria**:
  - [ ] Pre-allocation runs before any room fills
  - [ ] Items allocated to Room X are NOT available for placement in other rooms
  - [ ] Items NOT pre-allocated remain in shared pool (current behavior)
  - [ ] MustInclude items still work (don't get double-reserved)
  - [ ] Pre-allocation + existing reservation don't over-commit copies
  - [ ] Room still gets its pre-allocated items (they're in ownership but not in unavailable)

  **QA Scenarios**:
  ```
  Scenario: Pre-allocated item is not used by wrong room
    Tool: Playwright + Bash
    Preconditions: Savegame with known items
    Steps:
      1. Set Room A: weights={comfort:1}, Room B: weights={stimulation:1}
      2. An item with comfort:5 stimulation:0 exists and is owned
      3. Run auto-fill
      4. Check which room has the item
    Expected Result: The item ends up in Room A (comfort room)
    Evidence: .omo/evidence/task-7-allocation.txt

  Scenario: Shared item is still available to all rooms
    Tool: Same setup
    Preconditions: Same as above
    Steps:
      1. Item with comfort:3 stimulation:3 (equal score in both rooms)
      2. Run auto-fill
    Expected Result: Item can appear in either or both rooms
    Evidence: .omo/evidence/task-7-shared.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): wire cross-room pre-allocation into house fill path`
  - Files: `src/App.tsx`
  - Pre-commit: `npm test && npm run build`

- [ ] 8. **UI: Replace checkbox+number with 3-position search mode selector**

  **What to do**:
  - In `RoomDesignerWorkspace.tsx`, find the Keep checkbox + staleLimit control section (around line 917-954)
  - Replace with a 3-segment toggle/select:
    ```
    [ Standard ] [ Long ] [ Extreme ]
    ```
  - Use the same small button / pill style as other controls in the app
  - Each mode shows a tooltip with what it does:
    - Standard: "5 passes, fixed room order"
    - Long: "up to 15 passes, adaptive exit"
    - Extreme: "all 120 room orders, best overall"
  - Remove the `staleLimit` number input entirely
  - Disable the control during fill (same as current behavior)
  - Default to 'standard'
  - Pass `searchMode` (not `keepSearching`) in the `onAutoPopulate` call

  **Must NOT do**:
  - Don't change any other UI controls
  - Don't add emoji (user convention)
  - Keep the "Use best result" and stop/search progress display (lines 946-953)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component change, styling, layout
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1

  **References**:
  - `RoomDesignerWorkspace.tsx` lines 917-954 — current Keep UI
  - `RoomDesignerWorkspace.tsx` lines 908-916 — adjacent controls for style reference (small buttons, gap, font sizes)
  - `RoomDesignerWorkspace.tsx` lines 564-588 — `onAutoPopulate` call sites

  **Acceptance Criteria**:
  - [ ] 3-position selector renders as pill/segment control
  - [ ] Selecting a mode sets `searchMode` state correctly
  - [ ] Control is disabled during fill (fillProgress/fillSearch active)
  - [ ] `onAutoPopulate` receives `searchMode` instead of `keepSearching`
  - [ ] "Use best result" button still works
  - [ ] Tooltip shows mode description

  **QA Scenarios**:
  ```
  Scenario: Mode selection changes the search behavior
    Tool: Playwright
    Preconditions: App running
    Steps:
      1. Locate the search mode selector
      2. Click "Long"
      3. Verify the active mode is Long
      4. Click "Extreme"
      5. Verify the active mode is Extreme
    Expected Result: Mode selection works and visually indicates active mode
    Evidence: .omo/evidence/task-8-mode-select.png

  Scenario: Control is disabled during active fill
    Tool: Playwright
    Preconditions: App running
    Steps:
      1. Click "Auto-Fill" with Standard mode
      2. Try clicking other modes while fill is running
    Expected Result: Mode selector is disabled during fill
    Evidence: .omo/evidence/task-8-disabled.png
  ```

  **Commit**: YES (with wave group)
  - Message: `feat(algo): UI 3-position search mode selector replaces checkbox+staleLimit`
  - Files: `src/components/RoomDesignerWorkspace.tsx`

- [ ] 9. **Update localStorage persistence for new `searchMode` state**

  **What to do**:
  - Replace `staleLimit` and `keepSearchingEnabled` in `WorkspacePersistedState` with `searchMode: 'standard' | 'long' | 'extreme'`
  - Update `saveWorkspaceState` call to use `searchMode` instead
  - Update `persisted` restoration in `useState` to load `searchMode`
  - Handle migration: if old localStorage has `keepSearchingEnabled: true` but no `searchMode`, default to `'long'`

  **Must NOT do**:
  - Don't break existing persisted state — old users should not lose data on upgrade
  - Don't change any other persisted fields

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical state field replacement
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8)
  - **Blocks**: Tests
  - **Blocked By**: Tasks 1, 8

  **References**:
  - `RoomDesignerWorkspace.tsx` lines 29-45 — `WorkspacePersistedState`
  - `RoomDesignerWorkspace.tsx` lines 250-273 — `saveWorkspaceState` + `useEffect`
  - `RoomDesignerWorkspace.tsx` lines 225-226 — current useState for staleLimit/keepSearchingEnabled

  **Acceptance Criteria**:
  - [ ] localStorage saves/loads `searchMode` correctly
  - [ ] Old persisted state with `keepSearchingEnabled`/`staleLimit` migrates gracefully
  - [ ] No data loss on upgrade

  **QA Scenarios**:
  ```
  Scenario: New state persists across reload
    Tool: Playwright
    Preconditions: App running
    Steps:
      1. Set search mode to "Long"
      2. Reload the page
      3. Check search mode is still "Long"
    Expected Result: Mode preserved across reload
    Evidence: .omo/evidence/task-9-persistence.png

  Scenario: Old localStorage migrates
    Tool: Bash
    Preconditions: localStorage has old keys
    Steps:
      1. Inject localStorage with { keepSearchingEnabled: true, staleLimit: 10 }
      2. Load page
      3. Check that searchMode is 'long' (migration default)
    Expected Result: No crash, correct migration
    Evidence: .omo/evidence/task-9-migration.txt
  ```

  **Commit**: YES (grouped with Task 8)
  - Message: `feat(algo): UI 3-position search mode selector replaces checkbox+staleLimit`
  - Files: `src/components/RoomDesignerWorkspace.tsx`

- [ ] 10. **Tests for anchor-aware ruinAndRecreate**

  **What to do**:
  - Add test cases to `autoPopulate.test.ts` for the anchor-aware changes:
    1. Test that maximize with anchor-bias still produces valid layouts (no orphaned anchors)
    2. Test that rooms with NO anchor pieces still work (fallback to random)
    3. Test that anchor-aware mode finds valid layouts in anchor-heavy rooms (attic with shelves + hanging items)
    4. Test that anchor bias doesn't DRAMATICALLY reduce the solution space (many seeds still find valid layouts)
  - Use the existing test infrastructure (`makeItem`, `makeOpts`, `findAnchoredPieces`)

  **Must NOT do**:
  - Don't remove or modify existing tests
  - Don't add tests that depend on specific random seeds matching exactly (non-deterministic if bias changes)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test cases, need to be thorough about anchor invariants
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (with Tasks 11, 12, 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 3

  **References**:
  - `autoPopulate.test.ts` lines 238-267 — existing anchor maximize test
  - `autoPopulate.test.ts` lines 354-391 — existing anchor placement tests
  - `autoPopulate.test.ts` lines 165-207 — existing maximize test structure

  **Acceptance Criteria**:
  - [ ] Anchor-bias maximize produces valid layouts in anchor-heavy rooms
  - [ ] No orphaned anchors after maximize (all type-4 cells have matching type-3)
  - [ ] Fallback works when no anchor providers exist
  - [ ] Test names clearly indicate they test anchor-aware behavior
  - [ ] Count of new tests ≥ 3

  **QA Scenarios**:
  ```
  Scenario: All new tests pass
    Tool: Bash (bun test)
    Preconditions: Tests written
    Steps:
      1. Run `npx vitest run src/utils/autoPopulate.test.ts -t "anchor"`
      2. Check all anchor-prefixed tests pass
    Expected Result: All pass (≥3 tests)
    Evidence: .omo/evidence/task-10-test-pass.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `test(algo): add tests for anchor-aware ruinAndRecreate`
  - Files: `src/utils/autoPopulate.test.ts`

- [ ] 11. **Tests for cross-room preAllocateItems**

  **What to do**:
  - Add test cases to `autoPopulate.test.ts` for `preAllocateItems`:
    1. Test: item with clear winner room → allocated to that room exclusively
    2. Test: item with equal scores in all rooms → not allocated (stays shared)
    3. Test: mustInclude items are skipped (not double-allocated)
    4. Test: items with zero score everywhere → not allocated
    5. Test: items where only ONE room scores positive → allocated there
    6. Test: multiple items, each gets correct allocation
    7. Test: empty ownership → empty allocation
  - Use `makeItem` and similar helpers
  - Import `preAllocateItems` directly

  **Must NOT do**:
  - Don't modify existing tests
  - Don't test integration with App.tsx (that's Task 13)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Many edge cases, pure function testing
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 12, 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 4

  **References**:
  - `autoPopulate.test.ts` — existing test patterns (makeItem, makeOpts)
  - `autoPopulate.test.ts` lines 315-326 — existing mustInclude test pattern

  **Acceptance Criteria**:
  - [ ] All 7 test scenarios above have test cases
  - [ ] All new tests pass
  - [ ] Test names clearly linked to pre-allocation behavior

  **QA Scenarios**:
  ```
  Scenario: All pre-allocation tests pass
    Tool: Bash (bun test)
    Preconditions: Tests written
    Steps:
      1. Run `npx vitest run src/utils/autoPopulate.test.ts -t "preAlloc"`
    Expected Result: All pass (≥6 tests)
    Evidence: .omo/evidence/task-11-test-pass.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `test(algo): add tests for cross-room preAllocateItems`
  - Files: `src/utils/autoPopulate.test.ts`

- [ ] 12. **Tests for temperature convergence helper**

  **What to do**:
  - Add test cases (in `autoPopulate.test.ts` or a new test block) for `isConverged` and `pushScore`:
    1. Test: `isConverged([100, 101], 0.02)` → false (improvement 1/101 ≈ 0.99% < 2%)
    2. Test: `isConverged([100, 100, 100], 0.01)` → true (max-min=0)
    3. Test: `isConverged([100], 0.01)` → false (too few entries)
    4. Test: `isConverged([100, 100, 101], 0.005)` → false (1/101 = 0.99% > 0.5%)
    5. Test: `pushScore([], 100, 10)` → [100]
    6. Test: `pushScore([1,2,3], 4, 3)` → [2,3,4] (truncates to maxLen)
    7. Test: `isConverged([0, 0, 0], 0.01)` → true (edge case: all zeros)

  **Must NOT do**:
  - Don't change helper function signatures after writing tests
  - Don't test integration with App.tsx

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure function testing, straightforward
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 2

  **References**:
  - `autoPopulate.test.ts` lines 29-45 — existing pure function test pattern (statScore tests)

  **Acceptance Criteria**:
  - [ ] All 7 test scenarios above pass
  - [ ] Edge case with all-zero scores handled correctly
  - [ ] Window truncation works correctly

  **QA Scenarios**:
  ```
  Scenario: All convergence tests pass
    Tool: Bash (bun test)
    Preconditions: Tests written
    Steps:
      1. Run `npx vitest run src/utils/autoPopulate.test.ts -t "converg"`
    Expected Result: All pass (≥6 tests)
    Evidence: .omo/evidence/task-12-test-pass.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `test(algo): add tests for temperature convergence helper`
  - Files: `src/utils/autoPopulate.test.ts`

- [ ] 13. **Integration tests for Extreme mode + pre-allocation end-to-end**

  **What to do**:
  - Add an integration test (in a new test file `src/utils/houseFill.test.ts` or in App.test.tsx if exists) that:
    1. Sets up a minimal house fill scenario (2-3 rooms, known items, mock ownership)
    2. Runs through the App.tsx handleAutoPopulate path with Extreme mode
    3. Verifies the result has valid placements
    4. Verifies cross-room pre-allocation works (item in correct room)
  - This tests that the pieces work together, not just in isolation
  - Use the same `makeItem`/`makeOpts` helpers

  **Must NOT do**:
  - Don't test UI components (Playwright covers that)
  - Don't test the full App component rendering (unit-level is enough)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration testing, multiple components working together
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 6, 7, 8, 9

  **References**:
  - `autoPopulate.test.ts` — test patterns
  - `App.tsx` — handleAutoPopulate logic (already uses autoPopulateRoom)

  **Acceptance Criteria**:
  - [ ] Integration test verifies Extreme mode produces valid house layout
  - [ ] Integration test verifies pre-allocation works in end-to-end flow
  - [ ] Test is deterministic (uses fixed seeds)

  **QA Scenarios**:
  ```
  Scenario: Integration test passes
    Tool: Bash (bun test)
    Preconditions: Integration test written
    Steps:
      1. Run `npx vitest run src/utils/houseFill.test.ts`
    Expected Result: All integration tests pass
    Evidence: .omo/evidence/task-13-integration-pass.txt
  ```

  **Commit**: YES (with wave group)
  - Message: `test(algo): add integration tests for Extreme mode + pre-allocation`
  - Files: `src/utils/houseFill.test.ts`

- [ ] 14. **Build, lint, full test suite**

  **What to do**:
  - Run `npm run build` — fix any TypeScript errors
  - Run `npm test` — ensure all 88 existing tests + new tests pass
  - Run linter if configured (check package.json for lint script)
  - Fix any issues found
  - Ensure no regressions in existing behavior

  **Must NOT do**:
  - Don't introduce any new changes — only fix issues from Tasks 1-13

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Final cleanup, may need to fix subtle issues
  - **Skills**: none needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (runs after all other tasks)
  - **Parallel Group**: Wave 3 final step
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 10-13

  **References**:
  - Whole codebase

  **Acceptance Criteria**:
  - [ ] `npm run build` succeeds
  - [ ] `npm test` — ALL tests pass
  - [ ] No new TypeScript errors

  **QA Scenarios**:
  ```
  Scenario: Full build passes
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `npm run build`
    Expected Result: Build succeeds with no errors
    Evidence: .omo/evidence/task-14-build.txt

  Scenario: Full test suite passes
    Tool: Bash
    Preconditions: Build passes
    Steps:
      1. Run `npm test`
    Expected Result: 88+ tests pass
    Evidence: .omo/evidence/task-14-test.txt
  ```

  **Commit**: NO (already committed with individual tasks)
  - Message: N/A — this task is verification only

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run test). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1-5 per wave**: `feat(algo): add searchMode 3-position selector [wave 1]`
- **6-9**: `feat(algo): integrate searchMode + Extreme + pre-allocation [wave 2]`
- **10-14**: `test(algo): add tests for anchor-aware, pre-allocation, temperature [wave 3]`
- **Fixes**: `fix(algo): [description]`

---

## Success Criteria

### Verification Commands
```bash
npm test        # 5 files, 88+ tests pass
npm run build   # clean build
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
