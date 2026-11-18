#!/usr/bin/env node
// On the server: lets daumhost reach sshd over HTTPS, for networks that slow plain ssh to a crawl. A
// reverse proxy (Caddy) passes `GET /<token>` with `Upgrade: daumhost-ssh` here; after the 101 the
// connection is sshd's, byte for byte, and ssh's own keys and checks apply as ever. Any other request
// gets a 404, so the address shows a scanner nothing; the token keeps sshd's password prompt, which
// sees every bridged connection as coming from 127.0.0.1, out of reach of strangers.
// BRIDGE_TOKEN (required, 24 characters or more), BRIDGE_PORT (7720), SSH_PORT (22). Listens on
// 127.0.0.1 only. The device side is via.mjs.
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';

const token = process.env.BRIDGE_TOKEN ?? '';
if (token.length < 24) {
  console.error('BRIDGE_TOKEN: set it to a random string of 24 characters or more');
  process.exit(1);
}
const port = Number(process.env.BRIDGE_PORT ?? 7720);
const sshPort = Number(process.env.SSH_PORT ?? 22);
const want = Buffer.from(`/${token}`);
const allowed = (path) => {
  const got = Buffer.from(path ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
};

const server = createServer((req, res) => res.writeHead(404, { 'Content-Length': 0 }).end());
server.on('upgrade', (req, socket, head) => {
  const from = req.headers['x-forwarded-for'] ?? socket.remoteAddress;
  if (!allowed(req.url) || req.headers.upgrade?.toLowerCase() !== 'daumhost-ssh') {
    console.log(`refused ${from}: ${allowed(req.url) ? `Upgrade: ${req.headers.upgrade}` : 'wrong path'}`);
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    return;
  }
  const t0 = Date.now();
  let up = 0;
  let down = 0;
  console.log(`open ${from}`);
  socket.once('close', () => console.log(`closed ${from} after ${((Date.now() - t0) / 1000).toFixed(1)}s, ${up} bytes in, ${down} out`));
  const ssh = connect(sshPort, '127.0.0.1');
  const end = () => {
    socket.destroy();
    ssh.destroy();
  };
  ssh.on('error', end);
  socket.on('error', end);
  ssh.on('close', end);
  socket.on('close', end);
  ssh.once('connect', () => {
    socket.setNoDelay(true);
    ssh.setNoDelay(true);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: daumhost-ssh\r\n\r\n');
    if (head.length) ssh.write(head);
    ssh.on('data', (d) => (down += d.length));
    socket.on('data', (d) => (up += d.length));
    socket.pipe(ssh).pipe(socket);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`bridge: 127.0.0.1:${port} -> sshd on port ${sshPort}`));
