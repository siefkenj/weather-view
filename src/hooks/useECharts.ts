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

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (option) {
      // notMerge so removed series/bands don't linger when toggles change.
      chart.setOption(option, { notMerge: true });
    } else {
      chart.clear();
    }
  }, [option]);

  return { containerRef, chartRef };
}
