# Auto-fill panel — functions & requirements

Inventory of everything the Auto-fill panel must let the user do. Source of
truth for the visual prototypes in `prototypes.html`.

## Modes
- **Single-room** — configure and fill ONE open room.
- **Whole-house** — configure every unlocked room at once, fill all in one pass.
- The mode is implicit from which room is open; the panel reshapes itself.

## Core functions

| # | Function | Single | House | Notes |
|---|----------|:------:|:-----:|-------|
| 1 | Pick a **preset** (Breeding / Storage / Mutation) | ✓ | ✓ (per room) | Each preset = base stats + a hidden rule (stat floor + auto-idol) |
| 2 | **Blank** / start from zero (no stats, no floor) | ✓ | — | House uses "Custom" instead |
| 3 | **Custom** stats per room | via Blank+edit | ✓ | House: a room set to Custom needs ≥1 maximised stat |
| 4 | **Edit stats on top of a preset** (keep its floor/idol) | ✓ | ✓ | Show a "modified" marker; rule still applies |
| 5 | **Stat weights** — 5 stats, tri-state: maximise / avoid / off | ✓ | ✓ | appeal, comfort, stimulation, health, mutation |
| 6 | Show the preset's **stat floor** (e.g. comfort ≥ 4) read-only | ✓ | ✓ | Travels with the preset even when edited |
| 7 | **Idols** — toggle owned idols (multi-select) | ✓ | ✓ (per room) | Preset auto-idol pre-selected; unowned disabled; each has a tooltip/effect note |
| 8 | **Food box** — force a food box in | ✓ | ✓ (per room) | Disabled when none owned |
| 9 | **Keep searching** — run unbounded, show live best, stop & apply | ✓ | ✓ | Search is always "maximise" (Quick removed — fast enough) |
| 10 | **Fill** — primary action | ✓ | ✓ | Label: "Fill Room N" / "Fill House"; disabled until valid |
| 11 | **Progress / live best** feedback while running | ✓ | ✓ | one-shot %: or keep-search "best 318 · pass 7" + "Use best result" |
| 12 | **Result score** report | ✓ | ✓ | score · % of theoretical max · cells used · best-of-N |
| 13 | **Skip** a room (keep its current layout) | — | ✓ | |
| 14 | At-a-glance **per-room summary** (focus + food/idol markers) | — | ✓ | Reveal extended options only when needed |
| 15 | Navigate **back to House** from a single room | ✓ | n/a | |

## Adjacent tools (live in the panel today, not strictly "auto-fill")
- Checklist toggle, Empty room(s), Furniture drawer toggle, Expert view.
- These should be visually separated from the fill controls.

## Constraints & rules
- Unowned idols / food box render disabled.
- Locked rooms are excluded from the house fill.
- Replacing existing furniture asks for confirmation.
- Fill disabled until the config is valid (≥1 maximised stat; every Custom house room has one).
- No emoji in the UI — user's browser has no emoji font. Use text/BMP symbols.

## UX goals (what the prototypes optimise for)
- **Progressive disclosure** — the 90% path (pick preset → Fill) stays tiny; power options on demand.
- **Primary-action prominence** — Fill is unmistakably the main button.
- **Recognition over recall** — presets, summaries and markers show state without opening anything.
- **Vertical economy** — the panel sits above the room grid; height is precious, especially in house mode with 5 rooms.
- **Consistency** — one icon size, one chip style, one marker style throughout.
