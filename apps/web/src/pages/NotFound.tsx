import { Link } from "react-router";
import { translate } from "../i18n/index.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { TopBar } from "../layout/TopBar.tsx";

export default function NotFound() {
  usePageTone(null);
  return (
    <>
      <TopBar />
      <div className="empty">
        <div className="empty-in">
          <h1>{translate("empty.addressHeading")}</h1>
          <p>{translate("empty.addressText")}</p>
          <div className="acts">
            <Link to="/" className="btn primary">
              {translate("empty.goHome")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
