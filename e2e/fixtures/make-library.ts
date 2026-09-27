import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Track = { title: string; seconds: number; lyrics?: string[] };
type Album = {
  artist: string;
  album: string;
  year: number;
  genre: string;
  format: "flac" | "flac24" | "mp3";
  colors: [string, string];
  gain: number;
  tracks: Track[];
  albumArtist?: string;
  trackArtists?: string[];
};

const LYRICS = [
  "Streetlights hum a quiet tune",
  "The harbor holds the rising moon",
  "Every window tells a story",
  "Every story fades by noon",
  "We drive until the morning finds us",
  "Radio low and windows down",
  "Somewhere past the edge of town",
];

const ALBUMS: Album[] = [
  {
    artist: "Neon Harbor", album: "Afterglow Avenue", year: 2019, genre: "Synthwave", format: "flac",
    colors: ["0x5B2A86", "0xE0457B"], gain: -7.2,
    tracks: [
      { title: "Afterglow Avenue", seconds: 42, lyrics: LYRICS },
      { title: "Chrome Horizon", seconds: 36 },
      { title: "Palm Static", seconds: 31 },
      { title: "Midnight Rental", seconds: 48 },
      { title: "Tape Delay Heart", seconds: 33 },
      { title: "Last Exit Glow", seconds: 55 },
    ],
  },
  {
    artist: "Neon Harbor", album: "Night Transit", year: 2022, genre: "Synthwave", format: "mp3",
    colors: ["0x240B36", "0xC31432"], gain: -6.1,
    tracks: [
      { title: "Night Transit", seconds: 38 },
      { title: "Overpass", seconds: 29 },
      { title: "Signal Fire", seconds: 44, lyrics: LYRICS.slice(2) },
      { title: "Terminal Blue", seconds: 35 },
      { title: "Arrivals", seconds: 40 },
    ],
  },
  {
    artist: "Lumen Field", album: "Weightless Hours", year: 2021, genre: "Ambient", format: "flac24",
    colors: ["0x0F2436", "0x7FB7D9"], gain: -3.4,
    tracks: [
      { title: "First Light Over Water", seconds: 64 },
      { title: "Slow Tide", seconds: 58 },
      { title: "Weightless Hours", seconds: 71 },
      { title: "Distant Choir", seconds: 52 },
    ],
  },
  {
    artist: "The Paper Moons", album: "Salt & Signal", year: 2016, genre: "Indie Folk", format: "mp3",
    colors: ["0xF3E8D6", "0x2E6B5E"], gain: -8.0,
    tracks: [
      { title: "Salt & Signal", seconds: 34 },
      { title: "Lighthouse Keeper", seconds: 39 },
      { title: "Paper Boats", seconds: 27 },
      { title: "Northern Line", seconds: 36 },
      { title: "Kettle Song", seconds: 30 },
    ],
  },
  {
    artist: "Okto Quartet", album: "Blue Minutes", year: 1998, genre: "Jazz", format: "flac",
    colors: ["0xE43F2F", "0x1B1B1B"], gain: -5.5,
    tracks: [
      { title: "Blue Minutes", seconds: 46 },
      { title: "Seven Eight Blues", seconds: 41 },
      { title: "Brushes at Dawn", seconds: 37 },
      { title: "Cellar Door", seconds: 50 },
      { title: "Goodnight, Harlem", seconds: 44 },
    ],
  },
  {
    artist: "Kasa Kaan", album: "İstanbul'da Gece", year: 2011, genre: "Downtempo", format: "mp3",
    colors: ["0x1D7A46", "0xFF8A3D"], gain: -7.9,
    tracks: [
      { title: "Boğaz Rüzgârı", seconds: 43 },
      { title: "Galata", seconds: 38 },
      { title: "Çay Saati", seconds: 32 },
      { title: "Son Vapur", seconds: 47 },
    ],
  },
  {
    artist: "Static Garden", album: "Pulse Theory", year: 2005, genre: "House", format: "mp3",
    colors: ["0x0E1A3A", "0x4FD1FF"], gain: -9.1,
    tracks: [
      { title: "Pulse Theory", seconds: 40 },
      { title: "Four on the Floor", seconds: 36 },
      { title: "Warehouse Sunrise", seconds: 45 },
      { title: "Sidechain", seconds: 33 },
      { title: "Afterparty", seconds: 38 },
    ],
  },
  {
    artist: "Various Artists", albumArtist: "Various Artists", album: "Late Night Sessions", year: 2024, genre: "Electronic", format: "flac",
    colors: ["0x07201F", "0x1FB5A0"], gain: -6.6,
    trackArtists: ["Neon Harbor", "Lumen Field", "Static Garden", "Kasa Kaan"],
    tracks: [
      { title: "Harbor Lights (Session Edit)", seconds: 35 },
      { title: "Fog Machine", seconds: 44 },
      { title: "Deep Cut", seconds: 39 },
      { title: "Yalı", seconds: 41 },
    ],
  },
];

