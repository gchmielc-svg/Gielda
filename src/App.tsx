import React, { useEffect, useState, useCallback } from 'react';
import { Activity, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { Candle, Signal, detect123Formation } from './lib/ta';
import { CandlestickChart } from './components/CandlestickChart';
import { DailyForecast } from './components/DailyForecast';

type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

export default function App() {
  const [data, setData] = useState<Candle[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');

  // Trading Config State
  const [accountPLN, setAccountPLN] = useState<number>(10000);
  const [lotSize, setLotSize] = useState<number>(0.07);
  const [spreadUSD, setSpreadUSD] = useState<number>(40);
  const [usdPlnRate, setUsdPlnRate] = useState<number>(4.0);

  const [selectedSignal, setSelectedSignal] = useState<{signal: Signal, point: 1 | 2 | 3 | 4 | 5 | 6 | 'entry'} | null>(null);
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);

  const fetchData = useCallback(async (isRefresh = false, tf: Timeframe = timeframe) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=500`);
      if (!res.ok) throw new Error('Failed to fetch data from Binance');
      const json = await res.json();
      
      const parsed: Candle[] = json.map((d: any) => ({
        time: d[0],
        date: new Date(d[0]).toISOString(), // Use full ISO string for smaller timeframes
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));

      const detectedSignals = detect123Formation(parsed, {
        accountPLN,
        lotSize,
        spreadUSD,
        usdPlnRate
      });
      
      setData(parsed);
      setSignals(detectedSignals);
      setLastUpdated(new Date());
      setError(null);

      if (!isRefresh || detectedSignals.length === 0) {
        setActiveSignal(detectedSignals.length > 0 ? detectedSignals[detectedSignals.length - 1] : null);
      } else {
        setActiveSignal(prev => {
          if (!prev) return detectedSignals[detectedSignals.length - 1] || null;
          const stillExists = detectedSignals.find(s => s.date === prev.date && s.type === prev.type);
          return stillExists || detectedSignals[detectedSignals.length - 1] || null;
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeframe, accountPLN, lotSize, spreadUSD, usdPlnRate]);

  useEffect(() => {
    setLoading(true);
    fetchData(false, timeframe);
    
    // Auto-refresh every 1 minute for live updates
    const interval = setInterval(() => {
      fetchData(true, timeframe);
    }, 60 * 1000);
    
    return () => clearInterval(interval);
  }, [fetchData, timeframe]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center flex-col gap-4">
        <Activity className="w-8 h-8 text-blue-500 animate-pulse" />
        <p className="text-slate-400 font-mono">Fetching Binance Data & Analyzing 1-2-3 Formations...</p>
      </div>
    );
  }

  if (error && data.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="bg-red-950/50 border border-red-900 p-6 rounded-xl text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Data</h2>
          <p className="text-red-300/80 mb-4">{error}</p>
          <button 
            onClick={() => fetchData(true)}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-200 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const isLatestCandle = activeSignal && data.length > 0 && activeSignal.date === data[data.length - 1].date;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="text-blue-500" />
              BTC/USD 1-2-3 Scanner
            </h1>
            <p className="text-slate-400 mt-1">Quantitative trading signals ({timeframe} timeframe)</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
              {(['15m', '1h', '4h', '1d', '1w', '1M'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 text-sm font-mono rounded-md transition-colors ${
                    timeframe === tf 
                      ? 'bg-blue-600 text-white' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-500">Last updated</p>
              <p className="text-sm font-mono text-slate-400">
                {lastUpdated?.toLocaleTimeString()}
              </p>
            </div>
            <button 
              onClick={() => fetchData(true, timeframe)}
              disabled={refreshing}
              className="bg-slate-900 hover:bg-slate-800 border border-slate-800 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-blue-400 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="font-mono text-sm text-slate-300">
                {refreshing ? 'Updating...' : 'Refresh'}
              </span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Signal Details */}
          <div className="lg:col-span-1 space-y-6">
            {activeSignal ? (
              <div className={`rounded-2xl border p-6 ${activeSignal.type === 'LONG' ? 'bg-green-950/20 border-green-900/50' : 'bg-red-950/20 border-red-900/50'}`}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    {activeSignal.type === 'LONG' ? <TrendingUp className="text-green-500" /> : <TrendingDown className="text-red-500" />}
                    <h2 className={`text-xl font-bold ${activeSignal.type === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                      {activeSignal.type} SIGNAL
                    </h2>
                    {activeSignal.result === 'WIN' && <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 border border-green-500/50 rounded text-xs font-bold">WIN ✅</span>}
                    {activeSignal.result === 'LOSS' && <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/50 rounded text-xs font-bold">LOSS ❌</span>}
                    {activeSignal.result === 'PENDING' && <span className="ml-2 px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/50 rounded text-xs font-bold">W TOKU ⏳</span>}
                  </div>
                  <span className="text-xs font-mono bg-slate-900 px-2 py-1 rounded text-slate-400 border border-slate-800">
                    {new Date(activeSignal.date).toLocaleString()}
                  </span>
                </div>

                {!isLatestCandle && activeSignal === signals[signals.length - 1] && (
                  <div className="mb-6 bg-amber-950/30 border border-amber-900/50 text-amber-400/90 text-sm p-3 rounded-lg flex items-start gap-2">
                    <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>No signal triggered on the current candle. Showing the most recent historical signal.</p>
                  </div>
                )}
                
                {activeSignal !== signals[signals.length - 1] && (
                  <div className="mb-6 bg-blue-950/30 border border-blue-900/50 text-blue-400/90 text-sm p-3 rounded-lg flex items-start gap-2">
                    <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>Showing historical signal details. Click 'Refresh' to return to the latest signal.</p>
                  </div>
                )}

                <div className="space-y-4 font-mono text-sm">
                  <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Entry Price</span>
                    <span className="text-white font-bold">${activeSignal.entry.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Stop Loss</span>
                    <span className="text-red-400">${activeSignal.sl.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Take Profit 1 (1.5R)</span>
                    <span className="text-green-400">${activeSignal.tp1.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Take Profit 2 (2.5R)</span>
                    <span className="text-green-500">${activeSignal.tp2.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-slate-400">Risk/Reward</span>
                    <span className="text-blue-400">{activeSignal.rr.toFixed(2)}</span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800/50">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Zarządzanie Kapitałem (XTB)</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    <div className="bg-slate-800/50 p-2 rounded">
                      <label className="text-slate-500 text-xs block mb-1">Kapitał (PLN)</label>
                      <input 
                        type="number" 
                        value={accountPLN} 
                        onChange={e => setAccountPLN(Number(e.target.value))}
                        className="w-full bg-slate-900 text-slate-300 font-mono text-sm border border-slate-700 rounded px-2 py-1"
                      />
                    </div>
                    <div className="bg-slate-800/50 p-2 rounded">
                      <label className="text-slate-500 text-xs block mb-1">Wielkość pozycji (Lot)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={lotSize} 
                        onChange={e => setLotSize(Number(e.target.value))}
                        className="w-full bg-slate-900 text-slate-300 font-mono text-sm border border-slate-700 rounded px-2 py-1"
                      />
                    </div>
                    <div className="bg-slate-800/50 p-2 rounded">
                      <label className="text-slate-500 text-xs block mb-1">Spread XTB (USD)</label>
                      <input 
                        type="number" 
                        value={spreadUSD} 
                        onChange={e => setSpreadUSD(Number(e.target.value))}
                        className="w-full bg-slate-900 text-slate-300 font-mono text-sm border border-slate-700 rounded px-2 py-1"
                      />
                    </div>
                    <div className="bg-slate-800/50 p-2 rounded">
                      <label className="text-slate-500 text-xs block mb-1">Kurs USD/PLN</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={usdPlnRate} 
                        onChange={e => setUsdPlnRate(Number(e.target.value))}
                        className="w-full bg-slate-900 text-slate-300 font-mono text-sm border border-slate-700 rounded px-2 py-1"
                      />
                    </div>
                  </div>

                  <div className={`p-3 rounded border ${activeSignal.isTradeable ? 'bg-blue-900/20 border-blue-800/50' : 'bg-red-900/20 border-red-800/50'}`}>
                    <div className="flex justify-between items-end mb-2">
                      <div className="text-slate-500 text-xs">Faktyczne Ryzyko (PLN)</div>
                      <div className={`font-mono text-xl font-bold ${activeSignal.isTradeable ? 'text-blue-400' : 'text-red-400'}`}>
                        {activeSignal.actualRiskPLN.toFixed(2)} PLN
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 text-right mb-2">
                      ({((activeSignal.actualRiskPLN / accountPLN) * 100).toFixed(2)}% kapitału)
                    </div>
                    
                    {!activeSignal.isTradeable && (
                      <div className="mt-2 text-xs text-red-400/90 flex items-start gap-1.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>Ryzyko przekracza 5% kapitału! Zignoruj ten sygnał lub zmniejsz wielkość pozycji.</p>
                      </div>
                    )}
                    {activeSignal.isTradeable && (
                      <div className="mt-2 text-xs text-blue-400/80">
                        Uwzględniono bufor ${spreadUSD} na spread (XTB). Swap = 0 (zakładając zamknięcie przed północą).
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800/50">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Za i Przeciw (Rekomendacja)</h3>
                  
                  <div className="space-y-4">
                    {activeSignal.pros.length > 0 && (
                      <div className="bg-green-950/20 border border-green-900/30 rounded-lg p-3">
                        <h4 className="text-green-400 text-xs font-bold mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> ZA (Argumenty na plus)
                        </h4>
                        <ul className="space-y-1">
                          {activeSignal.pros.map((pro, idx) => (
                            <li key={idx} className="text-xs text-green-300/80 flex items-start gap-1.5">
                              <span className="text-green-500 mt-0.5">•</span> {pro}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activeSignal.cons.length > 0 && (
                      <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3">
                        <h4 className="text-red-400 text-xs font-bold mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> PRZECIW (Ryzyka)
                        </h4>
                        <ul className="space-y-1">
                          {activeSignal.cons.map((con, idx) => (
                            <li key={idx} className="text-xs text-red-300/80 flex items-start gap-1.5">
                              <span className="text-red-500 mt-0.5">•</span> {con}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-400">Werdykt Systemu:</span>
                      {activeSignal.cons.length === 0 ? (
                        <span className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/50 rounded-lg text-sm font-bold">
                          SILNY SYGNAŁ (Zalecane wejście)
                        </span>
                      ) : activeSignal.isTradeable && activeSignal.cons.length <= 2 ? (
                        <span className="px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/50 rounded-lg text-sm font-bold">
                          SYGNAŁ OSTRZEGAWCZY (Zalecana ostrożność)
                        </span>
                      ) : (
                        <span className="px-3 py-1 bg-red-500/20 text-red-400 border border-red-500/50 rounded-lg text-sm font-bold">
                          ODRZUCONY (Zbyt duże ryzyko)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl text-center">
                <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h2 className="text-lg font-bold text-slate-300 mb-2">No Signals Found</h2>
                <p className="text-slate-500 text-sm">No valid 1-2-3 formations detected in the recent historical data.</p>
              </div>
            )}
          </div>

          {/* Right Column: Chart */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-slate-200">Price Action & Pattern Visualization</h2>
            <CandlestickChart 
              data={data} 
              signals={signals} 
              activeSignal={activeSignal}
              onPointClick={(signal, point) => {
                setSelectedSignal({signal, point});
                setActiveSignal(signal);
              }} 
            />
            
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl mt-4 text-sm text-slate-400">
              <p><strong>How it works:</strong> The 1-2-3 pattern identifies trend reversals or continuations. Point 1 is a major swing, Point 2 is the local retracement, and Point 3 is the higher-low (bullish) or lower-high (bearish). Entry triggers when price breaks Point 2. <strong>Click on any '1', '2', '3', or Entry arrow marker on the chart to see details.</strong></p>
            </div>
          </div>

        </div>

        <DailyForecast data={data} signals={signals} />
      </div>

      {/* Point Explanation Modal */}
      {selectedSignal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <AlertCircle className="text-blue-500 w-6 h-6" />
                {selectedSignal.point === 'entry' ? 'Analiza Wejścia (Entry)' : `Analiza Punktu ${selectedSignal.point}`}
              </h3>
              <button 
                onClick={() => setSelectedSignal(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4 text-slate-300 text-sm">
              <p>
                <strong>Kierunek:</strong> <span className={selectedSignal.signal.type === 'LONG' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{selectedSignal.signal.type}</span>
              </p>

              {/* Point 1 and 4 */}
              {(selectedSignal.point === 1 || selectedSignal.point === 4) && (
                <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                  <h4 className="font-bold text-white mb-2">Dlaczego to jest Punkt {selectedSignal.point}?</h4>
                  <p className="text-slate-400">
                    {selectedSignal.signal.type === 'LONG' 
                      ? 'Punkt 1 to najniższy dołek (Extreme Low) w analizowanym ruchu spadkowym. Oznacza on potencjalne wyczerpanie siły sprzedających i początek odwrócenia trendu na wzrostowy.' 
                      : 'Punkt 4 to najwyższy szczyt (Extreme High) w analizowanym ruchu wzrostowym. Oznacza on potencjalne wyczerpanie siły kupujących i początek odwrócenia trendu na spadkowy.'}
                  </p>
                </div>
              )}

              {/* Point 2 and 5 */}
              {(selectedSignal.point === 2 || selectedSignal.point === 5) && (
                <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                  <h4 className="font-bold text-white mb-2">Dlaczego to jest Punkt {selectedSignal.point}?</h4>
                  <p className="text-slate-400">
                    {selectedSignal.signal.type === 'LONG' 
                      ? 'Punkt 2 to lokalny szczyt powstały po pierwszym odbiciu od Punktu 1. Wyznacza on kluczową linię oporu. Przebicie tego poziomu w górę przez cenę potwierdza formację i generuje sygnał wejścia (ENTRY).' 
                      : 'Punkt 5 to lokalny dołek powstały po pierwszym cofnięciu od Punktu 4. Wyznacza on kluczową linię wsparcia. Przebicie tego poziomu w dół przez cenę potwierdza formację i generuje sygnał wejścia (ENTRY).'}
                  </p>
                </div>
              )}

              {/* Entry */}
              {selectedSignal.point === 'entry' && (
                <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                  <h4 className="font-bold text-white mb-2">Dlaczego wejście jest właśnie tutaj?</h4>
                  <p className="text-slate-400">
                    {selectedSignal.signal.type === 'LONG' 
                      ? 'Sygnał wejścia (LONG) zostaje wygenerowany w momencie, gdy cena przebija poziom wyznaczony przez Punkt 2 (lokalny opór). Przebicie tego poziomu potwierdza, że kupujący przejęli kontrolę i struktura 1-2-3 została w pełni aktywowana.' 
                      : 'Sygnał wejścia (SHORT) zostaje wygenerowany w momencie, gdy cena przebija poziom wyznaczony przez Punkt 5 (lokalne wsparcie). Przebicie tego poziomu potwierdza, że sprzedający przejęli kontrolę i struktura 4-5-6 została w pełni aktywowana.'}
                  </p>
                </div>
              )}

              {/* Point 3 and 6 */}
              {(selectedSignal.point === 3 || selectedSignal.point === 6) && (
                <>
                  <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                    <h4 className="font-bold text-white mb-2">Stop Loss (SL): <span className="text-red-400">${selectedSignal.signal.sl.toFixed(2)}</span></h4>
                    <p className="text-slate-400">
                      {selectedSignal.signal.type === 'LONG' 
                        ? 'Umieszczony tuż poniżej punktu 3. Punkt 3 to "Wyższy Dołek" (Higher Low). Jeśli cena spadnie poniżej tego poziomu, struktura wzrostowa 1-2-3 zostaje zanegowana.' 
                        : 'Umieszczony tuż powyżej punktu 6. Punkt 6 to "Niższy Szczyt" (Lower High). Jeśli cena wzrośnie powyżej tego poziomu, struktura spadkowa 4-5-6 zostaje zanegowana.'}
                    </p>
                  </div>

                  <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                    <h4 className="font-bold text-white mb-2">Take Profit (TP):</h4>
                    <ul className="list-disc pl-5 space-y-2 text-slate-400">
                      <li>
                        <strong className="text-green-400">TP1 (${selectedSignal.signal.tp1.toFixed(2)}):</strong> Ustawiony na 1.5x ryzyka (Risk/Reward 1:1.5). Tutaj zaleca się realizację części zysków.
                      </li>
                      <li>
                        <strong className="text-green-500">TP2 (${selectedSignal.signal.tp2.toFixed(2)}):</strong> Ustawiony na 2.5x ryzyka (Risk/Reward 1:2.5). Docelowy poziom dla reszty pozycji.
                      </li>
                    </ul>
                  </div>
                </>
              )}
            </div>
            
            <button 
              onClick={() => setSelectedSignal(null)}
              className="mt-6 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors"
            >
              Zrozumiałem
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

