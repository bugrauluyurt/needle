import * as Dialog from "@radix-ui/react-dialog";
import { useDetails } from "./songDetailsStore.ts";
import { artistName, clock, count, formatLong } from "../lib/format.ts";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";
import { translate } from "../i18n/index.ts";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const db = (value: number | undefined) =>
  value === undefined ? translate("details.none") : `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

export default function SongDetailsDialog() {
  const song = useDetails((s) => s.song);
  const rows: [string, string][] = song
    ? [
        [translate("details.album"), song.album ?? ""],
        [translate("details.year"), song.year ? String(song.year) : ""],
        [translate("details.genre"), song.genres?.map((genre) => genre.name).join(", ") ?? song.genre ?? ""],
        [translate("details.length"), clock(song.duration)],
        [translate("details.format"), formatLong(song)],
        [translate("details.bitRate"), song.bitRate ? `${count(song.bitRate)} kbps` : ""],
        [translate("details.size"), song.size ? mb(song.size) : ""],
        [translate("details.trackGain"), db(song.replayGain?.trackGain)],
        [translate("details.albumGain"), db(song.replayGain?.albumGain)],
        [translate("details.plays"), song.playCount ? count(song.playCount) : translate("details.notPlayed")],
        [translate("details.file"), song.path ?? ""],
      ]
    : [];
  return (
    <Dialog.Root open={Boolean(song)} onOpenChange={(o) => !o && useDetails.setState({ song: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog details" aria-describedby={undefined}>
          {song ? (
            <>
              <div className="details-head">
                <Art id={song.coverArt} px={72} />
                <div>
                  <Dialog.Title className="dialog-title small">{song.title}</Dialog.Title>
                  <p className="muted">{artistName(song)}</p>
                </div>
                <Dialog.Close className="icon-btn" aria-label={translate("common.close")}>
                  <Icon name="close" />
                </Dialog.Close>
              </div>
              <dl className="kv">
                {rows
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
