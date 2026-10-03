import * as DM from "@radix-ui/react-dropdown-menu";
import { useMemo, useState } from "react";
import { matchesTerms, queryTerms } from "@needle/shared";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { usePlayer } from "../player/store.ts";
import type { CollectionState, CollectionView, SortKey } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";
import { CardRow, ItemCard, RowHeader } from "./Cards.tsx";
import { Eq, Icon } from "./Icon.tsx";
import { applyOrder, compareText, directional, naturalOrder, pickOrder } from "../lib/order.ts";
import type { Order } from "../lib/order.ts";
import type { IconName } from "./Icon.tsx";
import { SearchField } from "./SearchField.tsx";
import { SourceMark } from "./SpotifyMark.tsx";
import type { MusicSource } from "@needle/shared";

export type CollectionItem = {
  key: string;
  to: string;
  art: (px: number) => ReactNode;
  title: string;
  subtitle: string;
  by?: string;
  added?: string;
  year?: number;
  releaseDate?: string;
  playCount?: number;
  contextId?: string;
  downloaded?: boolean;
  pinned?: boolean;
  source?: Exclude<MusicSource, "library">;
  onPlay?: () => void;
};

export type SortOption = [SortKey, string];
export type CollectionOrder = Order<SortKey>;

const LIST_ART = 56;

export const SORT_LABELS = { added: "Date added", title: "Alphabetical", year: "Release date" } as const;

export const RELEASE_SORTS: SortOption[] = [
  ["year", SORT_LABELS.year],
  ["title", SORT_LABELS.title],
];

const COMPARE: Record<Exclude<SortKey, "default">, (a: CollectionItem, b: CollectionItem) => number> = {
  added: (a, b) => (a.added ?? "").localeCompare(b.added ?? ""),
  title: (a, b) => compareText(a.title, b.title),
  by: (a, b) => compareText(a.by ?? "", b.by ?? "") || compareText(a.title, b.title),
  year: (firstItem, secondItem) =>
    (firstItem.releaseDate ?? String(firstItem.year ?? "")).localeCompare(
      secondItem.releaseDate ?? String(secondItem.year ?? ""),
    ),
  plays: (firstItem, secondItem) => (firstItem.playCount ?? 0) - (secondItem.playCount ?? 0),
};

export function sortItems<T extends CollectionItem>(items: T[], order: CollectionOrder): T[] {
  if (order.key === "default") return items;

  if (order.key === "year") {
    const pinnedItems = items.filter((collectionItem) => collectionItem.pinned);
    const datedItems = items.filter(
      (collectionItem) => !collectionItem.pinned && Boolean(collectionItem.releaseDate ?? collectionItem.year),
    );
    const undatedItems = items.filter(
      (collectionItem) => !collectionItem.pinned && !(collectionItem.releaseDate ?? collectionItem.year),
    );

    return [...pinnedItems, ...applyOrder(datedItems, COMPARE.year, order.desc), ...undatedItems];
  }

  return [
    ...items.filter((i) => i.pinned),
    ...applyOrder(
      items.filter((i) => !i.pinned),
      COMPARE[order.key],
      order.desc,
    ),
  ];
}

export function useCollectionView(id: string, sorts: SortOption[], fallback: CollectionView = "grid") {
  const saved = useUi((s) => s.collections[id]);
  const key = sorts.some(([k]) => k === saved?.sort) ? (saved?.sort ?? "default") : (sorts[0]?.[0] ?? "default");
  const order: CollectionOrder = {
    key,
    desc: key === saved?.sort ? (saved.desc ?? naturalOrder(key).desc) : naturalOrder(key).desc,
  };
  const view = saved?.view ?? fallback;
  const set = (patch: CollectionState) =>
    useUi.setState((s) => ({ collections: { ...s.collections, [id]: { ...s.collections[id], ...patch } } }));
  return {
    view,
    order,
    setView: (v: CollectionView) => set({ view: v }),
    setOrder: (o: CollectionOrder) => set({ sort: o.key, desc: o.desc }),
  };
}

export function SortArrow({ desc }: { desc: boolean }) {
  return <Icon name="arrow" size={14} className={desc ? "sort-arrow" : "sort-arrow up"} />;
}

