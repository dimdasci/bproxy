import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const TOKEN = 'test-token-deadbeef';
const PORT = 9090;

const app = Fastify({ logger: true });

await app.register(websocket, {
  options: {
    handleProtocols: (protocols) => {
      const list = Array.from(protocols);
      const v1 = list.includes('bproxy.v1');
      const auth = list.find((p) => p.startsWith('auth.'));
      if (!v1 || !auth) return false;
      const provided = Buffer.from(auth.slice('auth.'.length), 'base64url').toString();
      if (provided !== TOKEN) return false;
      return 'bproxy.v1';
    },
  },
});

app.get('/ws', { websocket: true }, (socket) => {
  app.log.info({ event: 'ws_connect' });
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    app.log.info({ event: 'received', id: msg.id, action: msg.action });
    socket.send(JSON.stringify({
      protocol_version: 1,
      id: msg.id,
      ok: true,
      data: { echoed: msg.action },
    }));
  });
  socket.on('close', () => app.log.info({ event: 'ws_close' }));
});

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`Listening on ws://127.0.0.1:${PORT}/ws (token: ${TOKEN})`);
