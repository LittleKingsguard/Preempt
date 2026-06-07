const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/admin/users',
  method: 'GET',
  headers: {
    'Cookie': 'token=' + process.env.TOKEN
  }
};

const req = http.request(options, res => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', d => {
    process.stdout.write(d);
  });
});
req.on('error', error => {
  console.error(error);
});
req.end();
