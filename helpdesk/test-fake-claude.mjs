// A stand-in for the `claude` command line, for test.mjs only. Reads the prompt on stdin and
// answers in the shape `claude -p --output-format json` gives. Plain Node, so it runs the same
// on Windows, macOS and Linux (set CLAUDE_BIN_PATH_FOR_TOOL to this file).
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  let answer;
  if (prompt.includes('Read the image file')) {
    // Says the visible name on purpose: the filter must take it out again.
    answer = { description: 'The card picture for Oliver Brandt is almost invisible in this frame.' };
  } else {
    const remove = prompt.includes('Kase Mari') ? [{ text: 'Kase Mari', kind: 'name' }] : [];
    answer = { remove, unsure: false, reason: '' };
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(answer) }));
});