const VIEWS: [CollectionView, string, IconName][] = [
  ["compact", "Compact", "rows"],
  ["list", "List", "list"],
  ["dense", "Compact grid", "gridDense"],
  ["grid", "Grid", "grid"],
];

export type ShowFilter<S extends string> = { value: S; options: [S, string][]; onChange: (s: S) => void };

export function CollectionTools<K extends string, S extends string = string>({
  sorts,
  order,
  onOrder,
  view,
  onView,
  show,
}: {
  sorts: [K, string][];
  order?: Order<K>;
  onOrder?: (o: Order<K>) => void;
  view?: CollectionView;
  onView?: (v: CollectionView) => void;
  show?: ShowFilter<S> | undefined;
}) {
  const sorting = sorts.length > 1 && order && onOrder ? { order, onOrder } : null;
  const sortLabel = sorting ? (sorts.find(([k]) => k === sorting.order.key)?.[1] ?? sorts[0]?.[1]) : undefined;
  const directed = Boolean(sorting && directional(sorting.order.key));
  const showLabel =
    show && show.value !== show.options[0]?.[0] ? show.options.find(([v]) => v === show.value)?.[1] : undefined;
  const label = [showLabel, sortLabel].filter(Boolean).join(", ") || (show?.options[0]?.[1] ?? "");
  const direction = directed && sorting ? (sorting.order.desc ? ", descending" : ", ascending") : "";
  const views = Boolean(view && onView);
  if (!sorting && !views && !show) return null;
  const icon = VIEWS.find(([v]) => v === view)?.[2] ?? "sort";
  return (
    <div className="coll-tools">
      <DM.Root modal={false}>
        <DM.Trigger asChild>
          <button
            type="button"
            className="coll-sort"
            aria-label={`${show ? "Show and sort" : "Sort"}: ${label}${direction}${views ? `, view as ${view ?? ""}` : ""}`}
            data-no-tip
          >
            <span>{label}</span>
            {directed && sorting ? <SortArrow desc={sorting.order.desc} /> : null}
            <Icon name={icon} size={16} />
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className="menu coll-menu" align="end" sideOffset={6} collisionPadding={12}>
            {show ? (
              <>
                <DM.Label className="menu-heading">Show</DM.Label>
                <DM.RadioGroup value={show.value} onValueChange={(v) => show.onChange(v as S)}>
                  {show.options.map(([v, l]) => (
                    <DM.RadioItem key={v} value={v} className="menu-item">
                      <span className="menu-label">{l}</span>
                      <DM.ItemIndicator className="menu-end">
                        <Icon name="check" size={16} />
                      </DM.ItemIndicator>
                    </DM.RadioItem>
                  ))}
                </DM.RadioGroup>
                {sorting || views ? <DM.Separator className="menu-sep" /> : null}
              </>
            ) : null}
            {sorting ? (
              <>
                <DM.Label className="menu-heading">Sort by</DM.Label>
                <DM.RadioGroup value={sorting.order.key}>
                  {sorts.map(([k, l]) => (
                    <DM.RadioItem
                      key={k}
                      value={k}
                      className="menu-item"
                      onSelect={(e) => {
                        if (k === sorting.order.key && directional(k)) e.preventDefault();
                        sorting.onOrder(pickOrder(sorting.order, k));
                      }}
                    >
                      <span className="menu-label">{l}</span>
                      <DM.ItemIndicator className="menu-end">
                        {directional(k) ? <SortArrow desc={sorting.order.desc} /> : <Icon name="check" size={16} />}
                      </DM.ItemIndicator>
                    </DM.RadioItem>
                  ))}
                </DM.RadioGroup>
              </>
            ) : null}
            {views && onView ? (
              <>
                {sorting ? <DM.Separator className="menu-sep" /> : null}
                <DM.Label className="menu-heading">View as</DM.Label>
                <DM.RadioGroup className="view-as" value={view} onValueChange={(v) => onView(v as CollectionView)}>
                  {VIEWS.map(([v, l, i]) => (
                    <DM.RadioItem
                      key={v}
                      value={v}
                      className="view-opt"
                      aria-label={l}
                      title={l}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <Icon name={i} size={18} />
                    </DM.RadioItem>
                  ))}
                </DM.RadioGroup>
              </>
            ) : null}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
    </div>
  );
}

