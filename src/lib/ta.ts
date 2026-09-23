export interface Candle {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  pivotHigh?: boolean;
  pivotLow?: boolean;
  ema50?: number;
}

export interface Signal {
  date: string;
  type: 'LONG' | 'SHORT';
  p1: number;
  p2: number;
  p3: number;
  p1_idx: number;
  p2_idx: number;
  p3_idx: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  trigger_idx: number;
  result?: 'WIN' | 'LOSS' | 'PENDING';
  isTrendAligned?: boolean;
  isVolumeConfirmed?: boolean;
  positionSize: number;
  isTradeable: boolean;
  actualRiskPLN: number;
  pros: string[];
  cons: string[];
}

export function calculateEMA(data: Candle[], period: number) {
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i].close;
  }
  if (data.length >= period) {
    data[period - 1].ema50 = sum / period;
    for (let i = period; i < data.length; i++) {
      data[i].ema50 = (data[i].close - data[i - 1].ema50!) * k + data[i - 1].ema50!;
    }
  }
}

export function detectPivots(data: Candle[], window: number = 2) {
  for (let i = window; i < data.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (i !== j) {
        if (data[i].high <= data[j].high) isHigh = false;
        if (data[i].low >= data[j].low) isLow = false;
      }
    }
    data[i].pivotHigh = isHigh;
    data[i].pivotLow = isLow;
  }
}

export interface TradingConfig {
  accountPLN: number;
  lotSize: number;
  spreadUSD: number;
  usdPlnRate: number;
}

