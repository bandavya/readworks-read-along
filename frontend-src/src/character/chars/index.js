// Written by character_lab/tools/to_app.py: the docked characters the reader can run. Loaded only when one is chosen.
export const LOADERS = {
  painted: () => import('./painted.js'),
  claude: () => import('./claude.js'),
  codex: () => import('./codex.js'),
  gemini: () => import('./gemini.js'),
}
export const CAST = [
  { id: "painted-stovepipe-dock", name: "Stovepipe", family: "painted" },
  { id: "painted-spout-dock", name: "Mr. Spout", family: "painted" },
  { id: "claude-otis-dock", name: "Otis", family: "claude" },
  { id: "claude-pearl-dock", name: "Pearl", family: "claude" },
  { id: "claude-q-dock", name: "Q", family: "claude" },
  { id: "claude-longfellow-dock", name: "Mr. Longfellow", family: "claude" },
  { id: "claude-gladys-dock", name: "Gladys", family: "claude" },
  { id: "claude-tina-dock", name: "Tina Concertina", family: "claude" },
  { id: "codex-tilly-dock", name: "Tilly", family: "codex" },
  { id: "codex-bix-dock", name: "Bix", family: "codex" },
  { id: "codex-bracket-dock", name: "Aunt Bracket", family: "codex" },
  { id: "codex-stair-dock", name: "Stair", family: "codex" },
  { id: "codex-kip-dock", name: "Kip", family: "codex" },
  { id: "codex-glimmer-dock", name: "Glimmer", family: "codex" },
  { id: "gemini-barnaby-dock", name: "Barnaby", family: "gemini" },
  { id: "gemini-pip-dock", name: "Pip", family: "gemini" },
  { id: "gemini-tallow-dock", name: "Tallow", family: "gemini" },
  { id: "gemini-saffron-dock", name: "Saffron", family: "gemini" },
  { id: "gemini-huxley-dock", name: "Huxley", family: "gemini" },
  { id: "gemini-maris-dock", name: "Maris", family: "gemini" },
]
