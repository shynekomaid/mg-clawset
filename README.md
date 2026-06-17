# <span style="display: flex; align-items: center; gap: 8px;"><img src="./public/favicon.svg" width="30" style="vertical-align: middle;" />Mewgenics Clawset</span>
**Live app:** [https://baenar.github.io/mg-clawset/](https://baenar.github.io/mg-clawset/)

A furniture collection manager and room designer for Mewgenics players. Browse the complete furniture database, track your collection, and design room layouts.

## Features

### Furniture Browser

- **Browse** all furniture in the game with images, shapes, and stats.
- **Filter** by name, minimum stat values (Appeal, Comfort, Stimulation, Health, Mutation), or show only owned items.
- **Sort** by any column — click column headers (Name, stat icons, Owned) to toggle ascending/descending.
- **Track ownership** — use the + and - buttons on each card to record how many of each item you have. Counts are saved in your browser's local storage.

### Stats

Each stat is represented by an icon in the column headers and room summary:

| Icon | Stat        |
|------|-------------|
| ![Appeal](./public/icons/Appeal_Icon.png)         | Appeal      |
| ![Comfort](./public/icons/Comfort_Icon.png)       | Comfort     |
| ![Stimulation](./public/icons/Stimulation_Icon.png) | Stimulation |
| ![Health](./public/icons/Health_Icon.png)          | Health      |
| ![Mutation](./public/icons/Mutation_Icon.png)      | Mutation    |

### Room Designer

- Click the **arrow button** on the right edge of the furniture list to open the room planner (splits into 1/3 list + 2/3 designer).
- **Drag furniture images** from the list and drop them onto the 16x7 grid.
- Furniture snaps to the grid based on its shape. Valid placements are highlighted green, invalid ones red.
- **Drag placed furniture** to move it — all connected (anchored) pieces move together.
- **Click placed furniture** to remove it. Pieces anchored to it are cascade-removed.
- Toggle **Expert View** to see cell types (Solid, Anchor Point, Anchor, Background) with a color-coded legend.
- **Stats summary** at the top shows the room's total Appeal, Comfort, Stimulation, Health, and Mutation.
- Room layout is saved in local storage and persists across sessions.

### Breeding Guide (Perfect 7)

- Open the **🧬 Breeding Guide** tab in the header.
- A step-by-step walkthrough of the **Perfect 7** method — breeding a cat whose seven base stats (STR, DEX, CON, INT, SPD, CHA, LCK) are all at the max value of 7.
- **Next step** — always shows the single next action to take, plus the recommended room to breed in.
- **Total progress** — the full 4-stage / multi-step plan with a saved checklist (`X/N steps complete`).
- **Room guidance** — reads the Stimulation and Comfort you've designed into each room and recommends the best breeding room (high Stimulation, Comfort ≥ 0). Jump straight to a room in the designer.
- **Cats you need** — which stats are *locked*, *reachable*, or *missing* at 7 for a pair, with expected 7s-per-kitten at your room's Stimulation.
- **Reads your real cats** — when you load a savegame, the guide parses every cat (name, sex, the seven base stats, room, ancestry) and ranks your strongest **unrelated** in-house foundation pairs, excluding siblings and parent/child automatically. Without a save it shows a worked example.
- Breeding math (inheritance odds, comfort gate) and the cat-blob parser are ported from [frankieg33/MewgenicsBreedingManager](https://github.com/frankieg33/MewgenicsBreedingManager)'s Perfect 7 Planner / save parser.

### Import from Save File

- Click **"Import from savefile"** at the bottom of the furniture list.
- Select your `.sav` file from `C:\Users\<user>\AppData\Roaming\Glaiel Games\Mewgenics\<steam_id>\saves`.
- The app parses the save database and automatically populates your owned furniture counts.
- **Note:** This overwrites your current inventory data.

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm (comes with Node.js)

### Setup

```bash
git clone https://github.com/baenar/mg-clawset.git
cd mg-clawset
npm install
```

### Development

```bash
npm run dev
```

Opens the app at [http://localhost:5173/mg-clawset/](http://localhost:5173/mg-clawset/).

### Production Build

```bash
npm run build
npm run preview
```

## Tech Stack

- React + TypeScript
- Vite
- sql.js (for parsing `.sav` files)

## Contact

Open to suggestions and feedback!

- [@baenar_ on X](https://x.com/baenar_)
- [@baenar on GitHub](https://github.com/baenar)
