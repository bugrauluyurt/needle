import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { Song } from "@needle/shared";
import {
  fold,
  isLocalSong,
  songSource,
  youtubeMusicLink,
} from "@needle/shared";
import { spotifyLink } from "../../../features/spotify/api/client.ts";
import type { SpImage } from "../../../features/spotify/api/client.ts";
import {
  useSpotifyPlaylistEdits,
  useSpotifyPlaylists,
} from "../../../features/spotify/hooks/useSpotify.ts";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { albumPath, artistPath } from "../../../lib/paths.ts";
import { player } from "../../../player/controller.ts";
import {
  useAddToPlaylist,
  useCapabilities,
  useCreatePlaylist,
  useGetSong,
  usePlaylists,
} from "../../../queries/hooks.ts";
import { useSongLikes } from "../../../queries/likes.ts";
import { toast } from "../../../state/ui.ts";
import { openSongDetails } from "../../songDetailsStore.ts";
import type { TrackMenuAction, TrackMenuExtra } from "../types.ts";

type PlaylistTarget = {
  id: string;
  name: string;
  art: {
    id?: string | undefined;
    images?: SpImage[] | null | undefined;
    version?: string | undefined;
  };
};

const isTrackMenuAction = (
  action: TrackMenuAction | false | undefined,
): action is TrackMenuAction => Boolean(action);

export function useTrackActions(
  songs: Song[],
  extra?: TrackMenuExtra[],
): TrackMenuAction[][] {
  const navigate = useNavigate();
  const songLikes = useSongLikes();
  const capabilities = useCapabilities().data;
  const getSong = useGetSong();
  const song = songs[0];

  if (!song) return [];

  const spotify = songs.every(
    (selectedSong) => songSource(selectedSong) === "spotify",
  );
  const youtubeMusic = songs.every(
    (selectedSong) => songSource(selectedSong) === "youtubeMusic",
  );
  const local = songs.every(isLocalSong);
  const liked = songs.every(songLikes.isLiked);
  const playableSongs = songs.filter(
    (selectedSong) => selectedSong.isAvailable !== false,
  );
  const single = songs.length === 1;
  const { artistId, albumId } = song;
  const provider = youtubeMusic ? "YouTube Music " : spotify ? "Spotify " : "";
  const getAlbum = async () => {
    const {
      albums: [album],
    } = await api
      .lidarrSearch(`${song.artist ?? ""} ${song.album ?? ""}`)
      .catch(() => ({ albums: [] }));

    if (!album) {
      toast(translate("menu.lidarrNotFound"));

      return;
    }

    await api.lidarrGet(album.foreignAlbumId).then(
      () => toast(translate("menu.lidarrLooking", { title: album.title })),
      () => toast(translate("menu.lidarrFailed")),
    );
  };
  const actionGroups: (TrackMenuAction | false | undefined)[][] = [
    [
      playableSongs.length > 0 && {
        id: "queue",
        icon: "addToQueue",
        label: translate("menu.addToQueue"),
        quick: translate("menu.addToQueue"),
        run: () => {
          player.addToQueue(playableSongs);
          toast(
            single
              ? translate("menu.addedToQueue")
              : translate("menu.queueSongs", { count: playableSongs.length }),
          );
        },
      },
      playableSongs.length > 0 && {
        id: "next",
        icon: "playNext",
        label: translate("menu.playNext"),
        quick: translate("menu.playNext"),
        run: () => {
          player.playNext(playableSongs);
          toast(
            single
              ? translate("menu.playsNext")
              : translate("menu.queueSongs", { count: playableSongs.length }),
          );
        },
      },
      single &&
        song.isAvailable !== false && {
          id: "radio",
          icon: "radio",
          label: translate("menu.startRadio"),
          run: () => void player.startRadio({ song, name: song.title }),
        },
    ],
    [
      (spotify || local) && {
        id: "playlist",
        icon: "plus",
        label: translate("menu.addToPlaylist"),
        playlists: true,
        run: () => undefined,
      },
      {
        id: "like",
        icon: liked ? "heartFill" : "heart",
        label: translate(liked ? "menu.removeLiked" : "menu.saveLiked", {
          provider,
        }),
        quick: translate(liked ? "menu.liked" : "menu.like"),
        on: liked,
        run: () =>
          songs.forEach((selectedSong) =>
            songLikes.setLiked(selectedSong, !liked),
          ),
      },
      single &&
        (spotify || youtubeMusic) &&
        capabilities?.songs && {
          id: "get-song",
          icon: "download",
          label: translate("menu.getSong"),
          run: () =>
            void getSong({
              id: song.id,
              title: song.title,
              artist: song.artists?.[0]?.name ?? song.artist ?? "",
              album: song.album ?? null,
              duration: song.duration ?? null,
              year: song.year ?? null,
              coverUrl: song.coverArt ?? null,
            }),
        },
      single &&
        (spotify || youtubeMusic) &&
        capabilities?.lidarr && {
          id: "get-album",
          icon: "download",
          label: translate("menu.getAlbum"),
          run: () => void getAlbum(),
        },
      ...(extra ?? []).map((extraAction) => ({
        id: extraAction.label,
        ...extraAction,
      })),
    ],
    single
      ? [
          artistId
            ? {
                id: "artist",
                icon: "user",
                label: translate("menu.goToArtist"),
                go: true,
                run: () => void navigate(artistPath(artistId)),
              }
            : false,
          albumId
            ? {
                id: "album",
                icon: "album",
                label: translate("menu.goToAlbum"),
                go: true,
                run: () => void navigate(albumPath(albumId)),
              }
            : false,
          youtubeMusic
            ? {
                id: "open",
                icon: "link",
                label: translate("menu.openYouTubeMusic"),
                go: true,
                run: () =>
                  void window.open(
                    youtubeMusicLink("song", song.id),
                    "_blank",
                    "noopener",
                  ),
              }
            : spotify
              ? {
                  id: "open",
                  icon: "link",
                  label: translate("menu.openSpotify"),
                  go: true,
                  run: () =>
                    void window.open(
                      spotifyLink("track", song.id),
                      "_blank",
                      "noopener",
                    ),
                }
              : {
                  id: "details",
                  icon: "info",
                  label: translate("menu.songDetails"),
                  go: true,
                  run: () => openSongDetails(song),
                },
        ]
      : [],
  ];

  return actionGroups
    .map((actionGroup) => actionGroup.filter(isTrackMenuAction))
    .filter((actionGroup) => actionGroup.length);
}

