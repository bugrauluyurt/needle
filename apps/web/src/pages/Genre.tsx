import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { albumItem, CardSkeletons, RowHeader } from "../components/Cards.tsx";
import { Collection, CollectionTools, SORT_LABELS } from "../components/Collection.tsx";
import type { SortOption } from "../components/Collection.tsx";
import { ActBar, Hero, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { MixArt } from "../components/MixArt.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { plural } from "../lib/format.ts";
import { hashPalette } from "../lib/palette.ts";
import { AS_GIVEN, LIBRARY_SONG_SORTS, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { player } from "../player/controller.ts";
import { useAllAlbums, useGenres, useLibrarySongs } from "../queries/hooks.ts";

const GENRE_SORTS: SortOption[] = [["default", "Suggested"], ["title", SORT_LABELS.title], ["by", "Artist"], ["year", SORT_LABELS.year], ["plays", "Most played"]];

export default function GenrePage() {
  const { name = "" } = useParams();
  const genre = decodeURIComponent(name);
  const palette = hashPalette(genre);
  usePageTone(palette[0]);
  const { data: genres } = useGenres();
  const libraryAlbums = useAllAlbums();
  const librarySongs = useLibrarySongs(true);
  const albums = useMemo(() => (libraryAlbums.data ?? []).filter((album) => album.genre === genre || album.genres?.some((albumGenre) => albumGenre.name === genre)), [libraryAlbums.data, genre]);
  const songs = useMemo(() => (librarySongs.data ?? []).filter((song) => song.genre === genre || song.genres?.some((songGenre) => songGenre.name === genre)), [librarySongs.data, genre]);
  const [songFilter, setSongFilter] = useState("");
  const [songOrder, setSongOrder] = useState<SongOrder>(AS_GIVEN);
  const visibleSongs = useMemo(() => shownSongs(songs, songOrder, songFilter), [songs, songOrder, songFilter]);
  const info = genres?.find((g) => g.value === genre);
  const context = { kind: "genre" as const, id: `genre:${genre}`, name: genre };
  return (
    <div className="tinted">
      <Hero
        art={<MixArt mix={{ name: genre, palette }} label={null} />}
        kind="Genre"
        title={genre}
        meta={info ? <span>{plural(info.albumCount, "album")}, {plural(info.songCount, "song")}</span> : null}
      />
      <ActBar>
        <PlayContextButton contextId={context.id} label={genre} onPlay={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <ShuffleButton label={genre} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
      </ActBar>
      <div className="pad">
        <Collection id="genre-albums" title="Albums" items={albums.map((album) => albumItem(album))} sorts={GENRE_SORTS} {...(libraryAlbums.isLoading ? { loading: <CardSkeletons /> } : {})} />
        {songs.length ? (
          <>
            <RowHeader title="Songs" action={<div className="collection-actions"><SearchField variant="inline" collapsible value={songFilter} onChange={setSongFilter} label="Find in genre songs" /><CollectionTools sorts={[["custom", "Suggested"], ...LIBRARY_SONG_SORTS]} order={songOrder} onOrder={setSongOrder} /></div>} />
            <TrackList songs={visibleSongs} context={context} art album order={songOrder} onOrder={setSongOrder} />
          </>
        ) : null}
      </div>
    </div>
  );
}
