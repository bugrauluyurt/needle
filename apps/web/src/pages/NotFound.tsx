import { Link } from "react-router";
import { usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";

export default function NotFound() {
  usePageTone(null);
  return (
    <>
      <TopBar />
      <div className="empty">
        <div className="empty-in">
          <h1>There’s nothing at this address</h1>
          <p>The link may be old, or the page moved.</p>
          <div className="acts">
            <Link to="/" className="btn primary">Go home</Link>
          </div>
        </div>
      </div>
    </>
  );
}
