import { useMemo, useState } from "react";
import { CollectionTools } from "../../../components/Collection.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { librarySongSorts, RECENT_FIRST, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { LikedArt } from "../../../components/Art.tsx";
import { DownloadButton } from "../../../components/Buttons.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { ago, plural } from "../../../lib/format.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { useIsDownloaded } from "../../../offline/store.ts";
import { player } from "../../../player/controller.ts";
import { useStarred } from "../../../queries/hooks.ts";
import { useSession } from "../../../state/session.ts";
import { translate } from "../../../i18n/index.ts";

export default function LikedPage() {
  const { data, isLoading } = useStarred();
  const user = useSession((s) => s.credentials?.user ?? "");
  const downloaded = useIsDownloaded("liked");
  const [genre, setGenre] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(RECENT_FIRST);
  const context = {
    kind: "liked" as const,
    id: "liked",
    name: translate("library.likedSongs"),
  };
  usePageTone("#6B2A5A");
  const songs = useMemo(
    () => [...(data?.song ?? [])].sort((a, b) => (b.starred ?? "").localeCompare(a.starred ?? "")),
    [data],
  );
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of songs) if (s.genre) counts.set(s.genre, (counts.get(s.genre) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([g]) => g);
  }, [songs]);
  const shown = useMemo(
    () =>
      shownSongs(
        songs.filter((s) => !genre || s.genre === genre),
        order,
        filter,
      ),
    [songs, genre, order, filter],
  );

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="tinted">
      <Hero
        art={<LikedArt />}
        kind={translate("playlist.kind")}
        title={translate("library.likedSongs")}
        meta={
          <>
            <b>
              <span className="avatar tiny">{user.slice(0, 1).toUpperCase()}</span>
              {user}
            </b>
            <span>{plural(songs.length, "song")}</span>
            {downloaded ? (
              <span className="meta-dl">
                <Icon name="downloaded" size={15} />
                {translate("library.keptDevice")}
              </span>
            ) : null}
          </>
        }
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              value={filter}
              onChange={setFilter}
              label={translate("library.findLikedSongs")}
            />
            <CollectionTools sorts={librarySongSorts()} order={order} onOrder={setOrder} />
          </>
        }
      >
        <PlayContextButton
          contextId="liked"
          label={translate("library.likedSongs")}
          onPlay={() => player.playSongs(shown, 0, context)}
        />
        <ShuffleButton
          label={translate("library.likedSongs")}
          onShuffle={() => player.playSongs(shown, 0, context, { shuffle: true })}
        />
        <DownloadButton
          target={{
            id: "liked",
            kind: "liked",
            name: translate("library.likedSongs"),
            subtitle: translate("playlist.kind"),
          }}
          songs={songs}
        />
      </ActBar>
      {genres.length > 1 ? (
        <div className="chips page-chips" role="group" aria-label={translate("library.filterGenre")}>
          <button type="button" className="pill" aria-pressed={!genre} onClick={() => setGenre(null)}>
            {translate("common.all")}
          </button>
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              className="pill"
              aria-pressed={genre === g}
              onClick={() => setGenre(genre === g ? null : g)}
            >
              {g}
            </button>
          ))}
        </div>
      ) : null}
      {songs.length ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{
            label: translate("library.dateAdded"),
            value: (song) => ago(song.starred),
            sort: "added",
          }}
          order={order}
          onOrder={setOrder}
          fallback={RECENT_FIRST}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>{translate("library.likedSongsEmpty")}</h2>
          <p className="muted">{translate("library.likedSongsHint")}</p>
        </div>
      )}
    </div>
  );
}
