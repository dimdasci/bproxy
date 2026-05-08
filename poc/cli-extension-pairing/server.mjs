import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

const PORT = 9091;
const VALID_CODE = 'ABCD-EFGH';

const app = Fastify({ logger: true });

app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') reply.code(204).send();
});

app.post('/pair/claim', async (request, reply) => {
  const { code } = request.body ?? {};
  if (!code || typeof code !== 'string') {
    return reply.code(400).send({ ok: false, error: { code: 'PAIRING_CODE_INVALID' } });
  }
  if (code !== VALID_CODE) {
    return reply.code(400).send({ ok: false, error: { code: 'PAIRING_CODE_INVALID' } });
  }
  return {
    ok: true,
    data: {
      extensionToken: 'mock-extension-token-' + randomUUID(),
      wsUrl: 'ws://127.0.0.1:9090/ws',
      protocolVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      nonce: randomUUID(),
    },
  };
});

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`Mock daemon listening on http://127.0.0.1:${PORT} (valid code: ${VALID_CODE})`);
