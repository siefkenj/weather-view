// Thin, ref-based wrapper around ECharts: init once, update option on change,
// auto-resize with a ResizeObserver. Avoids the echarts-for-react peer dep.

import { useEffect, useRef } from "react";
import { echarts } from "../echartsSetup";
import type { EChartsOption } from "echarts";

type EChartsInstance = ReturnType<typeof echarts.init>;

export function useECharts(option: EChartsOption | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  // Whether we've already drawn once, so only the FIRST render animates (see below).
  const renderedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
      renderedRef.current = false;
    };
  }, []);

  // Re-apply the option whenever it changes. Panning re-renders the window live (the
  // Dashboard overrides `viewStart` while dragging), so this re-runs setOption as the
  // sliced data changes — there's no transform/flushSync hand-off to coordinate.
  //
  // notMerge is required so removed series/bands don't linger when toggles change, but
  // it re-initialises the series on EVERY call — which replays their entry ("draw-in")
  // animation. During a sideways pan that fires each frame, so the dashed feels-like
  // line perpetually re-reveals from the left and its dashes appear to crawl/shift as
  // the window scrolls. Animate the first paint only; apply later updates instantly so
  // panning is visually stable.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (option) {
      const opt = renderedRef.current ? { ...option, animation: false } : option;
      chart.setOption(opt, { notMerge: true });
      renderedRef.current = true;
    } else {
      chart.clear();
      renderedRef.current = false;
    }
  }, [option]);

  return { containerRef, chartRef };
}
