import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { albumItem, CardSkeletons } from "../components/Cards.tsx";
import { CollectionBody, CollectionTools, SORT_LABELS, sortItems, useCollectionView } from "../components/Collection.tsx";
import type { SortOption } from "../components/Collection.tsx";
import type { AlbumListType } from "../lib/subsonic.ts";
import { sub } from "../lib/subsonic.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { NotFoundState } from "../components/Hero.tsx";

const PAGE = 60;
const TITLES: Partial<Record<AlbumListType, string>> = {
  newest: "Recently added",
  recent: "Recently played",
  frequent: "Most played",
  random: "Something different",
  starred: "Liked albums",
  highest: "Highest rated",
  alphabeticalByName: "All albums",
};
const ORDERS: Partial<Record<AlbumListType, string>> = { random: "Shuffled", starred: "Recently liked", alphabeticalByName: "Alphabetical", byYear: "Release date" };

export default function AlbumGrid() {
  const { type = "newest" } = useParams();
  const [params] = useSearchParams();
  const mobile = useIsMobile();
  const from = Number(params.get("from") ?? 0);
  const to = Number(params.get("to") ?? 0);
  const listType = type as AlbumListType;
  const title = listType === "byYear" ? `The ${from}s` : TITLES[listType];
  usePageTone(null);
  const q = useInfiniteQuery({
    queryKey: ["albumGrid", type, from, to],
    queryFn: ({ pageParam }) => sub.albumList(listType, { size: PAGE, offset: pageParam, ...(listType === "byYear" ? { fromYear: from, toYear: to } : {}) }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE && listType !== "random" ? all.length * PAGE : undefined),
    enabled: Boolean(title),
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);
  const sorts: SortOption[] = [["default", ORDERS[listType] ?? title ?? ""], ["title", SORT_LABELS.title], ["by", "Artist"], ["year", SORT_LABELS.year]];
  const c = useCollectionView(`albums-${type}`, sorts);
  const items = useMemo(() => sortItems((q.data?.pages.flat() ?? []).map((a) => albumItem(a)), c.sort), [q.data, c.sort]);
  if (!title) return <NotFoundState what="page" />;
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="pad">
        <div className="library-head">
          <h1 className="hello">{title}</h1>
          <CollectionTools sorts={sorts} sort={c.sort} onSort={c.setSort} view={c.view} onView={c.setView} />
        </div>
        <CollectionBody items={items} view={c.view} empty="No albums here yet." {...(q.isLoading || q.isFetchingNextPage ? { loading: <CardSkeletons n={12} /> } : {})} />
        <div ref={sentinel} />
      </div>
    </>
  );
}
