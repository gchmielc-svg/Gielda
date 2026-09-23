import requests
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import time
import csv
import os

# ==========================================
# 1. DATA FETCHER
# ==========================================
def fetch_binance_data(symbol="BTCUSDT", interval="1d", limit=200):
    """
    Fetches historical OHLCV data from Binance public API.
    Handles retries gracefully.
    """
    url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # Parse OHLCV into structured format
            df = pd.DataFrame(data, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_asset_volume', 'number_of_trades',
                'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
            ])
            
            # Convert timestamp to datetime
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            
            # Convert string values to float
            for col in ['open', 'high', 'low', 'close', 'volume']:
                df[col] = df[col].astype(float)
                
            return df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]
        except Exception as e:
            print(f"Attempt {attempt+1} failed to fetch data: {e}")
            time.sleep(2)
    return None

# ==========================================
# 2. TECHNICAL INDICATORS (Implemented manually)
# ==========================================
def calculate_ema(series, period):
    """Calculates Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()

def calculate_adx(df, period=14):
    """Calculates ADX, +DI, and -DI using Wilder's Smoothing."""
    up_move = df['high'] - df['high'].shift(1)
    down_move = df['low'].shift(1) - df['low']
    
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    
    plus_dm = pd.Series(plus_dm, index=df.index)
    minus_dm = pd.Series(minus_dm, index=df.index)
    
    tr1 = df['high'] - df['low']
    tr2 = np.abs(df['high'] - df['close'].shift(1))
    tr3 = np.abs(df['low'] - df['close'].shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    
    # Wilder's smoothing uses alpha=1/period
    atr = tr.ewm(alpha=1/period, adjust=False).mean()
    plus_di = 100 * (plus_dm.ewm(alpha=1/period, adjust=False).mean() / atr)
    minus_di = 100 * (minus_dm.ewm(alpha=1/period, adjust=False).mean() / atr)
    
    dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.ewm(alpha=1/period, adjust=False).mean()
    
    return adx

def detect_pivots(df, window=2):
    """
    Detects swing highs and lows using a 5-candle window 
    (2 left, 1 center, 2 right).
    """
    highs = df['high'].values
    lows = df['low'].values
    
    pivot_highs = [False] * len(df)
    pivot_lows = [False] * len(df)
    
    for i in range(window, len(df) - window):
        is_high = True
        is_low = True
        for j in range(i - window, i + window + 1):
            if i != j:
                if highs[i] <= highs[j]:
                    is_high = False
                if lows[i] >= lows[j]:
                    is_low = False
        if is_high:
            pivot_highs[i] = True
        if is_low:
            pivot_lows[i] = True
            
    return pivot_highs, pivot_lows

# ==========================================
# 3. FORMATION DETECTOR
# ==========================================
def detect_123_formation(df):
    """
    Runs the full 1-2-3 pattern recognition logic.
    Returns the dataframe with indicators and a list of detected signals.
    """
    df = df.copy()
    
    # Calculate indicators
    df['ema20'] = calculate_ema(df['close'], 20)
    df['ema50'] = calculate_ema(df['close'], 50)
    df['ema200'] = calculate_ema(df['close'], 200)
    df['adx'] = calculate_adx(df, 14)
    df['pivot_high'], df['pivot_low'] = detect_pivots(df, window=2)
    
    signals = []
    
    # Iterate through the dataframe to find triggers
    for i in range(50, len(df)):
        # Find recent pivots before the current candle
        recent_lows = df.index[df['pivot_low'] & (df.index < i)].tolist()
        recent_highs = df.index[df['pivot_high'] & (df.index < i)].tolist()
        
        # --- BULLISH 1-2-3 (LONG) ---
        if len(recent_lows) >= 2 and len(recent_highs) >= 1:
            p3_idx = recent_lows[-1]
            p1_idx = recent_lows[-2]
            
            # Point 2 must be a swing high between P1 and P3
            p2_candidates = [idx for idx in recent_highs if p1_idx < idx < p3_idx]
            
            if p2_candidates:
                # Find the highest high among candidates for Point 2
                p2_idx = max(p2_candidates, key=lambda idx: df.loc[idx, 'high'])
                p1_val, p2_val, p3_val = df.loc[p1_idx, 'low'], df.loc[p2_idx, 'high'], df.loc[p3_idx, 'low']
                
                # Rule: Higher Low (Point 3 > Point 1)
                if p3_val > p1_val:
                    # Trigger: Previous close <= P2, Current close > P2
                    if df.loc[i-1, 'close'] <= p2_val and df.loc[i, 'close'] > p2_val:
                        
                        # Invalidation 1: Price broke below P1 before triggering?
                        if df.loc[p3_idx:i, 'low'].min() > p1_val:
                            
                            # Confirmation: ADX > 20 and Price > EMA50
                            if df.loc[i, 'adx'] > 20 and df.loc[i, 'close'] > df.loc[i, 'ema50']:
                                
                                # Invalidation 2: Max 10 candles since P3
                                if (i - p3_idx) <= 10:
                                    entry = df.loc[i, 'close']
                                    sl = p3_val * 0.995 # SL 0.5% below P3
                                    
                                    # SL distance check (max 5%)
                                    if (entry - sl) / entry <= 0.05:
                                        risk = entry - sl
                                        signals.append({
                                            'date': df.loc[i, 'timestamp'].strftime('%Y-%m-%d'),
                                            'type': 'LONG',
                                            'p1': p1_val, 'p2': p2_val, 'p3': p3_val,
                                            'p1_idx': p1_idx, 'p2_idx': p2_idx, 'p3_idx': p3_idx,
                                            'entry': entry, 'sl': sl,
                                            'tp1': entry + risk * 1.5, 'tp2': entry + risk * 2.5,
                                            'rr': 1.5, 'adx': df.loc[i, 'adx'],
                                            'trigger_idx': i
                                        })

        # --- BEARISH 1-2-3 (SHORT) ---
        if len(recent_highs) >= 2 and len(recent_lows) >= 1:
            p3_idx_bear = recent_highs[-1]
            p1_idx_bear = recent_highs[-2]
            
            # Point 2 must be a swing low between P1 and P3
            p2_candidates_bear = [idx for idx in recent_lows if p1_idx_bear < idx < p3_idx_bear]
            
            if p2_candidates_bear:
                # Find the lowest low among candidates for Point 2
                p2_idx_bear = min(p2_candidates_bear, key=lambda idx: df.loc[idx, 'low'])
                p1_val_bear, p2_val_bear, p3_val_bear = df.loc[p1_idx_bear, 'high'], df.loc[p2_idx_bear, 'low'], df.loc[p3_idx_bear, 'high']
                
                # Rule: Lower High (Point 3 < Point 1)
                if p3_val_bear < p1_val_bear:
                    # Trigger: Previous close >= P2, Current close < P2
                    if df.loc[i-1, 'close'] >= p2_val_bear and df.loc[i, 'close'] < p2_val_bear:
                        
                        # Invalidation 1: Price broke above P1 before triggering?
                        if df.loc[p3_idx_bear:i, 'high'].max() < p1_val_bear:
                            
                            # Confirmation: ADX > 20 and Price < EMA50
                            if df.loc[i, 'adx'] > 20 and df.loc[i, 'close'] < df.loc[i, 'ema50']:
                                
                                # Invalidation 2: Max 10 candles since P3
                                if (i - p3_idx_bear) <= 10:
                                    entry = df.loc[i, 'close']
                                    sl = p3_val_bear * 1.005 # SL 0.5% above P3
                                    
                                    # SL distance check (max 5%)
                                    if (sl - entry) / entry <= 0.05:
                                        risk = sl - entry
                                        signals.append({
                                            'date': df.loc[i, 'timestamp'].strftime('%Y-%m-%d'),
                                            'type': 'SHORT',
                                            'p1': p1_val_bear, 'p2': p2_val_bear, 'p3': p3_val_bear,
                                            'p1_idx': p1_idx_bear, 'p2_idx': p2_idx_bear, 'p3_idx': p3_idx_bear,
                                            'entry': entry, 'sl': sl,
                                            'tp1': entry - risk * 1.5, 'tp2': entry - risk * 2.5,
                                            'rr': 1.5, 'adx': df.loc[i, 'adx'],
                                            'trigger_idx': i
                                        })
                                        
    return df, signals

# ==========================================
# 4. SIGNAL OUTPUT
# ==========================================
def print_signal(signal):
    """Prints a structured report for the signal."""
    print("╔══════════════════════════════════════════╗")
    print("║     BTC/USD — 1-2-3 FORMATION SIGNAL     ║")
    print("╠══════════════════════════════════════════╣")
    print(f"║ Date:        {signal['date']:<27} ║")
    print(f"║ Signal:      {signal['type']:<27} ║")
    print("║ Entry Time:  00:01 UTC                   ║")
    print("║ Close Time:  23:59 UTC (hard limit)      ║")
    print("╠══════════════════════════════════════════╣")
    print("║ FORMATION POINTS                         ║")
    print(f"║ Point 1:     ${signal['p1']:<26,.2f} ║")
    print(f"║ Point 2:     ${signal['p2']:<14,.2f} ← Trigger      ║")
    print(f"║ Point 3:     ${signal['p3']:<14,.2f} ← HL/LH        ║")
    print("╠══════════════════════════════════════════╣")
    print("║ LEVELS                                   ║")
    print(f"║ Entry:       ${signal['entry']:<26,.2f} ║")
    
    sl_pct = (signal['sl'] - signal['entry']) / signal['entry'] * 100
    print(f"║ Stop Loss:   ${signal['sl']:<12,.2f} ({sl_pct:>+5.2f}%)       ║")
    
    tp1_pct = (signal['tp1'] - signal['entry']) / signal['entry'] * 100
    print(f"║ Take Profit 1: ${signal['tp1']:<10,.2f} ({tp1_pct:>+5.2f}%) 1.5R ║")
    
    tp2_pct = (signal['tp2'] - signal['entry']) / signal['entry'] * 100
    print(f"║ Take Profit 2: ${signal['tp2']:<10,.2f} ({tp2_pct:>+5.2f}%) 2.5R ║")
    
    print(f"║ Risk/Reward:  {signal['rr']:<26.2f} ║")
    print("╠══════════════════════════════════════════╣")
    print("║ CONFIRMATION                             ║")
    trend = "BULLISH" if signal['type'] == 'LONG' else "BEARISH"
    print(f"║ Trend:       {trend:<27} ║")
    print(f"║ ADX:         {signal['adx']:<5.1f} (>20 ✓)               ║")
    ema_status = "ABOVE" if signal['type'] == 'LONG' else "BELOW"
    print(f"║ EMA50:       Price {ema_status:<5} ✓               ║")
    print("║ Signal Valid: YES — All criteria met     ║")
    print("╚══════════════════════════════════════════╝")

# ==========================================
# 5. VISUALIZATION
# ==========================================
def plot_signal(df, signal):
    """Generates a matplotlib chart for the signal."""
    # Plot last 60 candles up to the trigger candle
    end_idx = signal['trigger_idx']
    start_idx = max(0, end_idx - 60)
    plot_df = df.iloc[start_idx:end_idx+1].copy()
    
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [3, 1]})
    
    # Candlesticks
    up = plot_df[plot_df.close >= plot_df.open]
    down = plot_df[plot_df.close < plot_df.open]
    
    width = 0.6
    width2 = 0.1
    
    ax1.bar(up.index, up.close - up.open, width, bottom=up.open, color='green')
    ax1.bar(up.index, up.high - up.close, width2, bottom=up.close, color='green')
    ax1.bar(up.index, up.open - up.low, width2, bottom=up.low, color='green')
    
    ax1.bar(down.index, down.close - down.open, width, bottom=down.open, color='red')
    ax1.bar(down.index, down.high - down.open, width2, bottom=down.open, color='red')
    ax1.bar(down.index, down.close - down.low, width2, bottom=down.low, color='red')
    
    # EMAs
    ax1.plot(plot_df.index, plot_df['ema20'], color='blue', label='EMA 20', linewidth=1)
    ax1.plot(plot_df.index, plot_df['ema50'], color='orange', label='EMA 50', linewidth=1)
    ax1.plot(plot_df.index, plot_df['ema200'], color='red', label='EMA 200', linewidth=1)
    
    # Points 1, 2, 3
    p1_idx, p2_idx, p3_idx = signal['p1_idx'], signal['p2_idx'], signal['p3_idx']
    if p1_idx >= start_idx:
        ax1.plot(p1_idx, signal['p1'], 'ko', markersize=8)
        ax1.annotate('1', (p1_idx, signal['p1']), xytext=(0, 10), textcoords='offset points', ha='center')
    if p2_idx >= start_idx:
        ax1.plot(p2_idx, signal['p2'], 'ko', markersize=8)
        ax1.annotate('2', (p2_idx, signal['p2']), xytext=(0, 10), textcoords='offset points', ha='center')
    if p3_idx >= start_idx:
        ax1.plot(p3_idx, signal['p3'], 'ko', markersize=8)
        ax1.annotate('3', (p3_idx, signal['p3']), xytext=(0, 10), textcoords='offset points', ha='center')
        
    # Connecting lines
    pts_x = [idx for idx in [p1_idx, p2_idx, p3_idx] if idx >= start_idx]
    pts_y = [signal[f'p{i}'] for i, idx in enumerate([p1_idx, p2_idx, p3_idx], 1) if idx >= start_idx]
    ax1.plot(pts_x, pts_y, 'k--', alpha=0.5)
    
    # Levels
    ax1.axhline(signal['entry'], color='blue', linestyle='--', alpha=0.5, label='Entry')
    ax1.axhline(signal['sl'], color='red', linestyle='--', alpha=0.5, label='SL')
    ax1.axhline(signal['tp1'], color='green', linestyle='--', alpha=0.5, label='TP1')
    ax1.axhline(signal['tp2'], color='darkgreen', linestyle='--', alpha=0.5, label='TP2')
    
    ax1.set_title(f"BTC/USD D1 — 1-2-3 Formation | {signal['date']}")
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # ADX Subplot
    ax2.plot(plot_df.index, plot_df['adx'], color='purple', label='ADX (14)')
    ax2.axhline(20, color='gray', linestyle='--', alpha=0.5)
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    # Format x-axis
    def format_date(x, pos=None):
        if 0 <= int(x) < len(df):
            return df['timestamp'].iloc[int(x)].strftime('%Y-%m-%d')
        return ''
    
    ax2.xaxis.set_major_formatter(plt.FuncFormatter(format_date))
    plt.xticks(rotation=45)
    plt.tight_layout()
    
    filename = f"btc_123_signal_{signal['date'].replace('-', '')}.png"
    plt.savefig(filename)
    print(f"Chart saved as {filename}")

