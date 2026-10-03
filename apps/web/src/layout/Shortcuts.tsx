import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../components/Icon.tsx";
import { translate } from "../i18n/index.ts";
import { useUi } from "../state/ui.ts";
import { SEEK_STEP_S } from "../player/controller.ts";

const shortcutKeys = (): [string, string[]][] => [
  [translate("shortcuts.playPause"), [translate("shortcuts.space")]],
  [translate("shortcuts.next"), ["Shift", "→"]],
  [translate("shortcuts.previous"), ["Shift", "←"]],
  [translate("shortcuts.forward", { seconds: SEEK_STEP_S }), ["→"]],
  [translate("shortcuts.back", { seconds: SEEK_STEP_S }), ["←"]],
  [translate("shortcuts.volume"), ["↑", "↓"]],
  [translate("shortcuts.like"), ["L"]],
  [translate("shortcuts.showSong"), ["Shift", "L"]],
  [translate("shortcuts.shuffle"), ["S"]],
  [translate("shortcuts.repeat"), ["R"]],
  [translate("shortcuts.search"), ["/"]],
  [translate("shortcuts.queue"), ["Q"]],
  [translate("shortcuts.lyrics"), ["Y"]],
  [translate("shortcuts.fullScreen"), ["F"]],
  [translate("shortcuts.these"), ["?"]],
];

export default function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => useUi.setState({ shortcutsOpen: o })}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">
              {translate("common.keyboardShortcuts")}
            </Dialog.Title>
            <Dialog.Close
              className="icon-btn"
              aria-label={translate("common.close")}
            >
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <div className="keys">
            {shortcutKeys().map(([t, k]) => (
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
