import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../components/Icon.tsx";
import { useUi } from "../state/ui.ts";
import { SEEK_STEP_S } from "../player/controller.ts";

const KEYS: [string, string[]][] = [
  ["Play or pause", ["Space"]],
  ["Next song", ["Shift", "→"]],
  ["Previous song", ["Shift", "←"]],
  [`Skip forward ${SEEK_STEP_S} s`, ["→"]],
  [`Skip back ${SEEK_STEP_S} s`, ["←"]],
  ["Volume up or down", ["↑", "↓"]],
  ["Like the song", ["L"]],
  ["Show the playing song in the list", ["Shift", "L"]],
  ["Shuffle", ["S"]],
  ["Repeat", ["R"]],
  ["Search", ["/"]],
  ["Queue", ["Q"]],
  ["Lyrics", ["Y"]],
  ["Full screen", ["F"]],
  ["These shortcuts", ["?"]],
];

export default function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => useUi.setState({ shortcutsOpen: o })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close">
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <div className="keys">
            {KEYS.map(([t, k]) => (
              <div key={t}>
                <span>{t}</span>
                <span>
                  {k.map((x) => (
                    <kbd key={x}>{x}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
