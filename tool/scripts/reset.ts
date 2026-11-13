// npm run reset: removes the tool's pull requests and branches from the card app and clears the
// tool's report state. Prints what it did as JSON. Never touches main.
import { resetTool } from '../src/reset.js';

const result = await resetTool();
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.errors.length ? 1 : 0;
