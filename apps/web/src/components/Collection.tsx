import * as DM from "@radix-ui/react-dropdown-menu";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { usePlayer } from "../player/store.ts";
import type { CollectionView, SortKey } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";
import { CardRow, ItemCard, RowHeader } from "./Cards.tsx";
import { Eq, Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

export type CollectionItem = {
  key: string;
  to: string;
  art: (px: number) => ReactNode;
  title: string;
  subtitle: string;
  by?: string;
  added?: string;
  year?: number;
  contextId?: string;
  downloaded?: boolean;
  pinned?: boolean;
  source?: "spotify";
  onPlay?: () => void;
};

export type SortOption = [SortKey, string];

const LIST_ART = 56;

export const SORT_LABELS = { added: "Recently added", title: "Alphabetical", year: "Release date" } as const;

export const RELEASE_SORTS: SortOption[] = [["year", SORT_LABELS.year], ["title", SORT_LABELS.title]];

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const ORDER: Record<Exclude<SortKey, "default">, (a: CollectionItem, b: CollectionItem) => number> = {
  added: (a, b) => (b.added ?? "").localeCompare(a.added ?? ""),
  title: (a, b) => compare(a.title, b.title),
  by: (a, b) => compare(a.by ?? "", b.by ?? "") || compare(a.title, b.title),
  year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || compare(a.title, b.title),
};

export function sortItems<T extends CollectionItem>(items: T[], sort: SortKey): T[] {
  if (sort === "default") return items;
  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned).toSorted(ORDER[sort])];
}

export function useCollectionView(id: string, sorts: SortOption[], fallback: CollectionView = "grid") {
  const saved = useUi((s) => s.collections[id]);
  const sort = sorts.some(([k]) => k === saved?.sort) ? (saved?.sort ?? "default") : (sorts[0]?.[0] ?? "default");
  const view = saved?.view ?? fallback;
  const set = (patch: { view?: CollectionView; sort?: SortKey }) =>
    useUi.setState((s) => ({ collections: { ...s.collections, [id]: { view, sort, ...patch } } }));
  return { view, sort, setView: (v: CollectionView) => set({ view: v }), setSort: (k: SortKey) => set({ sort: k }) };
}

const VIEWS: [CollectionView, string, IconName][] = [["compact", "Compact", "rows"], ["list", "List", "list"], ["dense", "Compact grid", "gridDense"], ["grid", "Grid", "grid"]];

export type ShowFilter<S extends string> = { value: S; options: [S, string][]; onChange: (s: S) => void };

export function CollectionTools<K extends string, S extends string = string>({ sorts, sort, onSort, view, onView, show }: {
  sorts: [K, string][];
  sort?: K;
  onSort?: (k: K) => void;
  view?: CollectionView;
  onView?: (v: CollectionView) => void;
  show?: ShowFilter<S> | undefined;
}) {
  const sortLabel = sorts.length > 1 ? (sorts.find(([k]) => k === sort)?.[1] ?? sorts[0]?.[1]) : undefined;
  const showLabel = show && show.value !== show.options[0]?.[0] ? show.options.find(([v]) => v === show.value)?.[1] : undefined;
  const label = [showLabel, sortLabel].filter(Boolean).join(", ") || (show?.options[0]?.[1] ?? "");
  const views = Boolean(view && onView);
  if (sorts.length < 2 && !views && !show) return null;
  const icon = VIEWS.find(([v]) => v === view)?.[2] ?? "sort";
  return (
    <div className="coll-tools">
      <DM.Root modal={false}>
        <DM.Trigger asChild>
          <button type="button" className="coll-sort" aria-label={`${show ? "Show and sort" : "Sort"}: ${label}${views ? `, view as ${view ?? ""}` : ""}`} data-no-tip>
            <span>{label}</span>
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
                      <DM.ItemIndicator className="menu-end"><Icon name="check" size={16} /></DM.ItemIndicator>
                    </DM.RadioItem>
                  ))}
                </DM.RadioGroup>
                {sorts.length > 1 || views ? <DM.Separator className="menu-sep" /> : null}
              </>
            ) : null}
            {sorts.length > 1 && onSort ? (
              <>
                <DM.Label className="menu-heading">Sort by</DM.Label>
                <DM.RadioGroup value={sort} onValueChange={(v) => onSort(v as K)}>
                  {sorts.map(([k, l]) => (
                    <DM.RadioItem key={k} value={k} className="menu-item">
                      <span className="menu-label">{l}</span>
                      <DM.ItemIndicator className="menu-end"><Icon name="check" size={16} /></DM.ItemIndicator>
                    </DM.RadioItem>
                  ))}
                </DM.RadioGroup>
              </>
            ) : null}
            {views && onView ? (
              <>
                {sorts.length > 1 ? <DM.Separator className="menu-sep" /> : null}
                <DM.Label className="menu-heading">View as</DM.Label>
                <DM.RadioGroup className="view-as" value={view} onValueChange={(v) => onView(v as CollectionView)}>
                  {VIEWS.map(([v, l, i]) => (
                    <DM.RadioItem key={v} value={v} className="view-opt" aria-label={l} title={l} onSelect={(e) => e.preventDefault()}>
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

export function ItemList({ items, empty, compact = false }: { items: CollectionItem[]; empty?: string; compact?: boolean }) {
  const ctx = usePlayer((s) => s.context?.id);
  const playing = usePlayer((s) => s.playing);
  const { pathname } = useLocation();
  return (
    <ul className={compact ? "lib-list compact scroll-thin" : "lib-list scroll-thin"}>
      {items.map((e) => {
        const isPlaying = Boolean(e.contextId) && ctx === e.contextId;
        return (
          <li key={e.key}>
            <Link to={e.to} className={`lib-item ${pathname === e.to ? "on" : ""}`}>
              {e.art(LIST_ART)}
              <div className="lib-text">
                <div className={`t ${isPlaying ? "playing" : ""}`}>{e.title}</div>
                <div className="s">
                  {e.downloaded ? <span className="dl"><Icon name="downloaded" size={14} /></span> : null}
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

export function CollectionBody({ items, view, empty, loading }: { items: CollectionItem[]; view: CollectionView; empty?: string; loading?: ReactNode }) {
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
        {items.map((i) => <ItemCard key={i.key} item={i} />)}
        {loading}
      </CardRow>
      {!items.length && !loading && empty ? <p className="muted">{empty}</p> : null}
    </>
  );
}

export function Collection({ id, title, subtitle, items, sorts, empty, loading, fallback = "grid" }: {
  id: string;
  title: string;
  subtitle?: string;
  items: CollectionItem[];
  sorts: SortOption[];
  empty?: string;
  loading?: ReactNode;
  fallback?: CollectionView;
}) {
  const c = useCollectionView(id, sorts, fallback);
  const sorted = useMemo(() => sortItems(items, c.sort), [items, c.sort]);
  return (
    <section className="collection">
      <RowHeader title={title} {...(subtitle ? { subtitle } : {})} action={<CollectionTools sorts={sorts} sort={c.sort} onSort={c.setSort} view={c.view} onView={c.setView} />} />
      <CollectionBody items={sorted} view={c.view} {...(empty ? { empty } : {})} {...(loading ? { loading } : {})} />
    </section>
  );
}
