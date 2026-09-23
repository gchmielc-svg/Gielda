import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';
import { Candle, Signal } from '../lib/ta';
import { Sparkles, RefreshCw, Clock } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Props {
  data: Candle[];
  signals: Signal[];
}

export function DailyForecast({ data, signals }: Props) {
  const [forecast, setForecast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const saved = localStorage.getItem(`forecast_${today}`);
    if (saved) {
      setForecast(saved);
      setLastGenerated(today);
    }
  }, []);

  const generateForecast = async () => {
    setLoading(true);
    try {
      const recentData = data.slice(-10).map(d => ({
        date: d.date,
        close: d.close,
        high: d.high,
        low: d.low,
        volume: d.volume
      }));
      const latestSignal = signals.length > 0 ? signals[signals.length - 1] : null;

      const prompt = `Jesteś profesjonalnym analitykiem rynków kryptowalut i ekspertem od formacji 1-2-3 (Trading Joe Ross). 
      Otrzymujesz najnowsze dane rynkowe BTC/USD (ostatnie 10 świec) oraz zidentyfikowany ostatni sygnał formacji 1-2-3.
      
      Twoim zadaniem jest przygotowanie codziennej rekomendacji, która zawiera:
      1. **Uzasadnienie**: Analiza obecnej sytuacji na podstawie dostarczonych danych i formacji.
      2. **Rozpisane szanse**: Prawdopodobieństwo sukcesu dla byków (wzrosty) i niedźwiedzi (spadki) wyrażone w procentach wraz z krótkim powodem.
      3. **Prognozy na przyszłość w 3 wariantach** (zgodnie z zasadami tradingu):
         - Wariant Optymistyczny (Byczy)
         - Wariant Pesymistyczny (Niedźwiedzi)
         - Wariant Neutralny (Konsolidacja)
      
      Dane rynkowe: ${JSON.stringify(recentData, null, 2)}
      Ostatni sygnał: ${JSON.stringify(latestSignal, null, 2)}

      Zwróć wynik w czytelnym formacie Markdown. Używaj nagłówków, list i pogrubień.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });

      const text = response.text;
      if (text) {
        setForecast(text);
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem(`forecast_${today}`, text);
        setLastGenerated(today);
      }
    } catch (e) {
      console.error(e);
      alert("Wystąpił błąd podczas generowania prognozy.");
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const isUpToDate = lastGenerated === today;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="text-yellow-500 w-6 h-6" />
            Codzienna Rekomendacja AI
          </h2>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Nowa analiza dostępna codziennie po 00:01
          </p>
        </div>
        <button
          onClick={generateForecast}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analizowanie rynku...' : (isUpToDate ? 'Odśwież dzisiejszą prognozę' : 'Generuj prognozę na dziś')}
        </button>
      </div>
      
      {forecast ? (
        <div className="markdown-body text-slate-300">
          <Markdown>{forecast}</Markdown>
        </div>
      ) : (
        <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800/50">
          <Sparkles className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">Brak dzisiejszej prognozy</h3>
          <p className="text-slate-500 max-w-md mx-auto">
            Kliknij przycisk powyżej, aby wygenerować spersonalizowany raport AI na podstawie najnowszych danych rynkowych i formacji 1-2-3.
          </p>
        </div>
      )}
    </div>
  );
}
