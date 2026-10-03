import contextlib
import dataclasses
import functools
import importlib.metadata
import json
import re
import sys


class SilentLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


class YouTubeMusicBridge:
    OPERATIONS = {
        "health",
        "resolve",
        "account",
        "liked",
        "albums",
        "artists",
        "playlists",
        "search",
        "album",
        "artist",
        "artistSongs",
        "artistReleases",
        "playlist",
        "lyrics",
        "radio",
        "like",
        "saveAlbum",
        "follow",
    }

    @staticmethod
    def run(request):
        operation = request.get("operation")
        if operation not in YouTubeMusicBridge.OPERATIONS:
            raise ValueError("Unknown operation")

        if operation == "health":
            return YouTubeMusicBridge._health(request.get("component"))

        parameters = request.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("Invalid parameters")

        if operation == "resolve":
            return YouTubeMusicBridge._stream(parameters, request.get("node"))

        import requests
        from ytmusicapi import OAuthCredentials, YTMusic

        credentials = request["credentials"]
        provider_session = requests.Session()
        provider_session.request = functools.partial(provider_session.request, timeout=20)

        youtube_music_client = YTMusic(
            auth=request["token"],
            oauth_credentials=OAuthCredentials(
                credentials["clientId"], credentials["clientSecret"], session=provider_session
            ),
            requests_session=provider_session,
        )
        limit = parameters.get("limit", 100)
        music_id = parameters.get("id")

        match operation:
            case "account":
                return youtube_music_client.get_account_info()
            case "liked":
                return youtube_music_client.get_liked_songs(limit=limit)
            case "albums":
                return youtube_music_client.get_library_albums(limit=limit)
            case "artists":
                return youtube_music_client.get_library_subscriptions(limit=limit)
            case "playlists":
                return youtube_music_client.get_library_playlists(limit=limit)
            case "search":
                return youtube_music_client.search(parameters["query"], filter=parameters.get("kind"), limit=limit)
            case "album":
                return youtube_music_client.get_album(music_id)
            case "artist":
                return youtube_music_client.get_artist(music_id)
            case "playlist":
                return youtube_music_client.get_playlist(music_id, limit=limit)
            case "radio":
                return youtube_music_client.get_watch_playlist(videoId=music_id, radio=True, limit=limit)
            case "lyrics":
                playlist = youtube_music_client.get_watch_playlist(videoId=music_id, limit=1)
                lyrics_id = playlist.get("lyrics")
                return youtube_music_client.get_lyrics(lyrics_id, timestamps=True) if lyrics_id else None
            case "like":
                from ytmusicapi.models.content.enums import LikeStatus

                return youtube_music_client.rate_song(
                    music_id, LikeStatus.LIKE if parameters["on"] else LikeStatus.INDIFFERENT
                )
            case "saveAlbum":
                from ytmusicapi.models.content.enums import LikeStatus

                playlist_id = youtube_music_client.get_album(music_id).get("audioPlaylistId")
                if not playlist_id:
                    raise ValueError("Album has no playlist")

                return youtube_music_client.rate_playlist(
                    playlist_id, LikeStatus.LIKE if parameters["on"] else LikeStatus.INDIFFERENT
                )
            case "follow" | "artistSongs" | "artistReleases":
                artist = youtube_music_client.get_artist(music_id)
            case _:
                raise ValueError("Unknown operation")

        if operation == "follow":
            channel_id = artist.get("channelId")
            if not channel_id:
                raise ValueError("Artist has no subscription channel")

            return (
                youtube_music_client.subscribe_artist(channel_id)
                if parameters["on"]
                else youtube_music_client.unsubscribe_artists([channel_id])
            )

        artist_section = artist.get("songs" if operation == "artistSongs" else parameters["kind"], {})
        artist_browse_id = artist_section.get("browseId")
        if operation == "artistSongs":
            return (
                youtube_music_client.get_playlist(artist_browse_id, limit=limit)
                if artist_browse_id
                else {"tracks": artist_section.get("results", [])}
            )

        if artist_browse_id and artist_section.get("params"):
            return youtube_music_client.get_artist_albums(artist_browse_id, artist_section["params"], limit=limit)

        return artist_section.get("results", [])

    @staticmethod
    def main():
        try:
            request = json.load(sys.stdin)
            if not isinstance(request, dict):
                raise ValueError("Invalid request")

            with contextlib.redirect_stdout(sys.stderr):
                response_data = YouTubeMusicBridge.run(request)

            print(json.dumps({"data": response_data}, default=YouTubeMusicBridge._json_value, allow_nan=False))
        except Exception as error:
            print(json.dumps({"error": YouTubeMusicBridge._error_code(error)}))

    @staticmethod
    def _json_value(value):
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return dataclasses.asdict(value)

        raise TypeError("Unsupported provider response")

    @staticmethod
    def _error_code(error):
        error_message = str(error).lower()
        if "429" in error_message or "too many requests" in error_message:
            return "quota"
        if "401" in error_message or "invalid_grant" in error_message or "unauthorized" in error_message:
            return "auth_reconnect"
        if isinstance(error, (ModuleNotFoundError, importlib.metadata.PackageNotFoundError)):
            return "runtime_missing"

        return "upstream"

    @staticmethod
    def _health(component):
        distribution = "ytmusicapi" if component == "metadata" else "yt-dlp"
        expected_version = "1.12.3" if distribution == "ytmusicapi" else "2026.8.19"
        installed_version = importlib.metadata.version(distribution)
        if installed_version != expected_version:
            raise RuntimeError("Unexpected dependency version")

        if distribution == "ytmusicapi":
            import ytmusicapi

            return {"version": installed_version, "available": callable(ytmusicapi.YTMusic)}

        import yt_dlp
        import yt_dlp_ejs

        return {
            "version": installed_version,
            "available": callable(yt_dlp.YoutubeDL) and yt_dlp_ejs is not None,
        }

    @staticmethod
    def _stream(parameters, node):
        from yt_dlp import YoutubeDL

        video_id = parameters.get("id", "")
        if not isinstance(video_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError("Invalid video id")

        options = {
            "format": "bestaudio[ext=m4a][protocol=https]/bestaudio[acodec=opus][protocol=https]/bestaudio[protocol=https]",
            "skip_download": True,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "cachedir": False,
            "socket_timeout": 20,
            "retries": 0,
            "extractor_retries": 0,
            "js_runtimes": {"node": {"path": node}},
            "logger": SilentLogger(),
        }
        with YoutubeDL(options) as resolver:
            song = resolver.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)

        if not song or not song.get("url"):
            raise RuntimeError("No playable audio")

        return {"url": song["url"], "ext": song.get("ext"), "codec": song.get("acodec")}


if __name__ == "__main__":
    YouTubeMusicBridge.main()
