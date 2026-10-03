import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { CollectionTools } from "../components/Collection.tsx";
import {
  ActBar,
  Hero,
  NotFoundState,
  PageSkeleton,
  PlayContextButton,
  ShuffleButton,
} from "../components/Hero.tsx";
import { MixArt, playMix } from "../components/MixArt.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { TrackMoreButton } from "../components/tracks/TrackMenu.tsx";
import { TrackList } from "../components/tracks/TrackList.tsx";
import { longDuration, plural } from "../lib/format.ts";
import { AS_GIVEN, librarySongSorts, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { useMixes } from "../queries/hooks.ts";
import { translate } from "../i18n/index.ts";

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
        kind={translate("mix.kind")}
        title={mix.name}
        description={translate("mix.description", {
          description: mix.description,
        })}
        meta={
          <span>
            {plural(mix.songs.length, "song")}, {longDuration(duration)}
          </span>
        }
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              collapsible
              value={songFilter}
              onChange={setSongFilter}
              label={translate("mix.find")}
            />
            <CollectionTools
              sorts={[
                ["custom", translate("mix.order")],
                ...librarySongSorts(),
              ]}
              order={songOrder}
              onOrder={setSongOrder}
            />
          </>
        }
      >
        <PlayContextButton
          contextId={mix.id}
          label={mix.name}
          onPlay={() => playMix(mix)}
        />
        <ShuffleButton label={mix.name} onShuffle={() => playMix(mix, true)} />
        <TrackMoreButton
          songs={mix.songs}
          className="icon-btn big"
          size={26}
          label={translate("track.moreOptions", { title: mix.name })}
        />
      </ActBar>
      <TrackList
        songs={visibleSongs}
        context={context}
        art
        album
        order={songOrder}
        onOrder={setSongOrder}
      />
    </div>
  );
}
