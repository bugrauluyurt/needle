import { useMemo, useState } from "react";
import { matchesTerms, queryTerms } from "@needle/shared";
import { artistItem } from "../../../components/Cards.tsx";
import {
  CollectionBody,
  CollectionTools,
  SORT_LABELS,
  sortItems,
  useCollectionView,
} from "../../../components/Collection.tsx";
import type { SortOption } from "../../../components/Collection.tsx";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import { useStarred } from "../../../queries/hooks.ts";
import { translate } from "../../../i18n/index.ts";
import { SearchField } from "../../../components/SearchField.tsx";

const SORTS: SortOption[] = [
  ["added", SORT_LABELS.added],
  ["title", SORT_LABELS.title],
];

export default function LikedArtistsPage() {
  const mobile = useIsMobile();
  const { data } = useStarred();
  const [artistFilter, setArtistFilter] = useState("");
  const c = useCollectionView("liked-artists", SORTS);
  const items = useMemo(
    () =>
      sortItems(
        (data?.artist ?? [])
          .filter((artist) =>
            matchesTerms(queryTerms(artistFilter), artist.name),
          )
          .map((artist) => ({
            ...artistItem(artist),
            added: artist.starred ?? "",
          })),
        c.order,
      ),
    [data, c.order, artistFilter],
  );
  usePageTone(null);
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="pad">
        <div className="library-head">
          <h1 className="hello">{translate("library.likedArtists")}</h1>
          <div className="collection-actions">
            <SearchField
              variant="inline"
              collapsible
              value={artistFilter}
              onChange={setArtistFilter}
              label={translate("library.findLikedArtists")}
            />
            <CollectionTools
              sorts={SORTS}
              order={c.order}
              onOrder={c.setOrder}
              view={c.view}
              onView={c.setView}
            />
          </div>
        </div>
        <CollectionBody
          items={items}
          view={c.view}
          empty={translate(
            artistFilter.trim()
              ? "library.noLikedArtistMatch"
              : "library.noLikedArtists",
          )}
        />
      </div>
    </>
  );
}
