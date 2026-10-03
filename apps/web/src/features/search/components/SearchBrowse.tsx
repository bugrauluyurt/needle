import { Link } from "react-router";
import type { BrowseTile } from "@needle/shared";
import { Art } from "../../../components/Art.tsx";
import { RowHeader } from "../../../components/Cards.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { translate } from "../../../i18n/index.ts";
import { TILE_COLORS } from "../../../lib/palette.ts";
import { useDelayed } from "../../../lib/useDelayed.ts";
import { useBrowse, useCapabilities } from "../../../queries/hooks.ts";

const tileColor = (tileIndex: number) => TILE_COLORS[tileIndex % TILE_COLORS.length] ?? "#1E3C78";

function GenreTile({ tile, color }: { tile: BrowseTile; color: string }) {
  return (
    <Link to={tile.to} className="genre" style={{ "--g": color } as React.CSSProperties}>
      <b>{tile.name}</b>
      <small>{tile.subtitle}</small>
      <div className="fan" aria-hidden="true">
        {tile.covers.map((album) => (
          <Art key={album.id} id={album.coverArt} px={84} />
        ))}
      </div>
    </Link>
  );
}

export function SearchBrowse({
  recent,
  onPick,
  onRemove,
  onClear,
}: {
  recent: string[];
  onPick: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  const tiles = useBrowse();
  const capabilities = useCapabilities();
  const pending = tiles.isPending;
  const skeleton = useDelayed(pending);
  const shownTiles = tiles.data ?? [];

  return (
    <>
      {recent.length ? (
        <>
          <RowHeader
            title={translate("search.recent")}
            action={
              <button type="button" className="show-all" onClick={onClear}>
                {translate("common.clear")}
              </button>
            }
          />
          <div className="recent">
            {recent.map((query) => (
              <span key={query} className="pill outline">
                <button type="button" onClick={() => onPick(query)}>
                  <Icon name="clock" size={15} />
                  {query}
                </button>
                <button
                  type="button"
                  aria-label={translate("search.removeRecent", { query })}
                  onClick={() => onRemove(query)}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        </>
      ) : null}
      {pending ? (
        skeleton ? (
          <div className="genres" aria-busy="true">
            {Array.from({ length: 8 }, (_, tileIndex) => (
              <div key={tileIndex} className="genre skeleton" />
            ))}
          </div>
        ) : null
      ) : shownTiles.length ? (
        <>
          <RowHeader title={translate("search.browse")} subtitle={translate("search.browseHint")} />
          <div className="genres">
            {shownTiles.map((tile, tileIndex) => (
              <GenreTile key={tile.to} tile={tile} color={tileColor(tileIndex)} />
            ))}
          </div>
        </>
      ) : (
        <div className="browse-empty">
          <h2>{translate("search.noBrowse")}</h2>
          <p className="muted">
            {capabilities.data?.lidarr ? translate("empty.searchArtist") : translate("search.libraryEmpty")}
          </p>
        </div>
      )}
    </>
  );
}
