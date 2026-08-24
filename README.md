# Quantum Edge Pro - Pepperstone cTrader Bot

AI-powered trading bot for Pepperstone cTrader DEMO accounts.

## Features

- 🔐 OAuth 2.0 authentication with cTrader
- 📊 Real-time market data via WebSocket
- 🧠 AI signal generation (17 strategies)
- 📈 Demo trading with SL/TP
- 📉 Position monitoring and management
- 🔄 Auto-refresh positions

## Deployment

1. Fork this repository
2. Add environment variables on Render
3. Deploy!

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CTRADER_CLIENT_ID` | Your cTrader Open API Client ID |
| `CTRADER_CLIENT_SECRET` | Your cTrader Open API Client Secret |
| `CTRADER_REDIRECT_URI` | OAuth callback URL |

## Tech Stack

- Node.js/Express
- cTrader Open API (WebSocket)
- Vanilla JS Frontend

## License

MIT
