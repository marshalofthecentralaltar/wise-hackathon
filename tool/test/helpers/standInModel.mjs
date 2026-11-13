// A stand-in for `claude -p` in the fix step's tests. It runs in the copy (cwd) and acts by mode:
//   hang        never answers (and starts a grandchild that never ends either)
//   outside     edits a file outside the page's folder
//   empty       answers without changing anything
//   breaktests  edits the page so the tests fail
//   good        edits the page correctly
// It prints a result object like `--output-format json`.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const mode = process.argv[2];
const page = 'src/pages/card/Card.tsx';
const answer = (result) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, num_turns: 1 }));

if (mode === 'hang') {
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
} else if (mode === 'outside') {
  mkdirSync('src/shared', { recursive: true });
  writeFileSync('src/shared/util.ts', 'export const outside = true;\n');
  answer('changed src/shared/util.ts');
} else if (mode === 'empty') {
  answer('nothing to change');
} else if (mode === 'breaktests') {
  writeFileSync(page, readFileSync(page, 'utf8').replace('bad', 'BROKEN'));
  answer('changed the page');
} else if (mode === 'good') {
  writeFileSync(page, readFileSync(page, 'utf8').replace('bad', 'good'));
  answer('replaced bad with good in Card.tsx');
} else {
  process.exit(3);
}