# ==========================================
# 6. SCHEDULER / LOGGER
# ==========================================
def log_signal(signal, filename="btc_123_signals_log.csv"):
    """Logs the signal to a CSV file."""
    file_exists = os.path.isfile(filename)
    with open(filename, mode='a', newline='') as file:
        writer = csv.writer(file)
        if not file_exists:
            writer.writerow(['Date', 'Type', 'Entry', 'SL', 'TP1', 'TP2', 'RR', 'ADX'])
        writer.writerow([
            signal['date'], signal['type'], signal['entry'], signal['sl'],
            signal['tp1'], signal['tp2'], signal['rr'], round(signal['adx'], 2)
        ])

# ==========================================
# MAIN EXECUTION
# ==========================================
def main():
    print("Fetching BTC/USDT daily data from Binance...")
    df = fetch_binance_data()
    
    if df is None:
        print("Failed to fetch data. Exiting.")
        return
        
    print("Running 1-2-3 formation analysis...")
    df, signals = detect_123_formation(df)
    
    # Check if there is a signal today (last candle)
    today_idx = df.index[-1]
    today_signals = [s for s in signals if s['trigger_idx'] == today_idx]
    
    if today_signals:
        for signal in today_signals:
            print_signal(signal)
            plot_signal(df, signal)
            log_signal(signal)
    else:
        print("No valid 1-2-3 formation detected today.")
        
    # Optionally, print the last detected historical signal if none today
    if not today_signals and signals:
        print(f"\n[INFO] Last historical signal was detected on {signals[-1]['date']}:")
        print_signal(signals[-1])
        plot_signal(df, signals[-1])

if __name__ == "__main__":
    main()
