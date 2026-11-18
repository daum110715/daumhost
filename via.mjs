// ssh's ProxyCommand when the connection goes through the server's bridge.mjs: asks
// https://<host>/<token> to switch to `daumhost-ssh`, then passes stdin and stdout through, for
// networks that slow plain ssh to a crawl but leave HTTPS alone.
// node via.mjs https://<host>/<token>
import { lookup } from 'node:dns/promises';
import { request as http } from 'node:http';
import { request as https } from 'node:https';
import { isIP } from 'node:net';

// DNS over HTTPS, asked of well-known servers by their IP
const DOH = ['https://223.5.5.5/resolve', 'https://1.1.1.1/dns-query'];
async function overHttps(name) {
  for (const base of DOH) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
      const ip = (await r.json()).Answer?.find((a) => a.type === 1)?.data;
      if (ip) return ip;
    } catch {}
  }
  throw new Error('no answer over HTTPS');
}
// The server's address: whichever answers first, the system's resolver or DNS over HTTPS. A proxy's
// resolver (Clash's, say) can take ten seconds to answer nothing for a name, which plain ssh to an IP
// never notices; and its fake-ip answers (198.18.0.0/15) send the connection through the proxy, so the
// real address is waited for a moment longer.
async function resolve(name) {
  if (isIP(name)) return name;
  const real = overHttps(name);
  const system = lookup(name, { family: 4 }).then((a) => a.address);
  const first = await Promise.any([system, real]);
  if (!/^198\.1[89]\./.test(first)) return first;
  return Promise.race([real, new Promise((r) => setTimeout(() => r(first), 1000))]).catch(() => first);
}

const fail = (why) => {
  process.stderr.write(`via: ${why}\n`);
  process.exit(1);
};
let url;
try {
  url = new URL(process.argv[2]);
} catch {
  fail('usage: node via.mjs https://<host>/<token>');
}
const secure = url.protocol !== 'http:';
const address = await resolve(url.hostname).catch(() => fail(`cannot find the address of ${url.hostname}`));
const req = (secure ? https : http)({
  host: address,
  port: url.port || (secure ? 443 : 80),
  path: url.pathname,
  servername: url.hostname,
  headers: { Host: url.host, Connection: 'Upgrade', Upgrade: 'daumhost-ssh' },
});
req.on('upgrade', (res, socket, head) => {
  // from here ssh keeps the connection alive, however long it stays quiet
  socket.setTimeout(0);
  socket.setNoDelay(true);
  if (head.length) process.stdout.write(head);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on('error', () => process.exit(1));
  socket.on('close', () => process.exit(0));
});
// the token or the address is wrong, or the bridge is not running
req.on('response', (res) => fail(`${url.host} answered ${res.statusCode}`));
req.on('error', (e) => fail(e.message));
req.setTimeout(20000, () => req.destroy(new Error(`no answer from ${url.host}`)));
req.end();
