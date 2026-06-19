import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', async () => {
  console.log('Connected to WS');
  ws.send(JSON.stringify({ type: 'subscribe', topic: 'commentList:1' }));
  console.log('Subscribed to commentList:1');

  // Trigger comment creation
  setTimeout(async () => {
    console.log('Sending POST request...');
    const res = await fetch('http://localhost:3001/api/comments/1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IlRlc3RBZG1pbiIsImlzX2FkbWluIjp0cnVlLCJpc19jb250cmlidXRvciI6ZmFsc2UsImlhdCI6MTc4MDM1MzY5OSwiZXhwIjoxNzgwNDQwMDk5fQ.SHrfHJ6l-z6H5nS00oOVS3AmPF8V1zjrAe6F_Yw24Ag'
      },
      body: JSON.stringify({
        body: 'This is a test comment for real-time websocket!',
        target_placement: 'some_placement'
      })
    });
    console.log('POST status:', res.status);
    const data = await res.json();
    console.log('POST body:', data);
  }, 1000);
});

ws.on('message', (data) => {
  console.log('Received WS message:', JSON.parse(data.toString()));
  setTimeout(() => process.exit(0), 1000); // Exit after receiving message
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});
