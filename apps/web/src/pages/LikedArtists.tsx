import { useMemo } from "react";
import { artistItem } from "../components/Cards.tsx";
import { CollectionBody, CollectionTools, SORT_LABELS, sortItems, useCollectionView } from "../components/Collection.tsx";
import type { SortOption } from "../components/Collection.tsx";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { useStarred } from "../queries/hooks.ts";

const SORTS: SortOption[] = [["added", SORT_LABELS.added], ["title", SORT_LABELS.title]];

export default function LikedArtistsPage() {
  const mobile = useIsMobile();
  const { data } = useStarred();
  const c = useCollectionView("liked-artists", SORTS);
  const items = useMemo(() => sortItems((data?.artist ?? []).map((a) => ({ ...artistItem(a), added: a.starred ?? "" })), c.order), [data, c.order]);
  usePageTone(null);
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="pad">
        <div className="library-head">
          <h1 className="hello">Liked artists</h1>
          <CollectionTools sorts={SORTS} order={c.order} onOrder={c.setOrder} view={c.view} onView={c.setView} />
        </div>
        <CollectionBody items={items} view={c.view} empty="Artists you like show up here. Tap the heart on an artist’s page." />
      </div>
    </>
  );
}
