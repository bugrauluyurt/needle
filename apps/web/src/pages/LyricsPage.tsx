import { LyricsView } from "../components/Lyrics.tsx";
import { useTone } from "../lib/tone.ts";
import { TopBar } from "../layout/TopBar.tsx";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { useCurrentSong } from "../player/store.ts";

export default function LyricsPage() {
  const song = useCurrentSong();
  const mobile = useIsMobile();
  const tone = useTone(song?.coverArt);
  usePageTone(tone);
  return (
    <div className="lyrics-page">
      {mobile ? <MobileBack /> : <TopBar />}
      {song ? (
        <LyricsView song={song} variant="page" />
      ) : (
        <div className="lyrics page none">
          <p className="lyrics-none">Play a song to see its lyrics here</p>
        </div>
      )}
    </div>
  );
}
