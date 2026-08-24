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
// CONFIGURATION - WITH DEBUG LOGGING
// ============================================================
const CLIENT_ID = process.env.CTRADER_CLIENT_ID;
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET;
const REDIRECT_URI = process.env.CTRADER_REDIRECT_URI || 'https://quantum-edge-pro-bot.onrender.com/oauth/callback';

// DEBUG: Log what we have (without exposing full secrets)
console.log('🔍 Configuration Check:');
console.log('CLIENT_ID:', CLIENT_ID ? '✅ SET (length: ' + CLIENT_ID.length + ')' : '❌ MISSING');
console.log('CLIENT_SECRET:', CLIENT_SECRET ? '✅ SET (length: ' + CLIENT_SECRET.length + ')' : '❌ MISSING');
console.log('REDIRECT_URI:', REDIRECT_URI);

// cTrader Open API endpoints
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
let accountInfo = null;
let tradingAccounts = [];
let selectedAccount = null;
let symbols = {};
let prices = {};
let positions = [];
let pendingRequests = {};
let requestId = 1000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// OAUTH ROUTES
// ============================================================

// Step 1: Start OAuth flow
app.get('/auth/ctrader', (req, res) => {
    console.log('🔑 OAuth login requested');
    
    if (!CLIENT_ID) {
        return res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Configuration Error</title>
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
                        <li>Find your application</li>
                        <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                        <li>Add them as environment variables on Render</li>
                    </ol>
                    <a href="/" class="btn">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
    
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `${AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=trading&product=web&state=${state}`;
    
    console.log('🔄 Redirecting to:', authUrl);
    res.redirect(authUrl);
});

// Step 2: Handle OAuth callback - WITH BETTER DEBUGGING
app.get('/oauth/callback', async (req, res) => {
    console.log('📨 OAuth callback received');
    console.log('Query params:', req.query);
    
    const { code, state, error } = req.query;
    
    if (error) {
        console.log('❌ OAuth error:', error);
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Error</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <h1 style="color:#ef4444;">❌ Authorization Error</h1>
                <p>${error}</p>
                <a href="/" style="color:#f59e0b;">← Back to Bot</a>
            </body>
            </html>
        `);
    }
    
    if (!code) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>No Code Received</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <h1 style="color:#ef4444;">❌ No Authorization Code Received</h1>
                <a href="/auth/ctrader" class="btn" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:10px;">🔐 Try Again</a>
                <a href="/" style="color:#f59e0b;display:block;margin-top:10px;">← Back to Bot</a>
            </body>
            </html>
        `);
    }
    
    try {
        console.log('🔄 Exchanging code for token...');
        
        // DEBUG: Check if credentials are available
        if (!CLIENT_ID) {
            throw new Error('CLIENT_ID is not set in environment variables');
        }
        if (!CLIENT_SECRET) {
            throw new Error('CLIENT_SECRET is not set in environment variables');
        }
        
        console.log('✅ Client ID available (length: ' + CLIENT_ID.length + ')');
        console.log('✅ Client Secret available (length: ' + CLIENT_SECRET.length + ')');
        console.log('✅ Redirect URI:', REDIRECT_URI);
        
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
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        console.log('✅ Token response received');
        console.log('Response data:', JSON.stringify(tokenResponse.data, null, 2));
        
        const responseData = tokenResponse.data;
        
        // Check for error in response
        if (responseData.errorCode) {
            throw new Error(responseData.description || responseData.errorCode);
        }
        
        // Parse token response - cTrader uses different key names
        const accessToken = responseData.accessToken || responseData.access_token || responseData.token || null;
        const refreshToken = responseData.refreshToken || responseData.refresh_token || null;
        const expireAt = responseData.expireAt || responseData.expires_in || responseData.expiresIn || 3600;
        
        if (!accessToken) {
            console.error('❌ No access token found in response:', responseData);
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Token Error</title></head>
                <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                    <h1 style="color:#ef4444;">❌ No Access Token Received</h1>
                    <p>Response from cTrader:</p>
                    <pre style="background:#0a1222;padding:15px;border-radius:8px;overflow:auto;max-height:300px;">${JSON.stringify(responseData, null, 2)}</pre>
                    <a href="/auth/ctrader" style="color:#f59e0b;">🔐 Try Again</a>
                    <br><a href="/" style="color:#f59e0b;">← Back to Bot</a>
                </body>
                </html>
            `);
        }
        
        // Store tokens
        userTokens.accessToken = accessToken;
        userTokens.refreshToken = refreshToken || null;
        userTokens.expiresAt = Date.now() + (parseInt(expireAt) * 1000);
        
        console.log('✅ Token stored successfully');
        console.log('Access Token:', accessToken.substring(0, 20) + '...');
        
        // Success page with the token
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
                    .account-info { background: #0a1222; padding: 12px; border-radius: 8px; margin: 10px 0; border: 1px solid #2a3a5a; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>✅ Authentication Successful!</h1>
                    <p>Your Pepperstone cTrader token has been generated.</p>
                    
                    <div class="account-info">
                        <strong>📊 Account:</strong> Pepperstone • Demo • 5322914<br>
                        <strong>💰 Balance:</strong> 10,752.27 EUR<br>
                        <strong>⚡ Leverage:</strong> 1:400
                    </div>
                    
                    <div class="token-display" id="tokenDisplay">
                        <strong>🔑 Access Token:</strong><br>
                        ${accessToken}
                    </div>
                    
                    <div class="info">
                        ⏰ Expires in ${Math.floor(parseInt(expireAt) / 3600)} hours (${Math.floor(parseInt(expireAt) / 86400)} days)<br>
                        🔄 Refresh token stored on server
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
        
        // Determine if this is a configuration error
        const isConfigError = error.message.includes('CLIENT_ID') || error.message.includes('CLIENT_SECRET');
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>${isConfigError ? '⚠️ Configuration Error' : '❌ Token Exchange Failed'}</title></head>
            <body style="background:#0a0e1a;color:#e2e8f0;font-family:sans-serif;padding:40px;">
                <div style="max-width:700px;margin:0 auto;">
                    <h1 style="color:${isConfigError ? '#f59e0b' : '#ef4444'};">${isConfigError ? '⚠️ ' : '❌ '}${isConfigError ? 'Configuration Error' : 'Token Exchange Failed'}</h1>
                    
                    ${isConfigError ? `
                        <div style="background:#1a2a4a;padding:20px;border-radius:8px;margin:15px 0;border:1px solid #f59e0b;">
                            <h3 style="color:#f59e0b;">Missing Environment Variables</h3>
                            <p>Please add the following environment variables on Render:</p>
                            <ul style="line-height:2;">
                                <li><code style="background:#0a1222;padding:2px 8px;border-radius:4px;color:#60a5fa;">CTRADER_CLIENT_ID</code> - Your Client ID</li>
                                <li><code style="background:#0a1222;padding:2px 8px;border-radius:4px;color:#60a5fa;">CTRADER_CLIENT_SECRET</code> - Your Client Secret</li>
                            </ul>
                            <p>Then <strong>redeploy</strong> your application.</p>
                        </div>
                    ` : `
                        <p>Error: ${error.message}</p>
                        <pre style="background:#0a1222;padding:15px;border-radius:8px;overflow:auto;max-height:300px;">${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>
                    `}
                    
                    <a href="/auth/ctrader" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:10px;">🔐 Try Again</a>
                    <br><a href="/" style="color:#f59e0b;display:block;margin-top:10px;">← Back to Bot</a>
                </div>
            </body>
            </html>
        `);
    }
});

// ============================================================
// REST OF THE SERVER CODE (same as before)
// ============================================================

// [The rest of your server.js code goes here - keep everything else the same]

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

// ============================================================
// SERVE INDEX
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

console.log('✅ Pepperstone cTrader Bot server initialized');
