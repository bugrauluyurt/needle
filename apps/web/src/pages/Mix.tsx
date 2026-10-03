import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { CollectionTools } from "../components/Collection.tsx";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { MixArt, playMix } from "../components/MixArt.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { longDuration, plural } from "../lib/format.ts";
import { AS_GIVEN, LIBRARY_SONG_SORTS, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { useMixes } from "../queries/hooks.ts";

export default function MixPage() {
  const { id } = useParams();
  const { data, isLoading } = useMixes();
  const mix = data?.find((m) => m.id === id);
  const [songFilter, setSongFilter] = useState("");
  const [songOrder, setSongOrder] = useState<SongOrder>(AS_GIVEN);
  const visibleSongs = useMemo(
    () => shownSongs(mix?.songs ?? [], songOrder, songFilter),
    [mix?.songs, songOrder, songFilter],
  );
  usePageTone(mix?.palette[0] ?? null);
  if (isLoading) return <PageSkeleton />;
  if (!mix) return <NotFoundState what="mix" />;
  const duration = mix.songs.reduce((n, s) => n + (s.duration ?? 0), 0);
  const context = { kind: "mix" as const, id: mix.id, name: mix.name };
  return (
    <div className="tinted">
      <Hero
        art={<MixArt mix={mix} />}
        kind="Mix"
        title={mix.name}
        description={`${mix.description} and more. Made from your library, new every morning.`}
        meta={
          <span>
            {plural(mix.songs.length, "song")}, {longDuration(duration)}
          </span>
        }
      />
      <ActBar
        end={
          <>
            <SearchField variant="inline" collapsible value={songFilter} onChange={setSongFilter} label="Find in mix" />
            <CollectionTools
              sorts={[["custom", "Mix order"], ...LIBRARY_SONG_SORTS]}
              order={songOrder}
              onOrder={setSongOrder}
            />
          </>
        }
      >
        <PlayContextButton contextId={mix.id} label={mix.name} onPlay={() => playMix(mix)} />
        <ShuffleButton label={mix.name} onShuffle={() => playMix(mix, true)} />
        <TrackMoreButton songs={mix.songs} className="icon-btn big" size={26} label={`More options for ${mix.name}`} />
      </ActBar>
      <TrackList songs={visibleSongs} context={context} art album order={songOrder} onOrder={setSongOrder} />
    </div>
  );
}
