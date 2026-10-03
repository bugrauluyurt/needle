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
        "health", "resolve", "account", "liked", "albums", "artists", "playlists", "search",
        "album", "artist", "artistSongs", "artistReleases", "playlist", "lyrics", "radio",
        "like", "saveAlbum", "follow",
    }

    @staticmethod
    def run(request):
        operation = request.get("operation")
        if operation not in YouTubeMusicBridge.OPERATIONS:
            raise ValueError("Unknown operation")

        if operation == "health":
            distribution = "ytmusicapi" if request.get("component") == "metadata" else "yt-dlp"
            expected = "1.12.3" if distribution == "ytmusicapi" else "2026.8.19"
            version = importlib.metadata.version(distribution)
            if version != expected:
                raise RuntimeError("Unexpected dependency version")

            if distribution == "ytmusicapi":
                import ytmusicapi

                return {"version": version, "available": callable(ytmusicapi.YTMusic)}

            import yt_dlp
            import yt_dlp_ejs

            return {"version": version, "available": callable(yt_dlp.YoutubeDL) and yt_dlp_ejs is not None}

        parameters = request.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("Invalid parameters")

        if operation == "resolve":
            return YouTubeMusicBridge._stream(parameters, request.get("node"))

        import requests
        from ytmusicapi import OAuthCredentials, YTMusic

        credentials = request["credentials"]
        session = requests.Session()
        session.request = functools.partial(session.request, timeout=20)

        music = YTMusic(
            auth=request["token"],
            oauth_credentials=OAuthCredentials(credentials["clientId"], credentials["clientSecret"], session=session),
            requests_session=session,
        )
        limit = parameters.get("limit", 100)
        music_id = parameters.get("id")

        if operation == "account":
            return music.get_account_info()
        if operation == "liked":
            return music.get_liked_songs(limit=limit)
        if operation == "albums":
            return music.get_library_albums(limit=limit)
        if operation == "artists":
            return music.get_library_subscriptions(limit=limit)
        if operation == "playlists":
            return music.get_library_playlists(limit=limit)
        if operation == "search":
            return music.search(parameters["query"], filter=parameters.get("kind"), limit=limit)
        if operation == "album":
            return music.get_album(music_id)
        if operation == "artist":
            return music.get_artist(music_id)
        if operation == "playlist":
            return music.get_playlist(music_id, limit=limit)
        if operation == "radio":
            return music.get_watch_playlist(videoId=music_id, radio=True, limit=limit)
        if operation == "lyrics":
            playlist = music.get_watch_playlist(videoId=music_id, limit=1)
            lyrics_id = playlist.get("lyrics")
            return music.get_lyrics(lyrics_id, timestamps=True) if lyrics_id else None
        if operation == "like":
            from ytmusicapi.models.content.enums import LikeStatus

            return music.rate_song(music_id, LikeStatus.LIKE if parameters["on"] else LikeStatus.INDIFFERENT)
        if operation == "saveAlbum":
            from ytmusicapi.models.content.enums import LikeStatus

            playlist_id = music.get_album(music_id).get("audioPlaylistId")
            if not playlist_id:
                raise ValueError("Album has no playlist")

            return music.rate_playlist(playlist_id, LikeStatus.LIKE if parameters["on"] else LikeStatus.INDIFFERENT)

        artist = music.get_artist(music_id)
        if operation == "follow":
            channel_id = artist.get("channelId")
            if not channel_id:
                raise ValueError("Artist has no subscription channel")

            return music.subscribe_artist(channel_id) if parameters["on"] else music.unsubscribe_artists([channel_id])

        section = artist.get("songs" if operation == "artistSongs" else parameters["kind"], {})
        browse_id = section.get("browseId")
        if operation == "artistSongs":
            return music.get_playlist(browse_id, limit=limit) if browse_id else {"tracks": section.get("results", [])}

        if browse_id and section.get("params"):
            return music.get_artist_albums(browse_id, section["params"], limit=limit)

        return section.get("results", [])

    @staticmethod
    def main():
        try:
            request = json.load(sys.stdin)
            if not isinstance(request, dict):
                raise ValueError("Invalid request")

            with contextlib.redirect_stdout(sys.stderr):
                result = YouTubeMusicBridge.run(request)

            print(json.dumps({"data": result}, default=YouTubeMusicBridge._json_value, allow_nan=False))
        except Exception as error:
            print(json.dumps({"error": YouTubeMusicBridge._error_code(error)}))

    @staticmethod
    def _json_value(value):
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return dataclasses.asdict(value)

        raise TypeError("Unsupported provider response")

    @staticmethod
    def _error_code(error):
        message = str(error).lower()
        if "429" in message or "too many requests" in message:
            return "quota"
        if "401" in message or "invalid_grant" in message or "unauthorized" in message:
            return "auth_reconnect"
        if isinstance(error, ModuleNotFoundError) or isinstance(error, importlib.metadata.PackageNotFoundError):
            return "runtime_missing"

        return "upstream"

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
