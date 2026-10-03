import * as Dialog from "@radix-ui/react-dialog";
import { useDetails } from "./songDetailsStore.ts";
import { artistName, clock, count, formatLong } from "../lib/format.ts";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const db = (v: number | undefined) => (v === undefined ? "None" : `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`);

export default function SongDetailsDialog() {
  const song = useDetails((s) => s.song);
  const rows: [string, string][] = song
    ? [
        ["Album", song.album ?? ""],
        ["Year", song.year ? String(song.year) : ""],
        ["Genre", song.genres?.map((g) => g.name).join(", ") ?? song.genre ?? ""],
        ["Length", clock(song.duration)],
        ["Format", formatLong(song)],
        ["Bitrate", song.bitRate ? `${count(song.bitRate)} kbps` : ""],
        ["Size", song.size ? mb(song.size) : ""],
        ["Track gain", db(song.replayGain?.trackGain)],
        ["Album gain", db(song.replayGain?.albumGain)],
        ["Plays", song.playCount ? count(song.playCount) : "Not played yet"],
        ["File", song.path ?? ""],
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
                <Dialog.Close className="icon-btn" aria-label="Close">
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
