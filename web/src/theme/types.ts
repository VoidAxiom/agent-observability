export const STYLES = [
  "neon",
  "glass",
  "terminal",
  "editorial",
  "brut",
  "liquid",
  "holo",
] as const;

export type StyleId = (typeof STYLES)[number];

export const STYLE_LABELS: Record<StyleId, string> = {
  neon: "Neon",
  glass: "Glass",
  terminal: "Terminal",
  editorial: "Editorial",
  brut: "Brutalist",
  liquid: "Liquid",
  holo: "Holographic",
};

export interface PaletteEntry {
  id: string;
  label: string;
}

export const PALETTES: Record<StyleId, PaletteEntry[]> = {
  neon: [
    { id: "neon-tokyo", label: "Tokyo" },
    { id: "neon-miami", label: "Miami" },
    { id: "neon-vapor", label: "Vapor" },
  ],
  glass: [
    { id: "glass-aurora", label: "Aurora" },
    { id: "glass-arctic", label: "Arctic" },
    { id: "glass-sunset", label: "Sunset" },
  ],
  terminal: [
    { id: "terminal-matrix", label: "Matrix" },
    { id: "terminal-amber", label: "Amber" },
    { id: "terminal-solarized", label: "Solarized" },
  ],
  editorial: [
    { id: "editorial-print", label: "Print" },
    { id: "editorial-inverted", label: "Inverted" },
    { id: "editorial-bloomberg", label: "Bloomberg" },
  ],
  brut: [
    { id: "brut-caution", label: "Caution" },
    { id: "brut-construct", label: "Construct" },
    { id: "brut-electric", label: "Electric" },
  ],
  liquid: [
    { id: "liquid-ocean", label: "Ocean" },
    { id: "liquid-lava", label: "Lava" },
    { id: "liquid-forest", label: "Forest" },
  ],
  holo: [
    { id: "holo-prism", label: "Prism" },
    { id: "holo-opal", label: "Opal" },
    { id: "holo-oilslick", label: "Oilslick" },
  ],
};

export const DEFAULT_STYLE: StyleId = "neon";
export const DEFAULT_PALETTE = "neon-tokyo";
export const STORAGE_KEY = "theme";

export interface ThemeChoice {
  style: StyleId;
  palette: string;
}

export interface ThemeState extends ThemeChoice {
  fromUrl: boolean;
}

export function isStyleId(value: string | null | undefined): value is StyleId {
  return !!value && (STYLES as readonly string[]).includes(value);
}

export function isValidCombo(
  style: string | null | undefined,
  palette: string | null | undefined,
): style is StyleId {
  if (!isStyleId(style) || !palette) return false;
  return PALETTES[style].some((p) => p.id === palette);
}
