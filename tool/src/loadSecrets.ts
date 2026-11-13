// Loads the secrets file into process.env before an entry point runs. The npm scripts start it
// with `tsx --import ./src/loadSecrets.ts <entry>`, so no entry point holds a path of its own.
// A variable already set in the environment keeps its value. Nothing prints a value. When the
// file is missing, one line names the file looked for, and the entry point goes on to its own
// "empty token" message and exit, as before.
import { paths } from './paths.js';
import { loadSecretsInto, missingSecretsMessage } from './secrets.js';

const result = loadSecretsInto(process.env, paths.secretsFile);
if (!result.found) process.stderr.write(missingSecretsMessage(result.file) + '\n');
