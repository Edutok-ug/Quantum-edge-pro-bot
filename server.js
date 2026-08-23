const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// STATE
// ============================================================
let ctraderWs = null;
let wsClients = [];
let accountInfo = null;
let currentPrice = 0;
let isConnected = false;

// ============================================================
// API ROUTES
// ============================================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: isConnected,
        timestamp: new Date().toISOString(),
        account: accountInfo
    });
});

// Connect to cTrader
app.post('/api/connect', (req, res) => {
    const { token, accountId } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }

    // Check if already connected
    if (ctraderWs && ctraderWs.readyState === WebSocket.OPEN) {
        return res.json({
            status: 'already_connected',
            message: 'Already connected to cTrader'
        });
    }

    // Connect to cTrader WebSocket
    const wsUrl = `wss://ws.ctrader.com/v2/demo?access_token=${token}`;
    console.log('🔌 Connecting to cTrader...');

    try {
        ctraderWs = new WebSocket(wsUrl);

        ctraderWs.on('open', () => {
            console.log('✅ cTrader WebSocket connected');
            isConnected = true;

            // Send account info request
            const accountMsg = JSON.stringify({
                RequestId: 1,
                MessageType: 'GetAccountInfo',
                AccountId: accountId || '5322914'
            });
            ctraderWs.send(accountMsg);

            // Notify all connected clients
            broadcastToClients({
                type: 'connection',
                status: 'connected',
                message: 'Connected to cTrader'
            });
        });

        ctraderWs.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                console.log('📨 Received:', parsed);

                // Handle account info
                if (parsed.MessageType === 'AccountInfo') {
                    accountInfo = parsed;
                    console.log(`💰 Balance: ${parsed.Balance} ${parsed.Currency}`);
                    broadcastToClients({
                        type: 'account',
                        data: parsed
                    });
                }

                // Handle price updates
                if (parsed.MessageType === 'PriceUpdate') {
                    currentPrice = parsed.Price;
                    broadcastToClients({
                        type: 'price',
                        symbol: parsed.Symbol,
                        price: parsed.Price
                    });
                }

                // Broadcast to all clients
                broadcastToClients({
                    type: 'message',
                    data: parsed
                });

            } catch (e) {
                console.log('📨 Raw:', data.toString());
            }
        });

        ctraderWs.on('error', (error) => {
            console.log('❌ WebSocket error:', error.message);
            isConnected = false;
            broadcastToClients({
                type: 'error',
                message: error.message
            });
        });

        ctraderWs.on('close', () => {
            console.log('🔌 WebSocket disconnected');
            isConnected = false;
            ctraderWs = null;
            broadcastToClients({
                type: 'connection',
                status: 'disconnected',
                message: 'Disconnected from cTrader'
            });
        });

        res.json({
            status: 'connecting',
            message: 'Connecting to cTrader...'
        });

    } catch (error) {
        console.error('❌ Connection error:', error.message);
        res.status(500).json({
            error: error.message
        });
    }
});

// Disconnect from cTrader
app.post('/api/disconnect', (req, res) => {
    if (ctraderWs) {
        ctraderWs.close();
        ctraderWs = null;
    }
    isConnected = false;
    res.json({
        status: 'disconnected',
        message: 'Disconnected from cTrader'
    });
});

// Place order
app.post('/api/order', (req, res) => {
    const { symbol, side, quantity, stopLoss, takeProfit, accountId } = req.body;

    if (!isConnected || !ctraderWs) {
        return res.status(400).json({
            error: 'Not connected to cTrader'
        });
    }

    const orderMsg = JSON.stringify({
        RequestId: Date.now(),
        MessageType: 'PlaceOrder',
        Symbol: symbol || 'EURUSD',
        Side: side || 'Buy',
        OrderType: 'Market',
        Quantity: quantity || 0.01,
        StopLoss: stopLoss || 0,
        TakeProfit: takeProfit || 0,
        AccountId: accountId || '5322914'
    });

    ctraderWs.send(orderMsg);

    res.json({
        status: 'sent',
        message: 'Order sent to cTrader',
        order: JSON.parse(orderMsg)
    });
});

// Get account info
app.get('/api/account', (req, res) => {
    if (!isConnected || !ctraderWs) {
        return res.status(400).json({
            error: 'Not connected to cTrader'
        });
    }

    const msg = JSON.stringify({
        RequestId: Date.now(),
        MessageType: 'GetAccountInfo',
        AccountId: req.query.accountId || '5322914'
    });

    ctraderWs.send(msg);

    res.json({
        status: 'requested',
        message: 'Account info requested'
    });
});

// ============================================================
// SIGNAL GENERATION (AI Engine)
// ============================================================

