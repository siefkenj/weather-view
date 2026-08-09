// Error boundary for the lazily-loaded panels (Meteogram, RadarView).
//
// The service worker is registered with `registerType: "autoUpdate"`, so a new build's
// SW calls skipWaiting()/clientsClaim() and takes over ALREADY-OPEN tabs, then drops the
// previous build's hashed assets from the precache. A tab left open across a deploy is
// still running the old entry chunk, so the next `import("./RadarView")` asks for a file
// that no longer exists on the server either — the dynamic import rejects, and with no
// boundary that rejection unmounts the whole app: a white screen, not a dead panel.
//
// So: contain the failure to the one panel, and offer the reload that actually fixes it
// (the reload picks up the new build's index.html and its current asset names). One
// automatic reload is attempted first, guarded by sessionStorage so a genuinely missing
// chunk can't put the tab in a refresh loop.

import { Component, type ReactNode } from "react";

const RELOAD_KEY = "wv:chunk-reload";

/** A failed dynamic import, as opposed to a bug inside the loaded component. Browsers
 *  disagree on the wording, so this matches the shapes rather than one message. */
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
    msg,
  );
}

interface Props {
  children: ReactNode;
  /** Rendered in place of the panel when it can't be loaded. */
  label: string;
}

interface State {
  failed: boolean;
}

export class ChunkBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (!isChunkLoadError(error)) return;
    // Reload once per tab: after a deploy this silently repairs the tab. If the reload
    // doesn't fix it, the flag is already set and we show the message instead.
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      location.reload();
    } catch {
      /* storage unavailable — fall through to the message */
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="state state--empty">
        {this.props.label} couldn’t be loaded.{" "}
        <button type="button" className="btn btn--sm" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
