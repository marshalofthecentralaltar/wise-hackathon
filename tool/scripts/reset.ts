// npm run reset: removes the tool's pull requests and branches from the card app, clears the
// tool's report state, and moves the card app's main back to the planted commit when everything
// ahead of it is the tool's own work (see src/reset.ts). Prints what it did as JSON.
import { resetTool } from '../src/reset.js';

const result = await resetTool();
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.errors.length ? 1 : 0;
