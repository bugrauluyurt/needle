import type { ConnectionCheck } from "@needle/shared";
import { translate } from "../i18n/index.ts";

export function browserChecks(publicUrl: string | null, origin: string, secure: boolean): ConnectionCheck[] {
  const https: ConnectionCheck = secure
    ? {
        id: "https",
        label: translate("connections.secureTitle"),
        state: "ok",
        detail: translate("connections.httpsDetail", { origin }),
      }
    : {
        id: "https",
        label: translate("connections.secureTitle"),
        state: "warn",
        detail: translate("connections.httpsInsecureDetail", { origin }),
        fix: translate("connections.httpsFix"),
      };
  const address: ConnectionCheck = !publicUrl
    ? {
        id: "public-url",
        label: translate("connections.publicTitle"),
        state: "off",
        detail: translate("connections.publicDetailMissing"),
        fix: translate("connections.publicFixMissing"),
      }
    : publicUrl === origin
      ? {
          id: "public-url",
          label: translate("connections.publicTitle"),
          state: "ok",
          detail: publicUrl,
        }
      : {
          id: "public-url",
          label: translate("connections.publicTitle"),
          state: "warn",
          detail: translate("connections.publicMismatch", {
            publicUrl,
            origin,
          }),
          fix: translate("connections.publicMismatchFix"),
        };
  return [https, address];
}
