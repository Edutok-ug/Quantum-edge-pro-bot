const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the root directory (where index.html is)
app.use(express.static(__dirname));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: false,
        timestamp: new Date().toISOString()
    });
});

// Connect to cTrader
app.post('/api/connect', (req, res) => {
    const { token, accountId } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }
    res.json({
        status: 'connecting',
        message: 'Connecting to cTrader... (simulated)'
    });
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
    res.json({ status: 'disconnected', message: 'Disconnected' });
});

// Generate signal
app.post('/api/signal', (req, res) => {
    const { symbol, timeframe, balance, risk } = req.body;
    
    const basePrices = {
        'EURUSD': 1.0872, 'GBPUSD': 1.2754, 'USDJPY': 149.42,
        'AUDUSD': 0.6618, 'USDCAD': 1.3592, 'USDCHF': 0.9021,
        'NZDUSD': 0.6102, 'BTCUSD': 64500, 'ETHUSD': 3150,
        'XAUUSD': 2390, 'XAGUSD': 28.5, 'US30': 38500, 'NAS100': 18500
    };
    
    const basePrice = basePrices[symbol] || 1.2;
    const currentPrice = basePrice + (Math.random() - 0.48) * basePrice * 0.002;
    
    // Generate signal
    const signals = ['BUY', 'SELL', 'HOLD'];
    const weights = [35, 35, 30];
    let random = Math.random() * 100;
    let signal = 'HOLD';
    let confidence = 25;
    
    if (random < 35) { signal = 'BUY'; confidence = 55 + Math.random() * 30; }
    else if (random < 70) { signal = 'SELL'; confidence = 55 + Math.random() * 30; }
    else { signal = 'HOLD'; confidence = 20 + Math.random() * 20; }
    confidence = Math.round(confidence);
    
    const atr = basePrice * 0.0015;
    let entry = currentPrice, stopLoss = currentPrice, takeProfit = currentPrice;
    
    if (signal === 'BUY') {
        entry = currentPrice + atr * 0.2;
        stopLoss = currentPrice - atr * 1.2;
        takeProfit = currentPrice + atr * 3.5;
    } else if (signal === 'SELL') {
        entry = currentPrice - atr * 0.2;
        stopLoss = currentPrice + atr * 1.2;
        takeProfit = currentPrice - atr * 3.5;
    }
    
    let lotSize = 0.01;
    if (balance && risk && stopLoss && entry) {
        const riskAmount = (risk / 100) * balance;
        const pipDistance = Math.abs(entry - stopLoss);
        lotSize = Math.min(10, Math.max(0.01, riskAmount / (pipDistance * 100000)));
        lotSize = parseFloat(lotSize.toFixed(2));
    }
    
    res.json({
        signal: signal,
        confidence: confidence,
        entry: parseFloat(entry.toFixed(5)),
        stopLoss: parseFloat(stopLoss.toFixed(5)),
        takeProfit: parseFloat(takeProfit.toFixed(5)),
        lotSize: lotSize,
        risk: risk || 1,
        balance: balance || 10752,
        symbol: symbol || 'EURUSD',
        timeframe: timeframe || '5min',
        currentPrice: parseFloat(currentPrice.toFixed(5)),
        rr: parseFloat((Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss || 0.0001)).toFixed(1)),
        strategies: 17,
        timestamp: new Date().toISOString()
    });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Open http://localhost:${port} in your browser`);
});

// WebSocket for real-time updates
const wss = new WebSocket.Server({ server, path: '/ws' });
wss.on('connection', (ws) => {
    console.log('👤 Client connected');
    ws.on('close', () => console.log('👤 Client disconnected'));
});
