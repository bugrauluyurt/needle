import { useParams } from "react-router";
import { albumItem, CardSkeletons, RowHeader } from "../components/Cards.tsx";
import { Collection, SORT_LABELS } from "../components/Collection.tsx";
import type { SortOption } from "../components/Collection.tsx";
import { ActBar, Hero, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { MixArt } from "../components/MixArt.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { plural } from "../lib/format.ts";
import { hashPalette } from "../lib/palette.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { player } from "../player/controller.ts";
import { useAlbumList, useGenres, useGenreSongs } from "../queries/hooks.ts";

const GENRE_SORTS: SortOption[] = [["default", "Suggested"], ["title", SORT_LABELS.title], ["by", "Artist"], ["year", SORT_LABELS.year]];

export default function GenrePage() {
  const { name = "" } = useParams();
  const genre = decodeURIComponent(name);
  const palette = hashPalette(genre);
  usePageTone(palette[0]);
  const { data: genres } = useGenres();
  const albums = useAlbumList("byGenre", 60, { genre });
  const { data: songs = [] } = useGenreSongs(genre);
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
        <Collection id="genre-albums" title="Albums" items={(albums.data ?? []).map((a) => albumItem(a))} sorts={GENRE_SORTS} {...(albums.data ? {} : { loading: <CardSkeletons /> })} />
        {songs.length ? (
          <>
            <RowHeader title="Songs" />
            <TrackList songs={songs} context={context} art album onPlay={(i) => player.playSongs(songs, i, context)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