export function usePlaylistTargets(songs: Song[]) {
  const spotify = songs.every((song) => songSource(song) === "spotify");
  const { data: localPlaylists = [] } = usePlaylists();
  const { data: spotifyPlaylists = [] } = useSpotifyPlaylists();
  const spotifyPlaylistEdits = useSpotifyPlaylistEdits();
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [filter, setFilter] = useState("");
  const playlistTargets = useMemo<PlaylistTarget[]>(
    () =>
      spotify
        ? spotifyPlaylists
            .filter((playlist) => playlist.mine)
            .map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              art: { images: playlist.images },
            }))
        : localPlaylists
            .filter((playlist) => !playlist.readonly)
            .map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              art: { id: playlist.coverArt, version: playlist.changed },
            })),
    [spotify, spotifyPlaylists, localPlaylists],
  );
  const shownPlaylists = useMemo(
    () =>
      playlistTargets.filter((playlist) =>
        fold(playlist.name).includes(fold(filter)),
      ),
    [playlistTargets, filter],
  );
  const playlistName =
    songs.length === 1 && songs[0]
      ? songs[0].title
      : translate("menu.newPlaylist");
  const songIds = songs.map((song) => song.id);

  return {
    spotify,
    shown: shownPlaylists,
    filter,
    setFilter,
    addTo: (playlist: PlaylistTarget) => {
      if (spotify) void spotifyPlaylistEdits.add(playlist, songs);
      else
        void addToPlaylist
          .mutateAsync({ playlistId: playlist.id, songIds })
          .then(
            () =>
              toast(
                translate("menu.addedToNamedPlaylist", { name: playlist.name }),
              ),
            () => toast(translate("menu.couldNotAdd", { name: playlist.name })),
          );
    },
    createNew: () => {
      if (spotify) void spotifyPlaylistEdits.create(playlistName, songs);
      else
        void createPlaylist.mutateAsync({ name: playlistName, songIds }).then(
          (playlist) =>
            toast(
              translate("menu.addedToNamedPlaylist", { name: playlist.name }),
            ),
          () => toast(translate("menu.couldNotCreatePlaylist")),
        );
    },
  };
}
