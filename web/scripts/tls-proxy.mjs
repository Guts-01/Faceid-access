import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';

const certificate = process.env.CATRACA_TLS_CERT;
const key = process.env.CATRACA_TLS_KEY;
if (!certificate || !key) throw new Error('Defina CATRACA_TLS_CERT e CATRACA_TLS_KEY.');
const port = Number(process.env.CATRACA_TLS_PORT || 3443);
const server = createServer({ cert: readFileSync(certificate), key: readFileSync(key) }, (incoming, outgoing) => {
  const upstream = httpRequest({ hostname: '127.0.0.1', port: 3000, method: incoming.method,
    path: incoming.url, headers: { ...incoming.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': incoming.headers.host } }, response => {
    outgoing.writeHead(response.statusCode || 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end('Painel indisponível'); });
  incoming.pipe(upstream);
});
server.listen(port, '0.0.0.0', () => console.log(`Proxy HTTPS ouvindo na porta ${port}, Mova o certificado CA da pasta "C: > user > AppData > Local > FaceidAccess"  para o seu Celular e configure conforme instruções do README.md`));
