import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Keep the HTTP cache namespace clean between tests so a response written by one
// test can't be served to another (fetchJson serves same-hour cache hits). Only
// our `wv:cache:` keys are touched — theme (`wv-theme`) and the like survive.
beforeEach(() => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("wv:cache:")) localStorage.removeItem(key);
    }
  } catch {
    // no localStorage in this environment — nothing to clear
  }
});