const ROOT = join(import.meta.dirname, "..", ".library");
const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, "_");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const lrcTime = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${(sec % 60).toFixed(2).padStart(5, "0")}`;

function cover(path: string, [c0, c1]: [string, string]) {
  ffmpeg(["-f", "lavfi", "-i", `gradients=s=600x600:c0=${c0}:c1=${c1}:n=2:type=radial:x0=180:y0=160:x1=600:y1=600:d=1`, "-frames:v", "1", "-q:v", "3", path]);
}

function track(path: string, t: Track, freq: number, a: Album, n: number, artist: string) {
  const codec = a.format === "mp3"
    ? ["-c:a", "libmp3lame", "-b:a", "192k", "-id3v2_version", "3"]
    : a.format === "flac24" ? ["-c:a", "flac", "-sample_fmt", "s32", "-ar", "48000"] : ["-c:a", "flac", "-sample_fmt", "s16", "-ar", "44100"];
  const tone = `sine=frequency=${freq}:duration=${t.seconds},volume=0.35`;
  const pad = `anoisesrc=color=pink:amplitude=0.04:duration=${t.seconds}`;
  ffmpeg([
    "-f", "lavfi", "-i", tone, "-f", "lavfi", "-i", pad,
    "-filter_complex", `[0][1]amix=inputs=2:normalize=0,afade=t=in:d=0.5,afade=t=out:st=${t.seconds - 1}:d=1,aformat=channel_layouts=stereo`,
    ...codec,
    "-metadata", `title=${t.title}`, "-metadata", `artist=${artist}`, "-metadata", `album=${a.album}`,
    "-metadata", `album_artist=${a.albumArtist ?? a.artist}`, "-metadata", `track=${n}/${a.tracks.length}`,
    "-metadata", `date=${a.year}`, "-metadata", `genre=${a.genre}`,
    "-metadata", `REPLAYGAIN_TRACK_GAIN=${(a.gain + (n % 3) * 0.4).toFixed(2)} dB`, "-metadata", "REPLAYGAIN_TRACK_PEAK=0.891",
    "-metadata", `REPLAYGAIN_ALBUM_GAIN=${a.gain.toFixed(2)} dB`, "-metadata", "REPLAYGAIN_ALBUM_PEAK=0.944",
    ...(a.albumArtist ? ["-metadata", "compilation=1"] : []),
    path,
  ]);
  if (t.lyrics) {
    const step = (t.seconds - 4) / t.lyrics.length;
    const lrc = t.lyrics.map((line, i) => `[${lrcTime(2 + i * step)}]${line}`).join("\n");
    writeFileSync(path.replace(/\.\w+$/, ".lrc"), `[ti:${t.title}]\n[ar:${artist}]\n${lrc}\n`);
  }
}

if (existsSync(ROOT) && !process.argv.includes("--force")) {
  console.log(`${ROOT} exists; pass --force to rebuild`);
  process.exit(0);
}
rmSync(ROOT, { recursive: true, force: true });
let freq = 196;
for (const a of ALBUMS) {
  const dir = join(ROOT, safe(a.albumArtist ?? a.artist), safe(`${a.album} (${a.year})`));
  mkdirSync(dir, { recursive: true });
  cover(join(dir, "cover.jpg"), a.colors);
  a.tracks.forEach((t, i) => {
    const artist = a.trackArtists?.[i] ?? a.artist;
    const ext = a.format === "mp3" ? "mp3" : "flac";
    track(join(dir, `${String(i + 1).padStart(2, "0")} - ${safe(t.title)}.${ext}`), t, freq, a, i + 1, artist);
    freq = freq > 700 ? 196 : Math.round(freq * 1.122);
  });
  console.log(`  + ${a.albumArtist ?? a.artist} / ${a.album}`);
}
for (const [artist, colors] of [["Neon Harbor", ["0xE0457B", "0x1C1242"]], ["Lumen Field", ["0x7FB7D9", "0x0F2436"]]] as const) {
  cover(join(ROOT, artist, "artist.jpg"), [...colors]);
}
console.log(`library written to ${ROOT}`);
