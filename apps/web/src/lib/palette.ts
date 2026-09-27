export const PALETTES: [string, string, string][] = [
  ["#1E3C78", "#4FD1FF", "#FF4FA3"],
  ["#B03A6E", "#FFB86B", "#3A1466"],
  ["#1E4A6B", "#7FB7D9", "#35E0C8"],
  ["#8A4B14", "#D9A441", "#9C1C2B"],
  ["#5B2A86", "#E0457B", "#FFB86B"],
  ["#2E6B5E", "#9BD46A", "#F2B8C6"],
  ["#7A1F1F", "#E8452C", "#F2E4C9"],
  ["#6B4A1A", "#F6B23C", "#E03A3A"],
  ["#9A4A14", "#FFE066", "#FF8A3D"],
  ["#3A2A6B", "#FF7EB6", "#7AE1FF"],
  ["#0F5750", "#1FB5A0", "#6B5BFF"],
  ["#4A4A52", "#A7A0B1", "#F3EFE8"],
];

export const TILE_COLORS = ["#1E3C78", "#B03A6E", "#1E4A6B", "#8A4B14", "#5B2A86", "#2E6B5E", "#7A1F1F", "#6B4A1A", "#0F5750", "#3A2A6B", "#9A4A14", "#4A4A52"];

export function hashPalette(s: string): [string, string, string] {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return PALETTES[(h >>> 0) % PALETTES.length] as [string, string, string];
}
