import { GetCard, GetSongCard } from "../../../components/GetCard.tsx";
import { RowHeader } from "../../../components/Cards.tsx";
import type { Filter } from "../../../components/SearchResults.tsx";
import { translate } from "../../../i18n/index.ts";
import { useLidarrSearch, useRequests, useSongCandidates } from "../../../queries/hooks.ts";
import { GET_MUSIC_FILTERS } from "../constants/search.ts";

type GetMusicSearchSourceProps = {
  albumsOn: boolean;
  filter: Filter;
  q: string;
  songsOn: boolean;
};

export function GetMusicSearchSource({ q, filter, albumsOn, songsOn }: GetMusicSearchSourceProps) {
  const showAlbums = albumsOn && GET_MUSIC_FILTERS.albums.includes(filter);
  const showSongs = songsOn && GET_MUSIC_FILTERS.songs.includes(filter);
  const lidarr = useLidarrSearch(q, showAlbums);
  const songs = useSongCandidates(q, showSongs);
  const { data: requests = [] } = useRequests();
  const requestsByReference = new Map(requests.map((request) => [`${request.kind}:${request.ref}`, request]));
  const showFew = filter === "All";
  const albums = lidarr.data?.albums ?? [];
  const asking = lidarr.isPending || lidarr.isFetching;
  const showSectionHeadings = showAlbums && showSongs;

  return (
    <section className="res-source" aria-label={translate("search.notInLibrary")}>
      <div className="source-h">
        <h2>{translate("search.notInLibrary")}</h2>
        <p className="sub">
          {albumsOn && songsOn
            ? translate("search.getBothHint")
            : albumsOn
              ? translate("search.getAlbumsHint")
              : translate("search.getSongsHint")}{" "}
          {translate("search.getSuffix")}
        </p>
      </div>
      {showAlbums ? (
        <>
          {showSectionHeadings ? <RowHeader title={translate("catalog.albums")} /> : null}
          {albums.length ? (
            <div className="get">
              {(showFew ? albums.slice(0, 6) : albums).map((album) => (
                <GetCard
                  key={album.foreignAlbumId}
                  album={album}
                  request={requestsByReference.get(`album:${album.foreignAlbumId}`)}
                />
              ))}
            </div>
          ) : asking ? (
            <p className="muted source-note">
              <span className="spin" />
              {translate("search.lidarrLoading", { query: q })}
            </p>
          ) : (
            <p className="muted source-note">{translate("search.lidarrEmpty", { query: q })}</p>
          )}
        </>
      ) : null}
      {showSongs ? (
        <>
          {showSectionHeadings ? <RowHeader title={translate("catalog.songs")} /> : null}
          {songs.data?.length ? (
            <div className="get">
              {(showFew ? songs.data.slice(0, 4) : songs.data).map((song) => (
                <GetSongCard key={song.id} song={song} request={requestsByReference.get(`song:${song.id}`)} />
              ))}
            </div>
          ) : songs.isPending || songs.isFetching ? (
            <p className="muted source-note">
              <span className="spin" />
              {translate("search.songLookup", { query: q })}
            </p>
          ) : (
            <p className="muted source-note">
              {songs.isError ? translate("search.musicBrainzError") : translate("search.noSongs", { query: q })}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
