import { useParams } from "react-router";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { MixArt, playMix } from "../components/MixArt.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { longDuration, plural } from "../lib/format.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { useMixes } from "../queries/hooks.ts";

export default function MixPage() {
  const { id } = useParams();
  const { data, isLoading } = useMixes();
  const mix = data?.find((m) => m.id === id);
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
        meta={<span>{plural(mix.songs.length, "song")}, {longDuration(duration)}</span>}
      />
      <ActBar>
        <PlayContextButton contextId={mix.id} label={mix.name} onPlay={() => playMix(mix)} />
        <ShuffleButton label={mix.name} onShuffle={() => playMix(mix, true)} />
        <TrackMoreButton songs={mix.songs} className="icon-btn big" size={26} label={`More options for ${mix.name}`} />
      </ActBar>
      <TrackList songs={mix.songs} context={context} art album />
    </div>
  );
}
