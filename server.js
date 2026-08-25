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

console.log('🔍 Configuration:');
console.log('CLIENT_ID:', CLIENT_ID ? '✅ SET' : '❌ MISSING');
console.log('CLIENT_SECRET:', CLIENT_SECRET ? '✅ SET' : '❌ MISSING');

const AUTH_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

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

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// STEP 1: PURE WEBSOCKET CONNECTION TEST
// ============================================================

// New endpoint to test WebSocket connection without authentication
app.get('/api/test-ws', (req, res) => {
    console.log('🧪 WebSocket connection test requested');
    
    // This will be handled asynchronously
    res.json({
        status: 'testing',
        message: 'WebSocket connection test initiated. Check server logs.',
        endpoint: 'wss://demo.ctraderapi.com:5036'
    });
    
    // Run the test
    testWebSocketConnection();
});

function testWebSocketConnection() {
    console.log('========================================');
    console.log('🧪 cTrader WebSocket Connection Test');
    console.log('========================================');
    console.log('');
    
    const WS_URL = 'wss://demo.ctraderapi.com:5036';
    
    console.log(`📡 Connecting to: ${WS_URL}`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log('');
    
    const ws = new WebSocket(WS_URL);
    
    const timeout = setTimeout(() => {
        console.log('❌ CONNECTION TIMEOUT (10 seconds)');
        console.log('   The connection took too long to establish.');
        console.log('   This usually means:');
        console.log('   - Render is blocking port 5036');
        console.log('   - DNS resolution failure');
        console.log('   - Firewall blocking outbound WebSocket');
        ws.close();
    }, 10000);
    
    ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅✅✅ cTrader WebSocket CONNECTED! ✅✅✅');
        console.log(`   Time: ${new Date().toISOString()}`);
        console.log('');
        console.log('📊 The connection works!');
        console.log('   Now you can proceed with authentication.');
        console.log('');
        
        // Broadcast success to frontend
        broadcastToClients({
            type: 'ws_test',
            status: 'connected',
            message: 'WebSocket connection successful!'
        });
        
        // Keep connection open briefly
        setTimeout(() => {
            console.log('🔌 Closing test connection');
            ws.close();
        }, 5000);
    });
    
    ws.on('message', (data) => {
        console.log(`📩 Received: ${data.toString().substring(0, 200)}`);
    });
    
    ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('❌❌❌ WEBSOCKET ERROR ❌❌❌');
        console.log(`   Error: ${error.message}`);
        console.log(`   Time: ${new Date().toISOString()}`);
        console.log('');
        console.log('🔍 This is a CONNECTION error, not authentication.');
        console.log('   The problem is reaching the cTrader server.');
        console.log('');
        console.log('💡 Likely causes:');
        console.log('   1. Port 5036 is blocked by Render');
        console.log('   2. Render free tier blocks outbound WebSocket');
        console.log('   3. DNS resolution failure');
        console.log('');
        console.log('💡 Solutions:');
        console.log('   1. Upgrade Render instance (paid plans have fewer restrictions)');
        console.log('   2. Try a different hosting provider');
        console.log('   3. Use a proxy/relay service');
        
        broadcastToClients({
            type: 'ws_test',
            status: 'error',
            message: `Connection failed: ${error.message}`
        });
    });
    
    ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        console.log(`🔴 WebSocket CLOSED`);
        console.log(`   Close code: ${code}`);
        console.log(`   Close reason: ${reason ? reason.toString() : 'No reason'}`);
        console.log(`   Time: ${new Date().toISOString()}`);
        console.log('');
        
        if (code === 1006) {
            console.log('⚠️ Close code 1006 = abnormal closure');
            console.log('   The connection was lost or server closed it.');
            console.log('   This confirms a network/hosting issue.');
        }
    });
}

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
        console.log('🔄 Exchanging authorization code for access token...');
        
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
        console.log('✅ Token response received');
        
        const accessToken = responseData.accessToken || responseData.access_token || null;
        const refreshToken = responseData.refreshToken || responseData.refresh_token || null;
        const expireAt = responseData.expireAt || responseData.expires_in || 3600;
        
        if (!accessToken) {
            throw new Error('No access token received');
        }
        
        userTokens.accessToken = accessToken;
        userTokens.refreshToken = refreshToken;
        userTokens.expiresAt = Date.now() + (parseInt(expireAt) * 1000);
        
        console.log('✅ Access Token stored');
        
        // DON'T auto-connect yet - first test the connection!
        console.log('💡 Token received. Test connection first: /api/test-ws');
        
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
                    .test-section { background: #0a1222; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #f59e0b; }
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
                        🔄 Refresh token stored on server
                    </div>
                    
                    <div class="test-section">
                        <h3 style="color:#f59e0b;">🔌 Next Step: Test WebSocket Connection</h3>
                        <p style="font-size:0.85rem;">Before authenticating, test if Render can connect to cTrader:</p>
                        <a href="/api/test-ws" class="btn" style="background:#10b981;color:#0a0e1a;">🧪 Test WebSocket Connection</a>
                        <p style="font-size:0.7rem;color:#94a3b8;margin-top:8px;">Check the server logs for results.</p>
                    </div>
                    
                    <div class="flex">
                        <button onclick="copyToken()" class="btn btn-green">📋 Copy Token</button>
                        <a href="/" class="btn">🚀 Go to Bot</a>
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
// API ROUTES
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

// ============================================================
// WEBSOCKET FOR CLIENTS
// ============================================================

const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Open your bot at your Render URL`);
    console.log(`🔑 OAuth endpoint: /auth/ctrader`);
    console.log(`🧪 WebSocket test: /api/test-ws`);
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
console.log('');
console.log('📋 Test Plan:');
console.log('   1. Click /api/test-ws to test WebSocket connection');
console.log('   2. If connected, proceed with authentication');
console.log('   3. If not connected, check Render network settings');
console.log('');