export function ItemList({
  items,
  empty,
  compact = false,
}: {
  items: CollectionItem[];
  empty?: string;
  compact?: boolean;
}) {
  const ctx = usePlayer((s) => s.context?.id);
  const playing = usePlayer((s) => s.playing);
  const { pathname } = useLocation();
  return (
    <ul className={compact ? "lib-list compact scroll-thin" : "lib-list scroll-thin"}>
      {items.map((e) => {
        const isPlaying = Boolean(e.contextId) && ctx === e.contextId;
        return (
          <li key={e.key}>
            <Link
              to={e.to}
              className={`lib-item ${pathname === e.to ? "on" : ""}`}
              aria-label={`${e.title}, ${e.subtitle}`}
            >
              {e.art(LIST_ART)}
              <div className="lib-text">
                <div className={`t ${isPlaying ? "playing" : ""}`}>{e.title}</div>
                <div className="s">
                  {e.downloaded ? (
                    <span className="dl">
                      <Icon name="downloaded" size={14} />
                    </span>
                  ) : null}
                  <SourceMark source={e.source} compact />
                  <span className="ellipsis">{e.subtitle}</span>
                </div>
              </div>
              {isPlaying ? <Eq paused={!playing} /> : null}
            </Link>
          </li>
        );
      })}
      {!items.length && empty ? <li className="lib-empty">{empty}</li> : null}
    </ul>
  );
}

export function CollectionBody({
  items,
  view,
  empty,
  loading,
}: {
  items: CollectionItem[];
  view: CollectionView;
  empty?: string;
  loading?: ReactNode;
}) {
  if (view === "list" || view === "compact") {
    return (
      <>
        <ItemList items={items} compact={view === "compact"} {...(loading ? {} : { empty })} />
        {loading}
      </>
    );
  }
  return (
    <>
      <CardRow grid dense={view === "dense"}>
        {items.map((i) => (
          <ItemCard key={i.key} item={i} />
        ))}
        {loading}
      </CardRow>
      {!items.length && !loading && empty ? <p className="muted">{empty}</p> : null}
    </>
  );
}

export function Collection({
  id,
  title,
  subtitle,
  items,
  sorts,
  empty,
  loading,
  fallback = "grid",
  preview,
  to,
  searchable = preview === undefined,
}: {
  id: string;
  title: string;
  subtitle?: string;
  items: CollectionItem[];
  sorts: SortOption[];
  empty?: string;
  loading?: ReactNode;
  fallback?: CollectionView;
  preview?: number;
  to?: string;
  searchable?: boolean;
}) {
  const c = useCollectionView(id, sorts, fallback);
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => {
    const terms = queryTerms(searchable ? query : "");
    const matchingItems = items.filter((collectionItem) =>
      matchesTerms(terms, collectionItem.title, collectionItem.subtitle, collectionItem.by),
    );

    return sortItems(matchingItems, c.order);
  }, [items, c.order, query, searchable]);

  const shownItems = preview ? sorted.slice(0, preview) : sorted;

  return (
    <section className="collection">
      <RowHeader
        title={title}
        {...(subtitle ? { subtitle } : {})}
        action={
          <div className="collection-actions">
            {searchable ? (
              <SearchField
                variant="inline"
                collapsible
                label={`Search ${title.toLowerCase()}`}
                value={query}
                onChange={setQuery}
              />
            ) : null}
            <CollectionTools sorts={sorts} order={c.order} onOrder={c.setOrder} view={c.view} onView={c.setView} />
            {preview && sorted.length > preview && to ? (
              <Link to={to} className="show-all">
                Show all
              </Link>
            ) : null}
          </div>
        }
      />
      <CollectionBody
        items={shownItems}
        view={c.view}
        empty={searchable && query.trim() ? `No ${title.toLowerCase()} match “${query.trim()}”.` : (empty ?? "")}
        {...(loading ? { loading } : {})}
      />
    </section>
  );
}
