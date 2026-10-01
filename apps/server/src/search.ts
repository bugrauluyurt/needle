import type { Album, Artist, BrowseTile, SearchResult3, Song } from "@needle/shared";
import { fold, matchesTerms, queryTerms, releaseDateString, songKey } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";

const PAGE = 500;
const CHECK_EVERY_MS = 10_000;
const METADATA_MAX_AGE_MS = 60_000;
const TOP_GENRES = 12;
const DECADES = 6;
const COVERS = 3;

const newest = (albums: Album[]) => albums.toSorted((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
const covers = (albums: Album[]) => albums.filter((a) => a.coverArt).slice(0, COVERS).map((a) => ({ id: a.id, ...(a.coverArt ? { coverArt: a.coverArt } : {}) }));
const genresOf = (a: Album) => (a.genres?.length ? a.genres.map((g) => g.name) : a.genre ? [a.genre] : []);

export type Matcher = { byMbid: Map<string, Song>; byKey: Map<string, Song> };
type Index = { songs: Song[]; albums: Album[]; artists: Artist[]; scan: string; checked: number; builtAt: number; matcher?: Matcher };

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|live|mono|stereo|deluxe|bonus).*?[)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|version|edit|live|mono|stereo|mix).*$/, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchKey(title: string, artist: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}

const LEAD_ARTIST = /\s+(?:feat\.?|ft\.?|featuring|with|x|&|and|vs\.?)\s+|\s*[,;/]\s*/i;

export function findSong(m: Matcher, t: { mbid?: string; title: string; artist: string }): Song | undefined {
  const lead = t.artist.split(LEAD_ARTIST)[0] ?? t.artist;
  return (t.mbid ? m.byMbid.get(t.mbid) : undefined) ?? m.byKey.get(matchKey(t.title, t.artist)) ?? m.byKey.get(matchKey(t.title, lead));
}

function buildMatcher(songs: Song[]): Matcher {
  const matcher: Matcher = { byMbid: new Map(), byKey: new Map() };
  for (const s of songs) {
    if (s.musicBrainzId) matcher.byMbid.set(s.musicBrainzId, s);
    for (const name of [s.artist, ...(s.artists ?? []).map((a) => a.name)]) if (name) matcher.byKey.set(matchKey(s.title, name), s);
  }
  return matcher;
}

function ranked<T>(items: T[], terms: string[], name: (item: T) => string, fields: (item: T) => (string | undefined)[]): T[] {
  const first = terms[0] ?? "";
  const score = (item: T) => {
    const n = fold(name(item));
    return n.startsWith(first) ? 0 : n.split(/\W+/).some((w) => w.startsWith(first)) ? 1 : 2;
  };
  return items
    .filter((item) => matchesTerms(terms, ...fields(item)))
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.item);
}

export class LibrarySearch {
  private readonly navidrome: Navidrome;
  private readonly indexes = new Map<string, Promise<Index>>();

  constructor(navidrome: Navidrome) {
    this.navidrome = navidrome;
  }

  async search(auth: Auth, query: string): Promise<SearchResult3> {
    const terms = queryTerms(query);
    if (!terms.length) return {};
    const index = await this.index(auth);
    return {
      song: ranked(index.songs, terms, (s) => s.title, (s) => [s.title, s.artist, s.displayArtist, s.album]),
      album: ranked(index.albums, terms, (a) => a.name, (a) => [a.name, a.artist, a.displayArtist]),
      artist: ranked(index.artists, terms, (a) => a.name, (a) => [a.name]),
    };
  }

