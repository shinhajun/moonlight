import { createGateway } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig({ log: (s) => console.log(`${new Date().toISOString()} ${s}`) });
const gw = createGateway(config);
const addr = await gw.listen();
config.log(`moonlight gateway listening on http://${addr.address}:${addr.port}`);

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    config.log(`${sig}: shutting down`);
    await gw.close();
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => config.log(`uncaught: ${err.stack || err}`));
process.on('unhandledRejection', (err) => config.log(`unhandled rejection: ${err?.stack || err}`));
