import { useQueryClient } from "@tanstack/react-query";
import type { Person } from "@needle/shared";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { ago } from "../../../lib/format.ts";
import { keys } from "../../../queries/keys.ts";
import { usePeople } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";

function PersonRow({ person }: { person: Person }) {
  const queryClient = useQueryClient();
  const updatePerson = (personUpdate: Partial<Pick<Person, "canRequest" | "canSpotify" | "canYouTubeMusic">>) =>
    void api.setPerson(person.user, personUpdate).then(
      () => void queryClient.invalidateQueries({ queryKey: keys.people }),
      (updateError: unknown) =>
        toast(updateError instanceof Error ? updateError.message : translate("settings.changeFailed")),
    );

  return (
    <div className="set-row person-row">
      <div>
        <b>
          {person.user}
          {person.admin ? <span className="person-badge">{translate("settings.admin")}</span> : null}
        </b>
        <span>
          {person.admin
            ? translate("settings.adminPersonHint")
            : person.lastSeen
              ? translate("settings.lastHere", {
                  time: ago(new Date(person.lastSeen).toISOString()),
                })
              : translate("settings.neverOpened")}
        </span>
      </div>
      <label className="person-switch">
        <span>{translate("settings.requestMusic")}</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={person.canRequest}
          aria-label={translate("settings.personCanRequest", {
            user: person.user,
          })}
          disabled={person.admin}
          onClick={() => updatePerson({ canRequest: !person.canRequest })}
        />
      </label>
      <label className="person-switch">
        <span>Spotify</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={person.canSpotify}
          aria-label={translate("settings.personCanSpotify", {
            user: person.user,
          })}
          onClick={() => updatePerson({ canSpotify: !person.canSpotify })}
        />
      </label>
      <label className="person-switch">
        <span>YouTube Music</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={person.canYouTubeMusic ?? person.admin}
          aria-label={translate("settings.personCanYouTube", {
            user: person.user,
          })}
          onClick={() =>
            updatePerson({
              canYouTubeMusic: !(person.canYouTubeMusic ?? person.admin),
            })
          }
        />
      </label>
    </div>
  );
}

export function PeopleSettings() {
  const { data: people = [], isPending } = usePeople(true);

  return (
    <>
      <h2>{translate("settings.people")}</h2>
      <p className="conn-lede">{translate("settings.peopleHint")}</p>
      {isPending ? (
        <p className="muted source-note">
          <span className="spin" />
          {translate("settings.loadingPeople")}
        </p>
      ) : (
        people.map((person) => <PersonRow key={person.user} person={person} />)
      )}
    </>
  );
}
