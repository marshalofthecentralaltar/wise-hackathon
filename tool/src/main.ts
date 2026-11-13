// The tool: listens in #support, groups reports, and runs steps 3 to 10 once for each group
// that reaches the threshold, one group at a time. Also handles the "Approve fix" button.
// The wiring is startTool() in startTool.ts, so a script can start the same tool in-process.
// Run from tool/: npm run tool
import { StartError, startTool } from './startTool.js';

async function main(): Promise<number> {
  try {
    await startTool();
  } catch (err) {
    if (err instanceof StartError) {
      console.error(err.message);
      return err.exitCode;
    }
    throw err;
  }
  return new Promise<number>(() => undefined);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
