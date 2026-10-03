import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { squarePhoto } from "../../../lib/photo.ts";
import { AvatarFace } from "../../../layout/TopBar.tsx";
import { keys } from "../../../queries/keys.ts";
import { useMe } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";
import { SettingRow } from "./SettingRow.tsx";

export function PhotoSetting() {
  const queryClient = useQueryClient();
  const { data: person } = useMe();
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const refreshPerson = () => queryClient.invalidateQueries({ queryKey: keys.me });
  const uploadPhoto = async (photo: File) => {
    setBusy(true);

    try {
      await api.setPhoto(await squarePhoto(photo));
      await refreshPerson();
      toast(translate("settings.photoUpdated"));
    } catch (photoError) {
      toast(photoError instanceof Error ? photoError.message : translate("settings.photoSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow title={translate("settings.photo")} hint={translate("settings.photoHint")}>
      <div className="photo-set">
        <span className="avatar">
          <AvatarFace px={44} />
        </span>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(photoEvent) => {
            const photo = photoEvent.target.files?.[0];

            photoEvent.target.value = "";

            if (photo) void uploadPhoto(photo);
          }}
        />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => photoInput.current?.click()}>
          {busy
            ? translate("settings.saving")
            : person?.photo
              ? translate("common.edit")
              : translate("settings.choosePhoto")}
        </button>
        {person?.photo ? (
          <button type="button" className="btn ghost sm" onClick={() => void api.removePhoto().then(refreshPerson)}>
            {translate("settings.remove")}
          </button>
        ) : null}
      </div>
    </SettingRow>
  );
}
