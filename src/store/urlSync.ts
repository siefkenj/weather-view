// Bidirectional glue between the view slice and the URL query string. There's no
// off-the-shelf library that syncs *specific typed search params* to a slice
// (redux-first-history mirrors the whole router location, which is heavier than we
// need and fights react-router's own history), so this is hand-written.
//
// The hazard in two-way binding is a feedback race: a change on one side triggers
// the other side's effect, which — running before its own source has caught up —
// reads a stale value and clobbers the change back. We avoid it two ways:
//   1. Each effect depends on ONLY its own source (view, or searchParams), so a
//      change on one side never re-runs the other side's writer with stale data.
//   2. A shared `lastSynced` canonical-query ref records the value both sides last
//      agreed on; whichever effect fires compares against it and writes only a
//      genuine change, then updates the ref. This terminates the ping-pong.
// The view slice starts initialised from the URL (viewSlice.initialView), so the
// first render already agrees and neither effect writes on mount.

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "./index";
import { setView } from "./viewSlice";
import { parseState, viewToQuery } from "./urlState";

export function useUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useAppSelector((s) => s.view);
  const dispatch = useAppDispatch();

  // The canonical query string the store and URL last agreed on.
  const lastSynced = useRef(viewToQuery(view));

  // store → URL: reflect user actions into the address bar (replace, so panning
  // and toggling don't spam the history stack).
  useEffect(() => {
    const q = viewToQuery(view);
    if (q === lastSynced.current) return;
    lastSynced.current = q;
    setSearchParams(q, { replace: true });
    // Depends only on `view`: an external URL change must not re-run this writer
    // with a stale view (that was the clobber bug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // URL → store: pick up changes that didn't originate here (back/forward, a
  // pasted link, an in-app navigation that carries a query string).
  useEffect(() => {
    const parsed = parseState(searchParams);
    const q = viewToQuery(parsed);
    if (q === lastSynced.current) return;
    lastSynced.current = q;
    dispatch(setView(parsed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}
