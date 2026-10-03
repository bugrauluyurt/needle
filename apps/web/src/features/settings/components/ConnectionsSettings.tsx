import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckState } from "@needle/shared";
import { Icon } from "../../../components/Icon.tsx";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { browserChecks } from "../../../lib/connections.ts";
import { localeCode, plural } from "../../../lib/format.ts";
import { keys } from "../../../queries/keys.ts";
import { toast } from "../../../state/ui.ts";
import { SettingRow } from "./SettingRow.tsx";

function checkStateLabel(checkState: CheckState): string {
  switch (checkState) {
    case "fail":
      return translate("settings.statusFailed");
    case "off":
      return translate("settings.statusOff");
    case "ok":
      return translate("settings.statusWorking");
    case "warn":
      return translate("settings.statusNeedsLook");
  }
}

export function ConnectionsSettings({ publicUrl }: { publicUrl: string | null }) {
  const queryClient = useQueryClient();
  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: keys.status,
    queryFn: () => api.status(false),
    staleTime: 30_000,
  });
  const browserConnectionChecks = browserChecks(publicUrl, location.origin, window.isSecureContext);
  const connectionChecks = [...browserConnectionChecks, ...(data?.checks ?? [])];
  const checkAgain = async () => {
    const freshStatus = await queryClient
      .fetchQuery({
        queryKey: keys.status,
        queryFn: () => api.status(true),
        staleTime: 0,
      })
      .catch(() => null);

    if (!freshStatus) {
      toast(translate("settings.serverFailed"));

      return;
    }

    const problemCount = [...browserConnectionChecks, ...freshStatus.checks].filter(
      (connectionCheck) => connectionCheck.state === "warn" || connectionCheck.state === "fail",
    ).length;

    toast(
      problemCount
        ? translate("settings.connectionsNeedAttention", {
            connections: plural(problemCount, "connection"),
          })
        : translate("settings.connectionsAllWorking"),
    );
  };

  return (
    <>
      <div className="conn-head">
        <h2>{translate("settings.connections")}</h2>
        <button type="button" className="btn ghost sm" disabled={isFetching} onClick={() => void checkAgain()}>
          {isFetching ? (
            <>
              <span className="spin" />
              {translate("settings.checking")}
            </>
          ) : (
            <>
              <Icon name="refresh" size={15} />
              {translate("settings.checkAgain")}
            </>
          )}
        </button>
      </div>
      <p className="conn-lede">
        {translate("settings.connectionsSummary")}
        {dataUpdatedAt
          ? ` ${translate("settings.checkedAt", {
              time: new Intl.DateTimeFormat(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(dataUpdatedAt),
            })}`
          : ""}
      </p>
      {connectionChecks.map((connectionCheck) => (
        <SettingRow
          key={connectionCheck.id}
          title={connectionCheck.label}
          hint={
            <>
              {connectionCheck.detail}
              {connectionCheck.fix && connectionCheck.state !== "ok" ? (
                <em className="conn-fix">{connectionCheck.fix}</em>
              ) : null}
            </>
          }
        >
          <span className={`conn-state ${connectionCheck.state}`}>{checkStateLabel(connectionCheck.state)}</span>
        </SettingRow>
      ))}
    </>
  );
}