  async songs(auth: Auth): Promise<Song[]> {
    const { songs } = await this.index(auth);
    return songs.toSorted((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
  }

  async songKeys(auth: Auth): Promise<Set<string>> {
    const { songs } = await this.index(auth);
    return new Set(songs.map((s) => songKey(s.artist ?? "", s.title)));
  }

  async matcher(auth: Auth): Promise<Matcher> {
    const index = await this.index(auth);
    index.matcher ??= buildMatcher(index.songs);
    return index.matcher;
  }

  async hasFile(auth: Auth, size: number, suffix: string): Promise<boolean> {
    const { songs } = await this.index(auth);
    return songs.some((s) => s.size === size && s.suffix?.toLowerCase() === suffix);
  }

  async browse(auth: Auth, random = Math.random): Promise<BrowseTile[]> {
    const { albums } = await this.index(auth);
    const byGenre = new Map<string, Album[]>();
    for (const a of albums) for (const g of genresOf(a)) byGenre.set(g, [...(byGenre.get(g) ?? []), a]);
    const genres = [...byGenre.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, TOP_GENRES).map(([name, list]): BrowseTile => ({
      name, subtitle: `${list.length} ${list.length === 1 ? "album" : "albums"}`, to: `/genre/${encodeURIComponent(name)}`, covers: covers(newest(list)),
    }));
    const year = new Date().getFullYear();
    const decades = Array.from({ length: DECADES }, (_, i): BrowseTile => {
      const from = year - (year % 10) - i * 10;
      return { name: `${from}s`, subtitle: "Decade", to: `/albums/byYear?from=${from}&to=${from + 9}`, covers: covers(newest(albums.filter((a) => (a.year ?? 0) >= from && (a.year ?? 0) <= from + 9))) };
    });
    const shuffled = albums.map((a) => ({ a, k: random() })).sort((x, y) => x.k - y.k).map((x) => x.a);
    return [
      ...genres,
      ...decades,
      { name: "Recently added", subtitle: "Newest first", to: "/albums/newest", covers: covers(newest(albums)) },
      { name: "Surprise me", subtitle: "Random albums", to: "/albums/random", covers: covers(shuffled) },
    ].filter((t) => t.covers.length);
  }

  private async scanKey(auth: Auth): Promise<string> {
    const r = await this.navidrome.call<{ scanStatus: { lastScan?: string; count?: number; scanning?: boolean } }>(auth, "getScanStatus");
    return `${r.scanStatus.lastScan ?? ""}/${r.scanStatus.count ?? 0}`;
  }

  private async index(auth: Auth): Promise<Index> {
    const cached = await this.indexes.get(auth.user)?.catch(() => null);
    const metadataFresh = cached && Date.now() - cached.builtAt < METADATA_MAX_AGE_MS;

    if (metadataFresh && Date.now() - cached.checked < CHECK_EVERY_MS) return cached;
    const scan = await this.scanKey(auth);
    if (metadataFresh && cached.scan === scan) {
      cached.checked = Date.now();
      return cached;
    }
    const next = this.build(auth, scan);
    this.indexes.set(auth.user, next);
    next.catch(() => this.indexes.delete(auth.user));
    return next;
  }

  private async build(auth: Auth, scan: string): Promise<Index> {
    const index: Index = { songs: [], albums: [], artists: [], scan, checked: Date.now(), builtAt: Date.now() };
    for (let offset = 0; ; offset += PAGE) {
      const r = await this.navidrome.call<{ searchResult3: SearchResult3 }>(auth, "search3", {
        query: "", songCount: PAGE, songOffset: offset, albumCount: PAGE, albumOffset: offset, artistCount: PAGE, artistOffset: offset,
      });
      const { song = [], album = [], artist = [] } = r.searchResult3;
      index.songs.push(...song);
      index.albums.push(...album);
      index.artists.push(...artist);
      if (song.length < PAGE && album.length < PAGE && artist.length < PAGE) {
        const albumReleaseDates = new Map(index.albums.map((libraryAlbum) => [libraryAlbum.id, releaseDateString(libraryAlbum.releaseDate)]));

        for (const librarySong of index.songs) {
          const releaseDate = albumReleaseDates.get(librarySong.albumId ?? "");

          if (releaseDate) librarySong.releaseDate = releaseDate;
        }

        return index;
      }
    }
  }
}
