// ssh's ProxyCommand when the connection goes through the server's bridge.mjs: asks
// https://<host>/<token> to switch to `daumhost-ssh`, then passes stdin and stdout through, for
// networks that slow plain ssh to a crawl but leave HTTPS alone.
// node via.mjs https://<host>/<token>
import { request as http } from 'node:http';
import { request as https } from 'node:https';

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
const req = (url.protocol === 'http:' ? http : https)(url, { headers: { Connection: 'Upgrade', Upgrade: 'daumhost-ssh' } });
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
req.setTimeout(15000, () => req.destroy(new Error(`no answer from ${url.host}`)));
req.end();