export function detect123Formation(data: Candle[], config: TradingConfig): Signal[] {
  detectPivots(data, 2);
  calculateEMA(data, 50);

  const signals: Signal[] = [];
  const { accountPLN, lotSize, spreadUSD, usdPlnRate } = config;

  for (let i = 10; i < data.length; i++) {
    const recentLows: number[] = [];
    const recentHighs: number[] = [];
    for (let j = 0; j < i; j++) {
      if (data[j].pivotLow) recentLows.push(j);
      if (data[j].pivotHigh) recentHighs.push(j);
    }

    // Calculate average volume of last 10 candles
    let volSum = 0;
    let volCount = 0;
    for (let v = 1; v <= 10 && i - v >= 0; v++) {
      volSum += data[i - v].volume;
      volCount++;
    }
    const avgVol10 = volCount > 0 ? volSum / volCount : 0;

    // BULLISH (LONG)
    if (recentLows.length >= 2 && recentHighs.length >= 1) {
      const p3_idx = recentLows[recentLows.length - 1];
      const p1_idx = recentLows[recentLows.length - 2];

      const p2_candidates = recentHighs.filter(idx => idx > p1_idx && idx < p3_idx);
      if (p2_candidates.length > 0) {
        const p2_idx = p2_candidates.reduce((maxIdx, idx) => data[idx].high > data[maxIdx].high ? idx : maxIdx, p2_candidates[0]);
        
        const p1_val = data[p1_idx].low;
        const p2_val = data[p2_idx].high;
        const p3_val = data[p3_idx].low;

        if (p3_val > p1_val) {
          // Entry triggers when the HIGH breaks Point 2
          if (data[i - 1].high <= p2_val && data[i].high > p2_val) {
            let minLow = Infinity;
            for (let k = p3_idx; k <= i; k++) minLow = Math.min(minLow, data[k].low);
            
            if (minLow > p1_val) {
              if ((i - p3_idx) <= 15) {
                const entry = p2_val + spreadUSD; // Uwzględnienie spreadu (kupno po Ask)
                const sl = p3_val - spreadUSD; // Bufor na spread pod dołkiem
                const risk = entry - sl;

                if (risk > 0 && (risk / entry) <= 0.15) {
                  const tp1 = entry + risk * 1.5;
                  const tp2 = entry + risk * 2.5;
                  
                  // Obliczanie faktycznego ryzyka w PLN dla ustalonego lota
                  const actualRiskPLN = lotSize * risk * usdPlnRate;
                  
                  // Jeśli ryzyko przekracza 5% kapitału, oznaczamy jako niebezpieczne
                  const isTradeable = actualRiskPLN <= (accountPLN * 0.05); // Max 5% risk tolerance
                  
                  const pros: string[] = [];
                  const cons: string[] = [];
                  
                  const isTrendAligned = data[i].ema50 ? data[i].close > data[i].ema50! : undefined;
                  const isVolumeConfirmed = data[i].volume > avgVol10;
                  
                  if (isTrendAligned) {
                    pros.push("Zgodność z trendem (cena powyżej EMA 50)");
                  } else {
                    cons.push("Brak zgodności z trendem (cena poniżej EMA 50)");
                  }
                  
                  if (isVolumeConfirmed) {
                    pros.push("Potwierdzenie wolumenem (powyżej średniej)");
                  } else {
                    cons.push("Brak potwierdzenia wolumenem");
                  }
                  
                  if (!isTradeable) {
                    cons.push(`Zbyt wysokie ryzyko: ${actualRiskPLN.toFixed(2)} PLN (>5% kapitału)`);
                  } else if (actualRiskPLN > accountPLN * 0.02) {
                    cons.push(`Podwyższone ryzyko: ${actualRiskPLN.toFixed(2)} PLN (>2% kapitału)`);
                  } else {
                    pros.push(`Akceptowalne ryzyko: ${actualRiskPLN.toFixed(2)} PLN`);
                  }
                  
                  // Dodajemy informacje o czasie (intraday)
                  const signalDate = new Date(data[i].date);
                  const hour = signalDate.getHours();
                  if (hour >= 0 && hour < 12) {
                    pros.push("Sygnał wcześnie w ciągu dnia (więcej czasu na realizację bez swapa)");
                  } else if (hour >= 18) {
                    cons.push("Sygnał późno w ciągu dnia (ryzyko przetrzymania przez noc i opłaty swap)");
                  }

                  // Backtesting (Intraday - zamykamy przed końcem dnia)
                  let result: 'WIN' | 'LOSS' | 'PENDING' = 'PENDING';
                  const entryDateStr = new Date(data[i].date).toDateString();
                  
                  // Sprawdzamy najpierw świecę wejściową (i)
                  if (data[i].low <= sl) {
                    result = 'LOSS';
                  } else if (data[i].high >= tp1) {
                    result = 'WIN';
                  } else {
                    // Jeśli na świecy wejściowej nie było TP ani SL, sprawdzamy kolejne świece z tego samego dnia
                    for (let j = i + 1; j < data.length; j++) {
                      const currentDateStr = new Date(data[j].date).toDateString();
                      if (currentDateStr !== entryDateStr) {
                        // Koniec dnia - zamykamy pozycję. Sprawdzamy czy zysk czy strata.
                        const closePrice = data[j - 1].close;
                        result = closePrice > entry ? 'WIN' : 'LOSS';
                        break;
                      }
                      if (data[j].low <= sl) { result = 'LOSS'; break; }
                      if (data[j].high >= tp1) { result = 'WIN'; break; }
                    }
                    
                    // Jeśli to ostatnia świeca i nadal jesteśmy w tym samym dniu
                    if (result === 'PENDING' && i === data.length - 1) {
                      result = 'PENDING';
                    }
                  }

                  signals.push({
                    date: data[i].date,
                    type: 'LONG',
                    p1: p1_val, p2: p2_val, p3: p3_val,
                    p1_idx, p2_idx, p3_idx,
                    entry, sl,
                    tp1, tp2,
                    rr: 1.5,
                    trigger_idx: i,
                    result,
                    isTrendAligned,
                    isVolumeConfirmed,
                    positionSize: lotSize,
                    isTradeable,
                    actualRiskPLN,
                    pros,
                    cons
                  });
                }
              }
            }
          }
        }
      }
    }

    // BEARISH (SHORT)
    if (recentHighs.length >= 2 && recentLows.length >= 1) {
      const p3_idx = recentHighs[recentHighs.length - 1];
      const p1_idx = recentHighs[recentHighs.length - 2];

      const p2_candidates = recentLows.filter(idx => idx > p1_idx && idx < p3_idx);
      if (p2_candidates.length > 0) {
        const p2_idx = p2_candidates.reduce((minIdx, idx) => data[idx].low < data[minIdx].low ? idx : minIdx, p2_candidates[0]);
        
        const p1_val = data[p1_idx].high;
        const p2_val = data[p2_idx].low;
        const p3_val = data[p3_idx].high;

        if (p3_val < p1_val) {
          // Entry triggers when the LOW breaks Point 2
          if (data[i - 1].low >= p2_val && data[i].low < p2_val) {
            let maxHigh = -Infinity;
            for (let k = p3_idx; k <= i; k++) maxHigh = Math.max(maxHigh, data[k].high);
            
            if (maxHigh < p1_val) {
              if ((i - p3_idx) <= 15) {
                const entry = p2_val - spreadUSD; // Uwzględnienie spreadu (sprzedaż po Bid)
                const sl = p3_val + spreadUSD; // Bufor na spread nad szczytem
                const risk = sl - entry;

                if (risk > 0 && (risk / entry) <= 0.15) {
                  const tp1 = entry - risk * 1.5;
                  const tp2 = entry - risk * 2.5;

                  // Obliczanie faktycznego ryzyka w PLN dla ustalonego lota
                  const actualRiskPLN = lotSize * risk * usdPlnRate;
                  
                  // Jeśli ryzyko przekracza 5% kapitału, oznaczamy jako niebezpieczne
                  const isTradeable = actualRiskPLN <= (accountPLN * 0.05); // Max 5% risk tolerance
                  
                  const pros: string[] = [];
                  const cons: string[] = [];
                  
                  const isTrendAligned = data[i].ema50 ? data[i].close < data[i].ema50! : undefined;
                  const isVolumeConfirmed = data[i].volume > avgVol10;
                  
                  if (isTrendAligned) {
                    pros.push("Zgodność z trendem (cena poniżej EMA 50)");
                  } else {
                    cons.push("Brak zgodności z trendem (cena powyżej EMA 50)");
                  }
                  
                  if (isVolumeConfirmed) {
                    pros.push("Potwierdzenie wolumenem (powyżej średniej)");
                  } else {
                    cons.push("Brak potwierdzenia wolumenem");
                  }
                  
                  if (!isTradeable) {
                    cons.push(`Zbyt wysokie ryzyko: ${actualRiskPLN.toFixed(2)} PLN (>5% kapitału)`);
                  } else if (actualRiskPLN > accountPLN * 0.02) {
                    cons.push(`Podwyższone ryzyko: ${actualRiskPLN.toFixed(2)} PLN (>2% kapitału)`);
                  } else {
                    pros.push(`Akceptowalne ryzyko: ${actualRiskPLN.toFixed(2)} PLN`);
                  }
                  
                  // Dodajemy informacje o czasie (intraday)
                  const signalDate = new Date(data[i].date);
                  const hour = signalDate.getHours();
                  if (hour >= 0 && hour < 12) {
                    pros.push("Sygnał wcześnie w ciągu dnia (więcej czasu na realizację bez swapa)");
                  } else if (hour >= 18) {
                    cons.push("Sygnał późno w ciągu dnia (ryzyko przetrzymania przez noc i opłaty swap)");
                  }

                  // Backtesting (Intraday - zamykamy przed końcem dnia)
                  let result: 'WIN' | 'LOSS' | 'PENDING' = 'PENDING';
                  const entryDateStr = new Date(data[i].date).toDateString();
                  
                  // Sprawdzamy najpierw świecę wejściową (i)
                  if (data[i].high >= sl) {
                    result = 'LOSS';
                  } else if (data[i].low <= tp1) {
                    result = 'WIN';
                  } else {
                    // Jeśli na świecy wejściowej nie było TP ani SL, sprawdzamy kolejne świece z tego samego dnia
                    for (let j = i + 1; j < data.length; j++) {
                      const currentDateStr = new Date(data[j].date).toDateString();
                      if (currentDateStr !== entryDateStr) {
                        // Koniec dnia - zamykamy pozycję. Sprawdzamy czy zysk czy strata.
                        const closePrice = data[j - 1].close;
                        result = closePrice < entry ? 'WIN' : 'LOSS';
                        break;
                      }
                      if (data[j].high >= sl) { result = 'LOSS'; break; }
                      if (data[j].low <= tp1) { result = 'WIN'; break; }
                    }
                    
                    // Jeśli to ostatnia świeca i nadal jesteśmy w tym samym dniu
                    if (result === 'PENDING' && i === data.length - 1) {
                      result = 'PENDING';
                    }
                  }

                  signals.push({
                    date: data[i].date,
                    type: 'SHORT',
                    p1: p1_val, p2: p2_val, p3: p3_val,
                    p1_idx, p2_idx, p3_idx,
                    entry, sl,
                    tp1, tp2,
                    rr: 1.5,
                    trigger_idx: i,
                    result,
                    isTrendAligned,
                    isVolumeConfirmed,
                    positionSize: lotSize,
                    isTradeable,
                    actualRiskPLN,
                    pros,
                    cons
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return signals;
}
