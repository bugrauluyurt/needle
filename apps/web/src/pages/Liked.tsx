import { useMemo, useState } from "react";
import { LikedArt } from "../components/Art.tsx";
import { DownloadButton } from "../components/Buttons.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { ago, artistName, plural } from "../lib/format.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { useIsDownloaded } from "../offline/store.ts";
import { player } from "../player/controller.ts";
import { useStarred } from "../queries/hooks.ts";
import { useSession } from "../state/session.ts";

const CONTEXT = { kind: "liked" as const, id: "liked", name: "Liked songs" };

export default function LikedPage() {
  const { data, isLoading } = useStarred();
  const user = useSession((s) => s.credentials?.user ?? "");
  const downloaded = useIsDownloaded("liked");
  const [genre, setGenre] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  usePageTone("#6B2A5A");
  const songs = useMemo(() => [...(data?.song ?? [])].sort((a, b) => (b.starred ?? "").localeCompare(a.starred ?? "")), [data]);
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of songs) if (s.genre) counts.set(s.genre, (counts.get(s.genre) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g);
  }, [songs]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return songs.filter((s) => (!genre || s.genre === genre) && (!q || `${s.title} ${artistName(s)} ${s.album ?? ""}`.toLowerCase().includes(q)));
  }, [songs, genre, filter]);

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="tinted">
      <Hero
        art={<LikedArt />}
        kind="Playlist"
        title="Liked songs"
        meta={
          <>
            <b><span className="avatar tiny">{user.slice(0, 1).toUpperCase()}</span>{user}</b>
            <span>{plural(songs.length, "song")}</span>
            {downloaded ? <span className="meta-dl"><Icon name="downloaded" size={15} />Kept on this device</span> : null}
          </>
        }
      />
      <ActBar
        end={
          <label className="find">
            <Icon name="search" size={17} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in liked songs" aria-label="Find in liked songs" />
          </label>
        }
      >
        <PlayContextButton contextId="liked" label="Liked songs" onPlay={() => player.playSongs(shown, 0, CONTEXT)} />
        <ShuffleButton label="Liked songs" onShuffle={() => player.playSongs(shown, 0, CONTEXT, { shuffle: true })} />
        <DownloadButton target={{ id: "liked", kind: "liked", name: "Liked songs", subtitle: "Playlist" }} songs={songs} />
      </ActBar>
      {genres.length > 1 ? (
        <div className="chips page-chips" role="group" aria-label="Filter by genre">
          <button type="button" className="pill" aria-pressed={!genre} onClick={() => setGenre(null)}>All</button>
          {genres.map((g) => (
            <button key={g} type="button" className="pill" aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>
          ))}
        </div>
      ) : null}
      {songs.length ? (
        <TrackList songs={shown} context={CONTEXT} art album column={{ label: "Date added", value: (s) => ago(s.starred) }} onPlay={(i) => player.playSongs(shown, i, CONTEXT)} />
      ) : (
        <div className="pad empty-inline">
          <h2>Songs you like appear here</h2>
          <p className="muted">Tap the heart on any song to save it to your Liked songs.</p>
        </div>
      )}
    </div>
  );
}
