// test-ws.js - Pure WebSocket connection test
// NO authentication, NO tokens, just raw WebSocket connection

const WebSocket = require('ws');

console.log('========================================');
console.log('🧪 cTrader WebSocket Connection Test');
console.log('========================================');
console.log('');

const WS_URL = 'wss://demo.ctraderapi.com:5036';

console.log(`📡 Connecting to: ${WS_URL}`);
console.log(`⏰ Time: ${new Date().toISOString()}`);
console.log('');

const ws = new WebSocket(WS_URL);

// Connection timeout
const timeout = setTimeout(() => {
    console.log('❌ CONNECTION TIMEOUT (10 seconds)');
    console.log('   The connection took too long to establish.');
    console.log('   This usually means:');
    console.log('   - Network blocking the port');
    console.log('   - DNS resolution failure');
    console.log('   - Firewall blocking outbound WebSocket');
    ws.close();
}, 10000);

ws.on('open', () => {
    clearTimeout(timeout);
    console.log('✅✅✅ cTrader WebSocket CONNECTED! ✅✅✅');
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('   The connection was successful!');
    console.log('');
    console.log('📊 Next steps:');
    console.log('   1. Now add application authentication');
    console.log('   2. Then add account authentication');
    console.log('   3. Then retrieve symbols and prices');
    console.log('');
    console.log('🔄 Keeping connection open for 10 seconds...');
    
    // Keep connection open to see if it stays connected
    setTimeout(() => {
        console.log('🔌 Closing connection (test complete)');
        ws.close();
    }, 10000);
});

ws.on('message', (data) => {
    console.log(`📩 Received message: ${data.toString().substring(0, 200)}`);
});

ws.on('error', (error) => {
    clearTimeout(timeout);
    console.log('❌❌❌ WEBSOCKET ERROR ❌❌❌');
    console.log(`   Error: ${error.message}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('');
    console.log('🔍 Possible causes:');
    console.log('   1. Port 5036 is blocked by Render');
    console.log('   2. Network firewall blocking outbound connections');
    console.log('   3. DNS resolution failure for demo.ctraderapi.com');
    console.log('   4. TLS/SSL handshake failure');
    console.log('');
    console.log('💡 Try these fixes:');
    console.log('   1. Check if port 5036 is allowed on Render');
    console.log('   2. Try using the IP address instead of domain');
    console.log('   3. Check Render network logs');
});

ws.on('close', (code, reason) => {
    clearTimeout(timeout);
    console.log(`🔴 WebSocket CLOSED`);
    console.log(`   Close code: ${code}`);
    console.log(`   Close reason: ${reason ? reason.toString() : 'No reason provided'}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    
    if (code === 1006) {
        console.log('');
        console.log('⚠️ Close code 1006 means abnormal closure');
        console.log('   This usually means the connection was lost');
        console.log('   or the server closed it unexpectedly.');
    }
});

console.log('⏳ Waiting for connection...');
console.log('   (timeout after 10 seconds)');
console.log('');
