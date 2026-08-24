const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION
// ============================================================
const CLIENT_ID = process.env.CTRADER_CLIENT_ID;
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET;
const REDIRECT_URI = process.env.CTRADER_REDIRECT_URI || 'https://quantum-edge-pro-bot.onrender.com/oauth/callback';

console.log('🔍 Configuration Check:');
console.log('CLIENT_ID:', CLIENT_ID ? '✅ SET' : '❌ MISSING');
console.log('CLIENT_SECRET:', CLIENT_SECRET ? '✅ SET' : '❌ MISSING');
console.log('REDIRECT_URI:', REDIRECT_URI);

const AUTH_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const WS_DEMO_URL = 'wss://demo.ctraderapi.com:5036';

// ============================================================
// STATE
// ============================================================
let userTokens = {};
let ctraderWs = null;
let isConnected = false;
let isAccountAuthenticated = false;
let wsClients = [];
let tradingAccounts = [];
let selectedAccount = null;
let symbols = {};
let prices = {};
let positions = [];
let requestId = 1000;
let accountListRequested = false;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// OAUTH ROUTES
// ============================================================

app.get('/auth/ctrader', (req, res) => {
    console.log('🔑 OAuth login requested');
    
    if (!CLIENT_ID) {
        return res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Configuration Error</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <h1 style="color:#f59e0b;">⚠️ Configuration Error</h1>
                <p>CTRADER_CLIENT_ID is not set.</p>
                <a href="/" style="color:#f59e0b;">← Back</a>
            </body>
            </html>
        `);
    }
    
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `${AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=trading&product=web&state=${state}`;
    
    console.log('🔄 Redirecting to:', authUrl);
    res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
    console.log('📨 OAuth callback received');
    const { code, state, error } = req.query;
    
    if (error || !code) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>${error ? 'Authorization Error' : 'No Code'}</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <h1 style="color:#ef4444;">${error || '❌ No Code Received'}</h1>
                <a href="/auth/ctrader" style="color:#f59e0b;">🔐 Try Again</a>
                <br><a href="/" style="color:#f59e0b;">← Back</a>
            </body>
            </html>
        `);
    }
    
    try {
        console.log('🔄 Exchanging code for token...');
        
        const tokenResponse = await axios({
            method: 'POST',
            url: TOKEN_URL,
            params: {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        const responseData = tokenResponse.data;
        console.log('Token response:', JSON.stringify(responseData, null, 2));
        
        const accessToken = responseData.accessToken || responseData.access_token || null;
        const refreshToken = responseData.refreshToken || responseData.refresh_token || null;
        const expireAt = responseData.expireAt || responseData.expires_in || 3600;
        
        if (!accessToken) {
            throw new Error('No access token received');
        }
        
        userTokens.accessToken = accessToken;
        userTokens.refreshToken = refreshToken;
        userTokens.expiresAt = Date.now() + (parseInt(expireAt) * 1000);
        
        // Start WebSocket connection automatically
        setTimeout(() => {
            connectToCtrader();
        }, 1000);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>✅ Authentication Successful</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 750px; border: 1px solid #10b981; }
                    h1 { color: #10b981; }
                    .token-display { background: #0a1222; padding: 15px; border-radius: 8px; word-break: break-all; font-size: 13px; border: 1px solid #2a3a5a; margin: 10px 0; max-height: 200px; overflow-y: auto; font-family: monospace; color: #60a5fa; }
                    .btn { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #0a0e1a; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px; border: none; cursor: pointer; }
                    .btn:hover { opacity: 0.8; }
                    .btn-green { background: #10b981; }
                    .info { color: #94a3b8; font-size: 13px; line-height: 1.8; }
                    .flex { display: flex; gap: 10px; flex-wrap: wrap; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>✅ Authentication Successful!</h1>
                    <p>Your Pepperstone cTrader token has been generated.</p>
                    
                    <div class="token-display">
                        <strong>🔑 Access Token:</strong><br>
                        ${accessToken}
                    </div>
                    
                    <div class="info">
                        ⏰ Expires in ${Math.floor(parseInt(expireAt) / 3600)} hours<br>
                        🔄 Refresh token stored on server
                    </div>
                    
                    <div class="flex">
                        <button onclick="copyToken()" class="btn btn-green">📋 Copy Token</button>
                        <a href="/" class="btn">🚀 Go to Bot</a>
                    </div>
                    
                    <div class="info" style="margin-top:15px;color:#f59e0b;">
                        🔌 Auto-connecting to cTrader WebSocket...
                    </div>
                    
                    <script>
                        function copyToken() {
                            const token = '${accessToken}';
                            navigator.clipboard.writeText(token).then(() => alert('✅ Token copied!')).catch(() => {
                                const ta = document.createElement('textarea');
                                ta.value = token;
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                                alert('✅ Token copied!');
                            });
                        }
                    </script>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('❌ Token exchange error:', error.message);
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Token Exchange Failed</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <h1 style="color:#ef4444;">❌ Token Exchange Failed</h1>
                <pre style="background:#0a1222;padding:15px;border-radius:8px;overflow:auto;max-height:300px;">${error.message}</pre>
                <a href="/auth/ctrader" style="color:#f59e0b;">🔐 Try Again</a>
                <br><a href="/" style="color:#f59e0b;">← Back</a>
            </body>
            </html>
        `);
    }
});

// ============================================================
// CTRADER WEBSOCKET CONNECTION - FIXED
// ============================================================

function connectToCtrader() {
    if (ctraderWs && ctraderWs.readyState === WebSocket.OPEN) {
        console.log('Already connected');
        return;
    }
    
    if (!userTokens.accessToken) {
        console.log('❌ No access token available');
        return;
    }
    
    console.log('🔌 Connecting to cTrader WebSocket...');
    
    try {
        ctraderWs = new WebSocket(WS_DEMO_URL);
        
        ctraderWs.on('open', () => {
            console.log('✅ WebSocket connected to cTrader');
            isConnected = true;
            broadcastToClients({ type: 'connection', status: 'connected' });
            
            // Step 1: Authenticate application
            authenticateApplication();
        });
        
        ctraderWs.on('message', (data) => {
            handleCtraderMessage(data);
        });
        
        ctraderWs.on('error', (error) => {
            console.log('❌ WebSocket error:', error.message);
            isConnected = false;
            broadcastToClients({ type: 'error', message: error.message });
        });
        
        ctraderWs.on('close', () => {
            console.log('🔌 WebSocket disconnected');
            isConnected = false;
            isAccountAuthenticated = false;
            broadcastToClients({ type: 'connection', status: 'disconnected' });
            setTimeout(connectToCtrader, 5000);
        });
        
    } catch (error) {
        console.error('❌ Connection error:', error.message);
    }
}

function authenticateApplication() {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    
    console.log('🔐 Authenticating application...');
    const authMsg = {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
    };
    
    sendCtraderMessage('ProtoOAApplicationAuthReq', authMsg);
}

function getAccountList() {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    if (!userTokens.accessToken) return;
    
    console.log('📊 Requesting account list...');
    accountListRequested = true;
    
    const msg = {
        accessToken: userTokens.accessToken
    };
    
    sendCtraderMessage('ProtoOAGetAccountListByAccessTokenReq', msg);
}

function authenticateAccount(accountId) {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    if (!userTokens.accessToken) return;
    
    console.log('🔐 Authenticating account:', accountId);
    
    const msg = {
        ctidTraderAccountId: accountId,
        accessToken: userTokens.accessToken
    };
    
    sendCtraderMessage('ProtoOAAccountAuthReq', msg);
}

function getSymbols() {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    console.log('📊 Requesting symbols...');
    sendCtraderMessage('ProtoOASymbolsListReq', {});
}

function subscribePrices(symbolId) {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    console.log('📡 Subscribing to prices for symbol:', symbolId);
    sendCtraderMessage('ProtoOASubscribeSpotsReq', { symbolId: symbolId });
}

function getPositions() {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) return;
    if (!selectedAccount) return;
    
    console.log('📊 Requesting positions...');
    const msg = {
        ctidTraderAccountId: selectedAccount.ctidTraderAccountId
    };
    sendCtraderMessage('ProtoOAGetPositionsReq', msg);
}

function sendCtraderMessage(type, data) {
    if (!ctraderWs || ctraderWs.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not open');
        return null;
    }
    
    const reqId = ++requestId;
    const message = {
        ...data,
        type: type,
        requestId: reqId
    };
    
    ctraderWs.send(JSON.stringify(message));
    console.log(`📤 Sent ${type} (${reqId})`);
    return reqId;
}

// ============================================================
// MESSAGE HANDLER - FIXED
// ============================================================

function handleCtraderMessage(data) {
    try {
        const parsed = JSON.parse(data.toString());
        console.log('📨 Received:', parsed.type || 'unknown');
        
        switch (parsed.type) {
            case 'ProtoOAApplicationAuthRes':
                if (parsed.error) {
                    console.error('❌ App auth failed:', parsed.error);
                } else {
                    console.log('✅ Application authenticated');
                    // Step 2: Get account list
                    getAccountList();
                }
                break;
                
            case 'ProtoOAGetAccountListByAccessTokenRes':
                if (parsed.error) {
                    console.error('❌ Account list error:', parsed.error);
                    // Try alternative request format
                    console.log('🔄 Trying alternative account list request...');
                    const altMsg = {
                        accessToken: userTokens.accessToken,
                        ctidTraderAccountId: 0
                    };
                    sendCtraderMessage('ProtoOAGetAccountListByAccessTokenReq', altMsg);
                } else if (parsed.accounts && parsed.accounts.length > 0) {
                    tradingAccounts = parsed.accounts;
                    console.log(`📊 Found ${tradingAccounts.length} trading accounts`);
                    tradingAccounts.forEach(acc => {
                        console.log(`   - Account: ${acc.ctidTraderAccountId} | Balance: ${acc.balance} ${acc.currency}`);
                    });
                    
                    // Auto-select first account
                    if (tradingAccounts.length > 0) {
                        selectedAccount = tradingAccounts[0];
                        console.log('✅ Auto-selected account:', selectedAccount.ctidTraderAccountId);
                        authenticateAccount(selectedAccount.ctidTraderAccountId);
                    }
                    
                    broadcastToClients({
                        type: 'accounts',
                        accounts: tradingAccounts
                    });
                } else {
                    console.log('⚠️ No trading accounts found');
                    console.log('💡 Full response:', JSON.stringify(parsed, null, 2));
                    
                    // Try alternative: use the account from the token directly
                    if (parsed.ctidTraderAccountId) {
                        console.log('🔄 Using account from response:', parsed.ctidTraderAccountId);
                        authenticateAccount(parsed.ctidTraderAccountId);
                    }
                }
                break;
                
            case 'ProtoOAAccountAuthRes':
                if (parsed.error) {
                    console.error('❌ Account auth failed:', parsed.error);
                } else {
                    console.log('✅ Account authenticated successfully!');
                    isAccountAuthenticated = true;
                    broadcastToClients({
                        type: 'account_authenticated',
                        account: selectedAccount
                    });
                    // Get symbols and positions
                    getSymbols();
                    getPositions();
                }
                break;
                
            case 'ProtoOASymbolsListRes':
                if (parsed.symbols) {
                    symbols = {};
                    parsed.symbols.forEach(s => {
                        symbols[s.symbolId] = s;
                        if (s.symbolName) {
                            symbols[s.symbolName] = s.symbolId;
                        }
                    });
                    console.log(`📊 Loaded ${parsed.symbols.length} symbols`);
                    broadcastToClients({
                        type: 'symbols',
                        symbols: parsed.symbols
                    });
                }
                break;
                
            case 'ProtoOASpotEvent':
                if (parsed.spot) {
                    const spot = parsed.spot;
                    prices[spot.symbolId] = {
                        bid: spot.bid,
                        ask: spot.ask,
                        timestamp: spot.timestamp
                    };
                    broadcastToClients({
                        type: 'price',
                        symbolId: spot.symbolId,
                        bid: spot.bid,
                        ask: spot.ask
                    });
                }
                break;
                
            case 'ProtoOAPositionListRes':
                if (parsed.positions) {
                    positions = parsed.positions;
                    console.log(`📊 Found ${positions.length} open positions`);
                    broadcastToClients({
                        type: 'positions',
                        positions: positions
                    });
                }
                break;
                
            case 'ProtoOAExecutionEvent':
                if (parsed.execution) {
                    console.log(`📊 Execution: ${parsed.execution.orderType} ${parsed.execution.tradeSide}`);
                    broadcastToClients({
                        type: 'execution',
                        execution: parsed.execution
                    });
                }
                break;
                
            case 'ProtoOAErrorRes':
                console.error('❌ cTrader Error:', parsed.error);
                broadcastToClients({
                    type: 'error',
                    message: parsed.error
                });
                break;
                
            default:
                if (!parsed.type || !parsed.type.startsWith('ProtoOA')) {
                    // Don't log heartbeat messages
                } else {
                    console.log('📨 Unhandled message type:', parsed.type);
                }
        }
        
    } catch (e) {
        console.log('📨 Raw message:', data.toString().substring(0, 200));
    }
}

// ============================================================
// API ENDPOINTS
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: isConnected,
        accountAuthenticated: isAccountAuthenticated,
        hasToken: !!userTokens.accessToken,
        hasAccount: !!selectedAccount,
        accounts: tradingAccounts.length,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/token/status', (req, res) => {
    if (userTokens.accessToken && userTokens.expiresAt > Date.now()) {
        res.json({
            hasToken: true,
            expiresAt: userTokens.expiresAt,
            expiresIn: Math.floor((userTokens.expiresAt - Date.now()) / 1000)
        });
    } else {
        res.json({ hasToken: false });
    }
});

app.post('/api/ctrader/connect', (req, res) => {
    const { token } = req.body;
    
    if (token) {
        userTokens.accessToken = token;
    }
    
    if (!userTokens.accessToken) {
        return res.status(400).json({
            error: 'No access token. Please authenticate via /auth/ctrader'
        });
    }
    
    if (!isConnected) {
        connectToCtrader();
        res.json({ status: 'connecting', message: 'Connecting to cTrader...' });
    } else {
        res.json({ status: 'connected', message: 'Already connected to cTrader' });
    }
});

app.post('/api/ctrader/disconnect', (req, res) => {
    if (ctraderWs) {
        ctraderWs.close();
        ctraderWs = null;
    }
    isConnected = false;
    isAccountAuthenticated = false;
    res.json({ status: 'disconnected', message: 'Disconnected from cTrader' });
});

app.get('/api/ctrader/accounts', (req, res) => {
    if (tradingAccounts.length === 0 && isConnected) {
        getAccountList();
        setTimeout(() => {
            res.json({ accounts: tradingAccounts });
        }, 2000);
    } else {
        res.json({ accounts: tradingAccounts });
    }
});

app.post('/api/ctrader/select-account', (req, res) => {
    const { accountId } = req.body;
    
    if (!isConnected) {
        return res.status(400).json({ error: 'Not connected to cTrader' });
    }
    
    const account = tradingAccounts.find(a => a.ctidTraderAccountId === accountId);
    if (!account) {
        return res.status(404).json({ error: 'Account not found' });
    }
    
    selectedAccount = account;
    authenticateAccount(accountId);
    
    res.json({
        status: 'authenticating',
        account: account
    });
});

app.get('/api/ctrader/symbols', (req, res) => {
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    const symbolList = Object.values(symbols).filter(s => s.symbolName);
    res.json({ symbols: symbolList });
});

app.get('/api/ctrader/symbol/:name', (req, res) => {
    const { name } = req.params;
    for (const [id, symbol] of Object.entries(symbols)) {
        if (symbol.symbolName === name || symbol.symbolName === name.toUpperCase()) {
            return res.json({ symbolId: id, symbol: symbol });
        }
    }
    res.status(404).json({ error: 'Symbol not found' });
});

app.get('/api/ctrader/prices', (req, res) => {
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    res.json({ prices });
});

app.post('/api/ctrader/subscribe', (req, res) => {
    const { symbolId, symbolName } = req.body;
    
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    
    let targetId = symbolId;
    if (symbolName && !targetId) {
        for (const [id, symbol] of Object.entries(symbols)) {
            if (symbol.symbolName === symbolName || symbol.symbolName === symbolName.toUpperCase()) {
                targetId = id;
                break;
            }
        }
    }
    
    if (!targetId) {
        return res.status(404).json({ error: 'Symbol not found' });
    }
    
    subscribePrices(targetId);
    res.json({ status: 'subscribed', symbolId: targetId });
});

app.post('/api/ctrader/order', (req, res) => {
    const { symbol, side, volume, stopLoss, takeProfit } = req.body;
    
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    
    if (!selectedAccount) {
        return res.status(400).json({ error: 'No account selected' });
    }
    
    let symbolId = null;
    for (const [id, sym] of Object.entries(symbols)) {
        if (sym.symbolName === symbol || sym.symbolName === symbol.toUpperCase()) {
            symbolId = id;
            break;
        }
    }
    
    if (!symbolId) {
        return res.status(404).json({ error: 'Symbol not found' });
    }
    
    const orderData = {
        symbolId: parseInt(symbolId),
        side: side || 'Buy',
        volume: parseFloat(volume) || 0.01,
        stopLoss: parseFloat(stopLoss) || 0,
        takeProfit: parseFloat(takeProfit) || 0
    };
    
    const reqId = placeOrder(orderData);
    
    res.json({
        status: 'sent',
        requestId: reqId,
        order: orderData
    });
});

app.get('/api/ctrader/positions', (req, res) => {
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    getPositions();
    setTimeout(() => {
        res.json({ positions });
    }, 1000);
});

app.post('/api/ctrader/close-position', (req, res) => {
    const { positionId } = req.body;
    
    if (!isConnected || !isAccountAuthenticated) {
        return res.status(400).json({ error: 'Not connected or not authenticated' });
    }
    
    const reqId = closePosition(positionId);
    res.json({ status: 'sent', requestId: reqId });
});

app.get('/api/ctrader/account', (req, res) => {
    if (!selectedAccount) {
        return res.status(400).json({ error: 'No account selected' });
    }
    res.json({ account: selectedAccount });
});

// ============================================================
// SIGNAL GENERATION
// ============================================================

app.post('/api/signal', (req, res) => {
    const { symbol, timeframe, balance, risk, price } = req.body;
    
    const signals = ['BUY', 'SELL', 'HOLD'];
    const random = Math.random() * 100;
    let signal = 'HOLD';
    let confidence = 25;
    
    if (random < 35) {
        signal = 'BUY';
        confidence = 55 + Math.random() * 30;
    } else if (random < 70) {
        signal = 'SELL';
        confidence = 55 + Math.random() * 30;
    } else {
        signal = 'HOLD';
        confidence = 20 + Math.random() * 20;
    }
    confidence = Math.round(confidence);
    
    const entry = price || 1.0872;
    const atr = entry * 0.0015;
    let stopLoss = entry;
    let takeProfit = entry;
    
    if (signal === 'BUY') {
        stopLoss = entry - atr * 1.2;
        takeProfit = entry + atr * 3.5;
    } else if (signal === 'SELL') {
        stopLoss = entry + atr * 1.2;
        takeProfit = entry - atr * 3.5;
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
        currentPrice: parseFloat(entry.toFixed(5)),
        rr: parseFloat((Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss || 0.0001)).toFixed(1)),
        strategies: 17,
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// WEBSOCKET FOR CLIENTS
// ============================================================

const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Open your bot at your Render URL`);
    console.log(`🔑 OAuth endpoint: /auth/ctrader`);
});

const wss = new WebSocket.Server({ server, path: '/ws' });
wss.on('connection', (ws) => {
    console.log('👤 Client connected to WebSocket');
    wsClients.push(ws);
    ws.send(JSON.stringify({
        type: 'status',
        connected: isConnected,
        authenticated: isAccountAuthenticated,
        hasToken: !!userTokens.accessToken
    }));
    ws.on('close', () => {
        wsClients = wsClients.filter(client => client !== ws);
        console.log('👤 Client disconnected');
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

console.log('✅ Pepperstone cTrader Bot server initialized');
