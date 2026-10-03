import contextlib
import dataclasses
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


bridge_spec = importlib.util.spec_from_file_location("needle_youtube_music", Path(__file__).parent.parent / "src" / "youtube-music.py")
bridge_module = importlib.util.module_from_spec(bridge_spec)
bridge_spec.loader.exec_module(bridge_module)
Bridge = bridge_module.YouTubeMusicBridge


class YouTubeMusicBridgeTests(unittest.TestCase):
    def setUp(self):
        self.music = MagicMock()
        self.ytmusic_module = types.ModuleType("ytmusicapi")
        self.ytmusic_module.YTMusic = MagicMock(return_value=self.music)
        self.ytmusic_module.OAuthCredentials = MagicMock()
        self.requests_module = types.ModuleType("requests")
        self.requests_module.Session = MagicMock()
        self.enum_module = types.ModuleType("ytmusicapi.models.content.enums")
        self.enum_module.LikeStatus = types.SimpleNamespace(LIKE="LIKE", INDIFFERENT="INDIFFERENT")

        self.modules = patch.dict(sys.modules, {
            "ytmusicapi": self.ytmusic_module,
            "requests": self.requests_module,
            "ytmusicapi.models.content.enums": self.enum_module,
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def request(self, operation, parameters=None):
        return {
            "operation": operation,
            "parameters": parameters or {},
            "credentials": {"clientId": "client", "clientSecret": "secret"},
            "token": {"access_token": "access", "refresh_token": "refresh", "expires_at": 2000000000,
                      "expires_in": 3600, "scope": "https://www.googleapis.com/auth/youtube", "token_type": "Bearer"},
        }

    def test_followed_artists_use_subscriptions(self):
        self.music.get_library_subscriptions.return_value = []

        self.assertEqual(Bridge.run(self.request("artists", {"limit": 101})), [])
        self.music.get_library_subscriptions.assert_called_once_with(limit=101)
        self.music.get_library_artists.assert_not_called()

    def test_album_save_uses_audio_playlist_id(self):
        self.music.get_album.return_value = {"audioPlaylistId": "OLAKexample", "playlistId": "wrong"}
        self.music.rate_playlist.return_value = {}

        Bridge.run(self.request("saveAlbum", {"id": "MPREexample", "on": True}))

        self.music.rate_playlist.assert_called_once_with("OLAKexample", "LIKE")

    def test_follow_uses_subscription_channel_not_browse_id(self):
        self.music.get_artist.return_value = {"channelId": "UCsubscription"}
        self.music.subscribe_artist.return_value = {}

        Bridge.run(self.request("follow", {"id": "MPLAUCartist", "on": True}))

        self.music.get_artist.assert_called_once_with("MPLAUCartist")
        self.music.subscribe_artist.assert_called_once_with("UCsubscription")

    def test_artist_songs_expand_documented_browse_playlist(self):
        self.music.get_artist.return_value = {"songs": {"browseId": "VLPLallSongs", "results": []}}
        self.music.get_playlist.return_value = {"tracks": []}

        self.assertEqual(Bridge.run(self.request("artistSongs", {"id": "UCartist", "limit": 101})), {"tracks": []})
        self.music.get_playlist.assert_called_once_with("VLPLallSongs", limit=101)

    def test_radio_and_lyrics_dispatch_to_the_watch_playlist(self):
        self.music.get_watch_playlist.return_value = {"lyrics": "MPLYlyrics", "tracks": []}
        self.music.get_lyrics.return_value = {"lyrics": "Words", "hasTimestamps": False}

        Bridge.run(self.request("radio", {"id": "abcdefghijk", "limit": 50}))
        self.music.get_watch_playlist.assert_called_with(videoId="abcdefghijk", radio=True, limit=50)
        self.assertEqual(Bridge.run(self.request("lyrics", {"id": "abcdefghijk"})), {"lyrics": "Words", "hasTimestamps": False})
        self.music.get_lyrics.assert_called_once_with("MPLYlyrics", timestamps=True)

    def test_auth_uses_in_memory_token_dictionary(self):
        self.music.get_account_info.return_value = {}
        request = self.request("account")

        Bridge.run(request)

        self.assertIs(self.ytmusic_module.YTMusic.call_args.kwargs["auth"], request["token"])

    def test_stream_resolution_never_uses_google_credentials_or_cookies(self):
        options = {}
        resolver = MagicMock()
        resolver.extract_info.return_value = {"url": "https://rr1.googlevideo.com/audio", "ext": "m4a", "acodec": "mp4a.40.2"}
        resolver.__enter__.return_value = resolver
        resolver_module = types.ModuleType("yt_dlp")

        def youtube_dl(resolver_options):
            options.update(resolver_options)

            return resolver

        resolver_module.YoutubeDL = youtube_dl
        with patch.dict(sys.modules, {"yt_dlp": resolver_module}):
            request = {"operation": "resolve", "parameters": {"id": "abcdefghijk"}, "node": "/usr/local/bin/node"}
            self.assertEqual(Bridge.run(request), {"url": "https://rr1.googlevideo.com/audio", "ext": "m4a", "codec": "mp4a.40.2"})

        resolver.extract_info.assert_called_once_with("https://music.youtube.com/watch?v=abcdefghijk", download=False)
        self.assertFalse(options["cachedir"])
        self.assertTrue(options["skip_download"])
        self.assertNotIn("cookiefile", options)
        self.assertNotIn("username", options)
        self.assertNotIn("password", options)
        self.ytmusic_module.YTMusic.assert_not_called()

    def test_rejects_unknown_operation_before_constructing_client(self):
        with self.assertRaises(ValueError):
            Bridge.run(self.request("delete_playlist"))

        self.ytmusic_module.YTMusic.assert_not_called()

    def test_error_envelope_sanitizes_exception_text(self):
        self.music.get_account_info.side_effect = RuntimeError("401 access-token-private refresh-token-private")
        output = io.StringIO()

        with patch.object(sys, "stdin", io.StringIO(json.dumps(self.request("account")))), contextlib.redirect_stdout(output):
            Bridge.main()

        self.assertEqual(json.loads(output.getvalue()), {"error": "auth_reconnect"})
        self.assertNotIn("private", output.getvalue())

    def test_serializes_lyrics_dataclass_and_preserves_millisecond_timestamps(self):
        @dataclasses.dataclass
        class LyricLine:
            text: str
            start_time: int

        @dataclasses.dataclass
        class Lyrics:
            lyrics: list
            hasTimestamps: bool

        self.music.get_watch_playlist.return_value = {"lyrics": "MPLYlyrics"}
        self.music.get_lyrics.return_value = Lyrics([LyricLine("First line", 1250)], True)
        output = io.StringIO()

        with patch.object(sys, "stdin", io.StringIO(json.dumps(self.request("lyrics", {"id": "abcdefghijk"})))), contextlib.redirect_stdout(output):
            Bridge.main()

        self.assertEqual(json.loads(output.getvalue()), {"data": {"lyrics": [{"text": "First line", "start_time": 1250}], "hasTimestamps": True}})


if __name__ == "__main__":
    unittest.main()
