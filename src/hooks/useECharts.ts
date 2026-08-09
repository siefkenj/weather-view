// Thin, ref-based wrapper around ECharts: init once, update option on change,
// auto-resize with a ResizeObserver. Avoids the echarts-for-react peer dep.

import { useEffect, useRef } from "react";
import { echarts } from "../echartsSetup";
import type { EChartsOption } from "echarts";

type EChartsInstance = ReturnType<typeof echarts.init>;

export function useECharts(option: EChartsOption | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);

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
    };
  }, []);

  // Re-apply the option whenever it changes. Panning re-renders the window live (the
  // Dashboard overrides `viewStart` while dragging), so this re-runs setOption as the
  // sliced data changes — there's no transform/flushSync hand-off to coordinate.
  //
  // notMerge is required so removed series/bands don't linger when toggles change. It
  // does re-initialise every series on each call, and that IS the real per-frame cost of
  // a pan — series, markArea and markLine all rebuilt — but it does not replay any entry
  // ("draw-in") animation, because buildMeteogramOption sets `animation: false` globally
  // and has done since the first commit.
  //
  // An earlier version of this hook re-applied `animation: false` here for every render
  // after the first, to "animate the first paint only". Against an option that already
  // carried it that was a no-op, so it has been removed rather than left looking
  // load-bearing. If animation is ever switched back on in the option builder, this is
  // where a first-paint-only rule would belong.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (option) chart.setOption(option, { notMerge: true });
    else chart.clear();
  }, [option]);

  return { containerRef, chartRef };
}
