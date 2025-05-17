import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';

const port = 6005; //note: 6000 is illegal

// Create a basic HTTP server to verify port reachability
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running\n');
});

const server = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  console.log('Upgrade from', request.socket.remoteAddress, request.url);
  server.handleUpgrade(request, socket, head, ws => {
    server.emit('connection', ws, request);
  });
});

server.on('connection', (socket) => {
  console.log('Client connected');
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  const sendTime = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(new Date().toLocaleTimeString());
    }
  };

  const interval = setInterval(sendTime, 1000);

  socket.on('close', () => {
    clearInterval(interval);
    console.log('Client disconnected');
  });
});

server.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

const interval = setInterval(() => {
  server.clients.forEach((socket) => {
    if (!socket.isAlive) return socket.terminate();
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

httpServer.listen(port, () => {
  console.log(`HTTP/WebSocket server running on http://localhost:${port}`);
});
