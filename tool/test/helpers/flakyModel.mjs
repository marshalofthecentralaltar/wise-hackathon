// A stand-in for the claude CLI that can fail to start. node flakyModel.mjs <mode> <stateFile> [cli args ignored]
// Every start appends one line to stateFile, so a test counts the starts.
//   fail-once         first start: exit 1 at once with nothing on stdout; later starts: write changed.txt and answer
//   hang              never answers
//   error-after-work  answers with an error result on stdout and exits 1
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [mode, state] = process.argv.slice(2);
const starts = existsSync(state) ? readFileSync(state, 'utf8').split('\n').filter(Boolean).length : 0;
appendFileSync(state, `start ${starts + 1}\n`);
const answer = { customerEffect: 'appearance' };

if (mode === 'fail-once') {
  if (starts === 0) process.exit(1);
  writeFileSync('changed.txt', 'changed by the stand-in\n');
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(answer), structured_output: answer, num_turns: 1 }));
} else if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'error-after-work') {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'the model gave up', num_turns: 3 }));
  process.exit(1);
} else {
  process.exit(3);
}
