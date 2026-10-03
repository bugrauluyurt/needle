import { useEffect } from "react";
import type { RefObject } from "react";
import { useLocation } from "react-router";
import { useScrollContainer } from "../components/ScrollContext.ts";

const COVER = ".hero-art > .art, .a-hero .bg > .art";

export function useScrolledTitle(
  barRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLElement | null>,
  coverRef?: RefObject<HTMLElement | null>,
) {
  const { key } = useLocation();
  const scroller = useScrollContainer();
  useEffect(() => {
    const main = scroller?.current;
    const bar = barRef.current;
    const title = titleRef.current;
    const cover = coverRef?.current;
    if (!main || !bar || !title) return;
    let seen: IntersectionObserver | null = null;
    const watch = (heading: HTMLHeadingElement) => {
      title.textContent = heading.textContent;
      const art = cover ? main.querySelector(COVER) : null;
      if (cover && art) {
        cover.replaceChildren(art.cloneNode(true));
        cover.classList.toggle("round", Boolean(art.closest(".a-hero")));
        cover.toggleAttribute("hidden", false);
      }
      seen = new IntersectionObserver(
        ([e]) =>
          bar.classList.toggle(
            "titled",
            Boolean(
              e &&
              !e.isIntersecting &&
              e.boundingClientRect.top < (e.rootBounds?.top ?? 0),
            ),
          ),
        {
          root: main,
          rootMargin: `-${bar.offsetHeight}px 0px 0px 0px`,
        },
      );
      seen.observe(heading);
    };
    const found = main.querySelector("h1");
    const wait = new MutationObserver(() => {
      const heading = main.querySelector("h1");
      if (!heading) return;
      wait.disconnect();
      watch(heading);
    });
    if (found) watch(found);
    else wait.observe(main, { childList: true, subtree: true });
    return () => {
      wait.disconnect();
      seen?.disconnect();
      bar.classList.remove("titled");
      title.textContent = "";
      cover?.replaceChildren();
      cover?.toggleAttribute("hidden", true);
    };
  }, [scroller, key, barRef, titleRef, coverRef]);
}
