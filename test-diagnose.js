const http = require('http');

// Test 1: Login with password
const data1 = JSON.stringify({ email: 'student@pu.edu', password: 'SecureStudent123!' });
const req1 = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data1.length }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('=== TEST 1: Login ===');
    console.log('Status:', res.statusCode);
    console.log('Body:', body);
    
    if (res.statusCode === 200) {
      const parsed = JSON.parse(body);
      const token = parsed.token;
      console.log('\\n--- Token received ---');
      console.log('Token:', token.substring(0, 50) + '...');
      
      // Test 2: Chat ask with token
      const data2 = JSON.stringify({ message: 'Explain unit 1', history: [] });
      const req2 = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/chat/ask',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data2.length,
          'Authorization': 'Bearer ' + token
        }
      }, (res2) => {
        let body2 = '';
        res2.on('data', chunk => body2 += chunk);
        res2.on('end', () => {
          console.log('\n=== TEST 2: Chat ask with token ===');
          console.log('Status:', res2.statusCode);
          console.log('Body:', body2.substring(0, 600));
        });
      });
      req2.write(data2);
      req2.end();
      
      // Test 3: Public ask with token (should now work for university info)
      const data3 = JSON.stringify({ message: 'What is the application fee?', history: [] });
      const req3 = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/public/ask',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data3.length
        }
      }, (res3) => {
        let body3 = '';
        res3.on('data', chunk => body3 += chunk);
        res3.on('end', () => {
          console.log('\n=== TEST 3: Public ask (university info) ===');
          console.log('Status:', res3.statusCode);
          console.log('Body:', body3.substring(0, 600));
        });
      });
      req3.write(data3);
      req3.end();
      
    } else {
      console.log('\\nLogin failed - cannot test further');
    }
  });
});
req1.write(data1);
req1.end();