import type { Mix } from "@needle/shared";
import { player } from "../player/controller.ts";
import { translate } from "../i18n/index.ts";

export function MixArt({
  mix,
  className,
  label = translate("mix.kind"),
}: {
  mix: Pick<Mix, "name" | "palette">;
  className?: string;
  label?: string | null;
}) {
  const [a, b, c] = mix.palette;
  return (
    <div
      className={`art mix-art ${className ?? ""}`}
      style={{
        background: `radial-gradient(60% 55% at 28% 30%, ${b}, transparent 70%), radial-gradient(55% 60% at 78% 72%, ${c}, transparent 70%), ${a}`,
      }}
    >
      {label ? <small>{label}</small> : null}
      <b>{mix.name}</b>
    </div>
  );
}

export function playMix(mix: Mix, shuffle = false) {
  player.playSongs(mix.songs, 0, { kind: "mix", id: mix.id, name: mix.name }, { shuffle });
}
