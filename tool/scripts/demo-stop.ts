// npm run demo-stop
// Stops what `npm run demo-start` started: the tool (if it started one), the watcher (and with it
// the card app) and Prometheus; confirms ports 3000 and 9090 refuse connections; removes its pid
// file. Safe to run twice. Exit 1 only when a port still answers afterwards.
import { stopDemo } from './lib/demo.js';

const say = (line: string) => console.log(`[demo-stop] ${line}`);
const { ok } = await stopDemo(say);
say(ok ? 'everything is stopped' : 'something still answers; see the lines above');
process.exit(ok ? 0 : 1);
