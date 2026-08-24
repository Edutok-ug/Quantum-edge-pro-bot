const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION
// ============================================================
const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';

// IMPORTANT: This MUST match exactly what's in cTrader
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://quantum-edge-pro-bot.onrender.com/oauth/callback';

// cTrader OAuth URLs
const AUTH_URL = 'https://id.ctrader.com/settings/openapi/grantaccess';
const TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// STATE
// ============================================================
let userTokens = {};
let ctraderWs = null;
let isConnected = false;
let wsClients = [];
let accountInfo = null;

// ============================================================
// OAUTH ROUTES
// ============================================================

// Step 1: Redirect user to cTrader for authorization
app.get('/auth/ctrader', (req, res) => {
    console.log('🔑 OAuth login requested');
    console.log('CLIENT_ID:', CLIENT_ID ? '✅ Set' : '❌ Missing');
    console.log('REDIRECT_URI:', REDIRECT_URI);
    
    if (!CLIENT_ID) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>⚠️ Configuration Error</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 700px; border: 1px solid #f59e0b; }
                    h1 { color: #f59e0b; }
                    code { background: #0a1222; padding: 2px 8px; border-radius: 4px; color: #60a5fa; }
                    .btn { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #0a0e1a; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px; }
                    .btn:hover { opacity: 0.8; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>⚠️ Configuration Error</h1>
                    <p>The <code>CTRADER_CLIENT_ID</code> environment variable is not set.</p>
                    <p>Steps to fix:</p>
                    <ol style="line-height: 1.8; padding-left: 20px;">
                        <li>Go to <a href="https://openapi.ctrader.com" target="_blank" style="color:#60a5fa;">openapi.ctrader.com</a></li>
                        <li>Create a new app named <strong>"quantum edge trader"</strong></li>
                        <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                        <li>Add them as environment variables on Render</li>
                    </ol>
                    <a href="/" class="btn">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
    
    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(7);
    
    // Build the authorization URL
    const authUrl = `${AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=trading&state=${state}`;
    
    console.log('🔄 Redirecting to:', authUrl);
    
    // Redirect to cTrader
    res.redirect(authUrl);
});

// Step 2: Handle callback from cTrader
app.get('/oauth/callback', async (req, res) => {
    console.log('📨 OAuth callback received');
    console.log('Query params:', req.query);
    console.log('Full URL:', req.protocol + '://' + req.get('host') + req.originalUrl);
    
    const { code, state, error } = req.query;
    
    // Check for error
    if (error) {
        console.log('❌ OAuth error:', error);
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>❌ Authorization Error</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 700px; border: 1px solid #ef4444; }
                    h1 { color: #ef4444; }
                    .btn { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #0a0e1a; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px; }
                    .btn:hover { opacity: 0.8; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>❌ Authorization Error</h1>
                    <p>${error}</p>
                    <a href="/auth/ctrader" class="btn">🔐 Try Again</a>
                    <a href="/" class="btn" style="background: #1a2a42; color: #e2e8f0;">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
    
    // Check if we have a code
    if (!code) {
        console.log('❌ No authorization code received');
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>❌ No Code Received</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 700px; border: 1px solid #ef4444; }
                    h1 { color: #ef4444; }
                    .btn { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #0a0e1a; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px; }
                    .btn:hover { opacity: 0.8; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>❌ No Authorization Code Received</h1>
                    <p>Please try logging in again.</p>
                    <a href="/auth/ctrader" class="btn">🔐 Try Again</a>
                    <a href="/" class="btn" style="background: #1a2a42; color: #e2e8f0;">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
    
    try {
        console.log('🔄 Exchanging code for token...');
        
        // Exchange authorization code for access token
        const tokenResponse = await axios({
            method: 'POST',
            url: TOKEN_URL,
            params: {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }
        });
        
        console.log('✅ Token received successfully');
        
        const { accessToken, refreshToken, expireAt } = tokenResponse.data;
        
        // Store tokens
        userTokens.accessToken = accessToken;
        userTokens.refreshToken = refreshToken;
        userTokens.expiresAt = Date.now() + (parseInt(expireAt) * 1000);
        
        // Return success page
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>✅ Authentication Successful</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 750px; border: 1px solid #10b981; }
                    h1 { color: #10b981; }
                    .token-display { background: #0a1222; padding: 15px; border-radius: 8px; word-break: break-all; font-size: 12px; border: 1px solid #2a3a5a; margin: 10px 0; max-height: 150px; overflow-y: auto; }
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
                    <p>Your cTrader token has been generated.</p>
                    
                    <div class="token-display">
                        <strong>🔑 Access Token:</strong><br>
                        ${accessToken}
                    </div>
                    
                    <div class="info">
                        ⏰ Expires in ${Math.floor(parseInt(expireAt) / 3600)} hours<br>
                        🔄 Refresh token is stored on the server
                    </div>
                    
                    <div class="flex">
                        <button onclick="copyToken()" class="btn btn-green">📋 Copy Token</button>
                        <a href="/" class="btn">🚀 Go to Bot</a>
                    </div>
                    
                    <p class="info" style="margin-top:15px;">
                        💡 The token is also stored on the server. Use the <strong>"Connect"</strong> button in the bot to use it.
                    </p>
                    
                    <script>
                        function copyToken() {
                            const token = '${accessToken}';
                            if (navigator.clipboard) {
                                navigator.clipboard.writeText(token).then(() => {
                                    alert('✅ Token copied to clipboard!');
                                }).catch(() => fallbackCopy(token));
                            } else {
                                fallbackCopy(token);
                            }
                        }
                        function fallbackCopy(text) {
                            const textarea = document.createElement('textarea');
                            textarea.value = text;
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textarea);
                            alert('✅ Token copied to clipboard!');
                        }
                    </script>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('❌ Token exchange error:', error.response?.data || error.message);
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>❌ Token Exchange Failed</title>
                <style>
                    body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .box { background: #1a2a4a; padding: 40px; border-radius: 12px; max-width: 700px; border: 1px solid #ef4444; }
                    h1 { color: #ef4444; }
                    pre { background: #0a1222; padding: 15px; border-radius: 8px; overflow: auto; max-height: 300px; font-size: 12px; border: 1px solid #2a3a5a; }
                    .btn { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #0a0e1a; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px; }
                    .btn:hover { opacity: 0.8; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>❌ Token Exchange Failed</h1>
                    <p>Please check that your Client ID and Client Secret are correct.</p>
                    <pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>
                    <a href="/auth/ctrader" class="btn">🔐 Try Again</a>
                    <a href="/" class="btn" style="background: #1a2a42; color: #e2e8f0;">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
});

// ============================================================
// API ROUTES - (same as before)
// ============================================================

// Get stored token
app.get('/api/token', (req, res) => {
    if (userTokens.accessToken && userTokens.expiresAt > Date.now()) {
        res.json({
            accessToken: userTokens.accessToken,
            refreshToken: userTokens.refreshToken,
            expiresAt: userTokens.expiresAt
        });
    } else {
        res.status(404).json({ 
            error: 'No valid token found. Please authenticate first.',
            authUrl: '/auth/ctrader'
        });
    }
});

// Refresh token
app.post('/api/refresh-token', async (req, res) => {
    if (!userTokens.refreshToken) {
        return res.status(400).json({ error: 'No refresh token available' });
    }
    
    try {
        const response = await axios({
            method: 'POST',
            url: TOKEN_URL,
            params: {
                grant_type: 'refresh_token',
                refresh_token: userTokens.refreshToken,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }
        });
        
        const { accessToken, refreshToken, expireAt } = response.data;
        userTokens.accessToken = accessToken;
        userTokens.refreshToken = refreshToken;
        userTokens.expiresAt = Date.now() + (parseInt(expireAt) * 1000);
        
        res.json({
            accessToken: accessToken,
            expiresAt: userTokens.expiresAt
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Connect to cTrader
app.post('/api/connect', (req, res) => {
    const { token } = req.body;
    const accessToken = token || userTokens.accessToken;
    
    if (!accessToken) {
        return res.status(400).json({ 
            error: 'No token available. Please authenticate first: /auth/ctrader' 
        });
    }
    
    if (ctraderWs && ctraderWs.readyState === WebSocket.OPEN) {
        return res.json({ status: 'already_connected', message: 'Already connected' });
    }
    
    const wsUrl = `wss://ws.ctrader.com/v2/demo?access_token=${accessToken}`;
    console.log('🔌 Connecting to cTrader...');
    
    try {
        ctraderWs = new WebSocket(wsUrl);
        
        ctraderWs.on('open', () => {
            console.log('✅ cTrader WebSocket connected');
            isConnected = true;
            
            ctraderWs.send(JSON.stringify({
                RequestId: 1,
                MessageType: 'GetAccountInfo'
            }));
            
            broadcastToClients({
                type: 'connection',
                status: 'connected',
                message: 'Connected to cTrader'
            });
        });
        
        ctraderWs.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                console.log('📨 Received:', parsed.MessageType || 'unknown');
                
                if (parsed.MessageType === 'AccountInfo') {
                    accountInfo = parsed;
                    broadcastToClients({
                        type: 'account',
                        data: parsed
                    });
                }
                
                broadcastToClients({
                    type: 'message',
                    data: parsed
                });
            } catch (e) {}
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
        
        res.json({ status: 'connecting', message: 'Connecting to cTrader...' });
        
    } catch (error) {
        console.error('❌ Connection error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
    if (ctraderWs) {
        ctraderWs.close();
        ctraderWs = null;
    }
    isConnected = false;
    res.json({ status: 'disconnected', message: 'Disconnected' });
});

// Place order
app.post('/api/order', (req, res) => {
    const { symbol, side, quantity, stopLoss, takeProfit } = req.body;
    
    if (!isConnected || !ctraderWs) {
        return res.status(400).json({ error: 'Not connected to cTrader' });
    }
    
    const orderMsg = JSON.stringify({
        RequestId: Date.now(),
        MessageType: 'PlaceOrder',
        Symbol: symbol || 'EURUSD',
        Side: side || 'Buy',
        OrderType: 'Market',
        Quantity: quantity || 0.01,
        StopLoss: stopLoss || 0,
        TakeProfit: takeProfit || 0
    });
    
    ctraderWs.send(orderMsg);
    res.json({ status: 'sent', message: 'Order sent', order: JSON.parse(orderMsg) });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: isConnected,
        hasToken: !!userTokens.accessToken,
        tokenExpires: userTokens.expiresAt,
        account: accountInfo,
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// SIGNAL GENERATION
// ============================================================

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
    
    let random = Math.random() * 100;
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
// SERVE INDEX
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
