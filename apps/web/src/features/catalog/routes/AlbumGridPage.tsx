import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { matchesTerms, queryTerms } from "@needle/shared";
import { albumItem, CardSkeletons } from "../../../components/Cards.tsx";
import {
  CollectionBody,
  CollectionTools,
  SORT_LABELS,
  sortItems,
  useCollectionView,
} from "../../../components/Collection.tsx";
import type { SortOption } from "../../../components/Collection.tsx";
import type { AlbumListType } from "../../../lib/subsonic.ts";
import { sub } from "../../../lib/subsonic.ts";
import { compareText } from "../../../lib/order.ts";
import { SearchField } from "../../../components/SearchField.tsx";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import { NotFoundState } from "../../../components/Hero.tsx";
import { useAllAlbums, useStarred } from "../../../queries/hooks.ts";
import { translate } from "../../../i18n/index.ts";

const PAGE = 60;
const titles = (): Partial<Record<AlbumListType, string>> => ({
  newest: translate("home.recentlyAdded"),
  recent: translate("albumGrid.recentlyPlayed"),
  frequent: translate("home.mostPlayed"),
  random: translate("home.somethingDifferent"),
  starred: translate("albumGrid.liked"),
  highest: translate("albumGrid.highest"),
  alphabeticalByName: translate("albumGrid.all"),
});
const orders = (): Partial<Record<AlbumListType, string>> => ({
  random: translate("albumGrid.shuffled"),
  starred: translate("albumGrid.recentlyLiked"),
  alphabeticalByName: translate("library.alphabetical"),
  byYear: translate("library.releaseDate"),
});

export default function AlbumGrid() {
  const { type = "newest" } = useParams();
  const [params] = useSearchParams();
  const [albumFilter, setAlbumFilter] = useState("");
  const mobile = useIsMobile();
  const from = Number(params.get("from") ?? 0);
  const to = Number(params.get("to") ?? 0);
  const listType = type as AlbumListType;
  const title =
    listType === "byYear"
      ? translate("albumGrid.decade", { year: from })
      : titles()[listType];
  usePageTone(null);
  const libraryAlbums = useAllAlbums();
  const starred = useStarred();
  const q = useInfiniteQuery({
    queryKey: ["albumGrid", type, from, to],
    queryFn: ({ pageParam }) =>
      sub.albumList(listType, {
        size: PAGE,
        offset: pageParam,
        ...(listType === "byYear" ? { fromYear: from, toYear: to } : {}),
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.length === PAGE && listType !== "random"
        ? all.length * PAGE
        : undefined,
    enabled: Boolean(title),
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage)
          void q.fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [q]);
  const sorts: SortOption[] = [
    ["default", orders()[listType] ?? title ?? ""],
    ["title", SORT_LABELS.title],
    ["by", translate("sort.artist")],
    ["year", SORT_LABELS.year],
    ["plays", translate("sort.mostPlayed")],
  ];
  const c = useCollectionView(`albums-${type}`, sorts);
  const complete =
    listType !== "random" &&
    (Boolean(albumFilter.trim()) || c.order.key !== "default");
  const items = useMemo(() => {
    const albums = complete
      ? listType === "starred"
        ? (starred.data?.album ?? [])
        : (libraryAlbums.data ?? [])
      : (q.data?.pages.flat() ?? []);
    const terms = queryTerms(albumFilter);
    const matchingAlbums = albums.filter((album) => {
      if (complete && listType === "recent" && !album.played) return false;
      if (complete && listType === "frequent" && !album.playCount) return false;
      if (complete && listType === "highest" && !album.userRating) return false;
      if (
        complete &&
        listType === "byYear" &&
        ((album.year ?? 0) < Math.min(from, to) ||
          (album.year ?? 0) > Math.max(from, to))
      )
        return false;

      return matchesTerms(terms, album.name, album.artist, album.displayArtist);
    });

    if (complete && c.order.key === "default") {
      if (listType === "recent")
        matchingAlbums.sort((albumA, albumB) =>
          (albumB.played ?? "").localeCompare(albumA.played ?? ""),
        );
      if (listType === "frequent")
        matchingAlbums.sort(
          (albumA, albumB) => (albumB.playCount ?? 0) - (albumA.playCount ?? 0),
        );
      if (listType === "highest")
        matchingAlbums.sort(
          (albumA, albumB) =>
            (albumB.userRating ?? 0) - (albumA.userRating ?? 0),
        );
      if (listType === "starred")
        matchingAlbums.sort((albumA, albumB) =>
          (albumB.starred ?? "").localeCompare(albumA.starred ?? ""),
        );
      if (listType === "alphabeticalByName")
        matchingAlbums.sort((albumA, albumB) =>
          compareText(albumA.name, albumB.name),
        );
      if (listType === "byYear")
        matchingAlbums.sort(
          (albumA, albumB) => (albumA.year ?? 0) - (albumB.year ?? 0),
        );
    }

    return sortItems(
      matchingAlbums.map((album) => albumItem(album)),
      c.order,
    );
  }, [
    complete,
    listType,
    starred.data,
    libraryAlbums.data,
    q.data,
    albumFilter,
    c.order,
    from,
    to,
  ]);
  const loading = complete
    ? listType === "starred"
      ? starred.isLoading
      : libraryAlbums.isLoading
    : q.isLoading || q.isFetchingNextPage;
  if (!title) return <NotFoundState what="page" />;
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="pad">
        <div className="library-head">
          <h1 className="hello">{title}</h1>
          <div className="collection-actions">
            <SearchField
              variant="inline"
              collapsible
              value={albumFilter}
              onChange={setAlbumFilter}
              label={translate(
                listType === "random"
                  ? "albumGrid.findSelection"
                  : "albumGrid.find",
              )}
            />
            <CollectionTools
              sorts={sorts}
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
            albumFilter.trim() ? "albumGrid.noMatch" : "albumGrid.noAlbums",
          )}
          {...(loading ? { loading: <CardSkeletons n={12} /> } : {})}
        />
        {!complete ? <div ref={sentinel} /> : null}
      </div>
    </>
  );
}
