import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, SeriesMarker, Time, ColorType, PriceScaleMode } from 'lightweight-charts';
import { Candle, Signal } from '../lib/ta';

interface Props {
  data: Candle[];
  signals: Signal[];
  activeSignal: Signal | null;
  onPointClick?: (signal: Signal, point: 1 | 2 | 3 | 4 | 5 | 6 | 'entry') => void;
}

export function CandlestickChart({ data, signals, activeSignal, onPointClick }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [legendData, setLegendData] = useState<any>(null);
  const chartInstanceRef = useRef<any>(null);
  const barSeriesRef = useRef<any>(null);
  const emaSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const activePatternLineRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const isDataLoadedRef = useRef(false);

  // 1. Initialize Chart (Runs once on mount)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        minBarSpacing: 3,
      },
      rightPriceScale: {
        mode: PriceScaleMode.Logarithmic,
        autoScale: true,
        alignLabels: true,
        scaleMargins: {
          top: 0.05,
          bottom: 0.25, // Leave bottom 25% for volume
        },
      },
    };

    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      height: 550,
    });
    chartInstanceRef.current = chart;

    const barSeries = chart.addBarSeries({
      upColor: '#ffffff',
      downColor: '#ffffff',
      openVisible: false,
      thinBars: false,
    });
    barSeriesRef.current = barSeries;

    // Add EMA 50 Line
    const emaSeries = chart.addLineSeries({
      color: '#f59e0b', // Amber color for EMA
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    emaSeriesRef.current = emaSeries;

    // Add Volume Histogram
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // set as an overlay
    });
    volumeSeriesRef.current = volumeSeries;

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // highest point of the series will be at 80% of the chart height
        bottom: 0,
      },
    });

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartInstanceRef.current = null;
      barSeriesRef.current = null;
      emaSeriesRef.current = null;
      volumeSeriesRef.current = null;
      activePatternLineRef.current = null;
      priceLinesRef.current = [];
      isDataLoadedRef.current = false;
    };
  }, []);

  // 2. Update Data and Markers
  useEffect(() => {
    if (!chartInstanceRef.current || !barSeriesRef.current || !volumeSeriesRef.current || !emaSeriesRef.current || data.length === 0) return;

    // Format Data
    const formattedCandles = data.map(d => ({ time: (d.time / 1000) as Time, open: d.open, high: d.high, low: d.low, close: d.close }));
    const formattedVolume = data.map(d => ({ 
      time: (d.time / 1000) as Time, 
      value: d.volume, 
      color: d.close > d.open ? 'rgba(38, 166, 154, 0.15)' : 'rgba(239, 83, 80, 0.15)' 
    }));
    const formattedEma = data.filter(d => d.ema50 !== undefined).map(d => ({ time: (d.time / 1000) as Time, value: d.ema50! }));

    barSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);
    emaSeriesRef.current.setData(formattedEma);

    // Add Markers for all signals
    let markers: SeriesMarker<Time>[] = [];
    
    signals.forEach(sig => {
      const isLong = sig.type === 'LONG';
      
      markers.push({
        time: (data[sig.p1_idx].time / 1000) as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: '#eab308',
        shape: 'circle',
        text: isLong ? '1' : '4',
        size: 0.8,
      });
      
      markers.push({
        time: (data[sig.p2_idx].time / 1000) as Time,
        position: isLong ? 'aboveBar' : 'belowBar',
        color: '#eab308',
        shape: 'circle',
        text: isLong ? '2' : '5',
        size: 0.8,
      });

      markers.push({
        time: (data[sig.p3_idx].time / 1000) as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: '#eab308',
        shape: 'circle',
        text: isLong ? '3' : '6',
        size: 0.8,
      });

      let resultText = '';
      if (sig.result === 'WIN') resultText = ' ✅';
      if (sig.result === 'LOSS') resultText = ' ❌';

      markers.push({
        time: (data[sig.trigger_idx].time / 1000) as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#22c55e' : '#ef4444',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: resultText,
        size: 0.8,
      });
    });

    // Filter duplicates (if multiple signals share the same pivot point)
    markers = markers.filter((m, index, self) => 
      index === self.findIndex((t) => (
        t.time === m.time && t.text === m.text
      ))
    );

    // Sort markers by time
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    barSeriesRef.current.setMarkers(markers);

    if (!isDataLoadedRef.current) {
      chartInstanceRef.current.timeScale().fitContent();
      isDataLoadedRef.current = true;
    }
  }, [data, signals]);

  // 3. Handle Crosshair and Click Events
  useEffect(() => {
    if (!chartInstanceRef.current || !barSeriesRef.current) return;

    // Crosshair move handler for legend
    const handleCrosshairMove = (param: any) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        setLegendData(null);
      } else {
        const candle = param.seriesData.get(barSeriesRef.current) as any;
        
        if (candle) {
          const date = new Date((param.time as number) * 1000);
          setLegendData({
            time: date.toLocaleString(),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          });
        }
      }
    };

    // Click handler for Points 1, 2, 3, 4, 5, 6, and Entry
    const handleClick = (param: any) => {
      if (!param.point || !param.time || !onPointClick) return;
      
      const clickedTime = param.time as number;
      
      // Check entry first, then 3/6, then 2/5, then 1/4
      const signalEntry = signals.find(s => Math.abs(Math.floor(data[s.trigger_idx].time / 1000) - clickedTime) <= 0);
      if (signalEntry) return onPointClick(signalEntry, 'entry');

      const signal3 = signals.find(s => Math.abs(Math.floor(data[s.p3_idx].time / 1000) - clickedTime) <= 0);
      if (signal3) return onPointClick(signal3, signal3.type === 'LONG' ? 3 : 6);

      const signal2 = signals.find(s => Math.abs(Math.floor(data[s.p2_idx].time / 1000) - clickedTime) <= 0);
      if (signal2) return onPointClick(signal2, signal2.type === 'LONG' ? 2 : 5);

      const signal1 = signals.find(s => Math.abs(Math.floor(data[s.p1_idx].time / 1000) - clickedTime) <= 0);
      if (signal1) return onPointClick(signal1, signal1.type === 'LONG' ? 1 : 4);
    };

    chartInstanceRef.current.subscribeCrosshairMove(handleCrosshairMove);
    chartInstanceRef.current.subscribeClick(handleClick);

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.unsubscribeCrosshairMove(handleCrosshairMove);
        chartInstanceRef.current.unsubscribeClick(handleClick);
      }
    };
  }, [data, signals, onPointClick]);

  // 4. Handle activeSignal changes to update price lines and pattern line dynamically
  useEffect(() => {
    if (!barSeriesRef.current || !chartInstanceRef.current) return;

    // Remove old price lines
    priceLinesRef.current.forEach(line => {
      try {
        barSeriesRef.current.removePriceLine(line);
      } catch (e) {
        // Ignore if line is already removed or invalid
      }
    });
    priceLinesRef.current = [];

    // Remove old pattern line
    if (activePatternLineRef.current) {
      try {
        chartInstanceRef.current.removeSeries(activePatternLineRef.current);
      } catch (e) {
        // Ignore
      }
      activePatternLineRef.current = null;
    }

    // Add new price lines and pattern line
    if (activeSignal) {
      const entryLine = barSeriesRef.current.createPriceLine({ price: activeSignal.entry, color: '#3b82f6', lineWidth: 1, lineStyle: 2, title: 'Entry' });
      const slLine = barSeriesRef.current.createPriceLine({ price: activeSignal.sl, color: '#ef4444', lineWidth: 1, lineStyle: 2, title: 'SL' });
      const tp1Line = barSeriesRef.current.createPriceLine({ price: activeSignal.tp1, color: '#22c55e', lineWidth: 1, lineStyle: 2, title: 'TP1' });
      const tp2Line = barSeriesRef.current.createPriceLine({ price: activeSignal.tp2, color: '#16a34a', lineWidth: 1, lineStyle: 2, title: 'TP2' });
      
      priceLinesRef.current = [entryLine, slLine, tp1Line, tp2Line];

      // Draw pattern line for active signal
      const isLong = activeSignal.type === 'LONG';
      const color = isLong ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
      
      const patternLine = chartInstanceRef.current.addLineSeries({
        color: color,
        lineWidth: 2,
        lineStyle: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      patternLine.setData([
        { time: (data[activeSignal.p1_idx].time / 1000) as Time, value: activeSignal.p1 },
        { time: (data[activeSignal.p2_idx].time / 1000) as Time, value: activeSignal.p2 },
        { time: (data[activeSignal.p3_idx].time / 1000) as Time, value: activeSignal.p3 },
        { time: (data[activeSignal.trigger_idx].time / 1000) as Time, value: activeSignal.entry },
      ]);
      
      activePatternLineRef.current = patternLine;
    }
  }, [activeSignal, data]);

  return (
    <div className="w-full flex flex-col gap-1 bg-slate-900 rounded-xl border border-slate-800 p-1 overflow-hidden relative">
      {legendData && (
        <div className="absolute top-2 left-2 z-10 bg-slate-900/80 backdrop-blur-sm p-2 rounded border border-slate-800 text-xs font-mono text-slate-300 pointer-events-none flex flex-wrap gap-3">
          <div className="font-bold text-white">{legendData.time}</div>
          <div><span className="text-slate-500">O:</span> {legendData.open.toFixed(2)}</div>
          <div><span className="text-slate-500">H:</span> {legendData.high.toFixed(2)}</div>
          <div><span className="text-slate-500">L:</span> {legendData.low.toFixed(2)}</div>
          <div><span className="text-slate-500">C:</span> {legendData.close.toFixed(2)}</div>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