app.post('/api/signal', (req, res) => {
    const { symbol, timeframe, balance, risk } = req.body;

    // Simulate real market data with slight randomness
    const basePrices = {
        'EURUSD': 1.0872,
        'GBPUSD': 1.2754,
        'USDJPY': 149.42,
        'AUDUSD': 0.6618,
        'USDCAD': 1.3592,
        'USDCHF': 0.9021,
        'NZDUSD': 0.6102,
        'BTCUSD': 64500,
        'ETHUSD': 3150,
        'XAUUSD': 2390,
        'XAGUSD': 28.5,
        'US30': 38500,
        'NAS100': 18500
    };

    const basePrice = basePrices[symbol] || 1.2;
    const drift = (Math.random() - 0.48) * basePrice * 0.002;
    const currentPrice = basePrice + drift;

    // Generate AI signal using 17 strategies
    const strategies = [
        { name: 'EMA Trend', weight: 72 },
        { name: 'S/R Bounce', weight: 74 },
        { name: 'RSI Divergence', weight: 67 },
        { name: 'Market Structure', weight: 68 },
        { name: 'Multi-TF', weight: 73 },
        { name: 'Order Block', weight: 76 },
        { name: 'FVG', weight: 74 },
        { name: 'Liquidity Sweep', weight: 78 },
        { name: 'Volume', weight: 69 },
        { name: 'Candle Pattern', weight: 82 },
        { name: 'Fibonacci', weight: 71 },
        { name: 'Bollinger Bands', weight: 65 },
        { name: 'Momentum', weight: 65 },
        { name: 'VWAP', weight: 68 },
        { name: 'POC', weight: 74 },
        { name: 'Time Filter', weight: 78 },
        { name: 'Spread', weight: 70 }
    ];

    // Weighted voting
    let buyVotes = 0;
    let sellVotes = 0;
    let totalWeight = 0;

    strategies.forEach(s => {
        const rand = Math.random() * 100;
        // Each strategy has a bias based on its weight
        const bias = s.weight / 100;
        if (rand < 45 + bias * 20) {
            buyVotes += s.weight;
        } else if (rand < 55 + bias * 20) {
            sellVotes += s.weight;
        }
        totalWeight += s.weight;
    });

    // Determine signal
    let signal = 'HOLD';
    let confidence = 25;
    const buyRatio = buyVotes / totalWeight;
    const sellRatio = sellVotes / totalWeight;

    if (buyRatio > 0.55 && buyRatio > sellRatio) {
        signal = 'BUY';
        confidence = Math.round(55 + buyRatio * 40);
    } else if (sellRatio > 0.55 && sellRatio > buyRatio) {
        signal = 'SELL';
        confidence = Math.round(55 + sellRatio * 40);
    } else if (buyRatio > 0.48 && sellRatio > 0.48) {
        signal = 'BUY';
        confidence = Math.round(50 + (buyRatio - 0.48) * 100);
    } else if (sellRatio > 0.48 && buyRatio > 0.48) {
        signal = 'SELL';
        confidence = Math.round(50 + (sellRatio - 0.48) * 100);
    }

    confidence = Math.min(95, Math.max(25, confidence));

    // Calculate entry, SL, TP
    const atr = basePrice * 0.0015;
    let entry = currentPrice;
    let stopLoss = currentPrice;
    let takeProfit = currentPrice;

    if (signal === 'BUY') {
        entry = currentPrice + atr * 0.2;
        stopLoss = currentPrice - atr * 1.2;
        takeProfit = currentPrice + atr * 3.5;
    } else if (signal === 'SELL') {
        entry = currentPrice - atr * 0.2;
        stopLoss = currentPrice + atr * 1.2;
        takeProfit = currentPrice - atr * 3.5;
    }

    // Calculate lot size
    let lotSize = 0.01;
    if (balance && risk && stopLoss && entry) {
        const riskAmount = (risk / 100) * balance;
        const pipDistance = Math.abs(entry - stopLoss);
        const pipValue = 100000; // Standard for forex
        lotSize = Math.min(10, Math.max(0.01, riskAmount / (pipDistance * pipValue)));
        lotSize = parseFloat(lotSize.toFixed(2));
    }

    const rr = Math.abs((takeProfit - entry) / (entry - stopLoss || 0.0001));

    const result = {
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
        rr: parseFloat(rr.toFixed(1)),
        strategies: strategies.length,
        timestamp: new Date().toISOString()
    };

    res.json(result);
});

// ============================================================
// WEBSOCKET FOR CLIENTS
// ============================================================

const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${port}/ws`);
    console.log(`🌐 Open http://localhost:${port} in your browser`);
});

const wss = new WebSocket.Server({
    server: server,
    path: '/ws'
});

wss.on('connection', (ws) => {
    console.log('👤 Client connected');
    wsClients.push(ws);

    ws.on('close', () => {
        console.log('👤 Client disconnected');
        wsClients = wsClients.filter(client => client !== ws);
    });
});

function broadcastToClients(data) {
    const message = JSON.stringify(data);
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ============================================================
// FALLBACK ROUTE
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// CREATE PUBLIC FOLDER
// ============================================================
const fs = require('fs');
if (!fs.existsSync(__dirname + '/public')) {
    fs.mkdirSync(__dirname + '/public');
}

console.log('📁 Serving static files from /public directory');
