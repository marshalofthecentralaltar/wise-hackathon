// The one place that knows where things are on this machine.
//
// The build folder holds the repository checkout, secrets.env and the card app's deployment
// checkout (demo-bank-card-app-deploy, cloned there by the watcher). It is WISE_BUILD_DIR when
// set, otherwise the folder above the repository checkout, found from this module's location
// (tool/src/paths.ts, so three folders up). Each derived path has its own override variable.
// Every path is returned with forward slashes.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Paths {
  /** The folder that holds the checkout, secrets.env and the deployment checkout. */
  buildDir: string;
  /** The repository checkout (the folder that holds tool/). */
  repoDir: string;
  /** tool/ inside the checkout. */
  toolDir: string;
  /** The secrets file. WISE_SECRETS_FILE overrides. */
  secretsFile: string;
  /** The card app's deployment checkout. CARD_APP_DEPLOY_DIR overrides. */
  deployDir: string;
  /** The card app's request log, inside the deployment checkout. REQUEST_LOG_FILE overrides. */
  requestLogFile: string;
  /** The browser checks folder, tool/checks. */
  checksDir: string;
  /** The flicker browser check. CHECK_FLICKER overrides. */
  checkFlicker: string;
}

const slashes = (p: string): string => p.replace(/\\/g, '/');
const setting = (env: NodeJS.ProcessEnv, name: string): string => (env[name] ?? '').trim();

/**
 * Resolves every path from the environment and the location of tool/src/paths.ts.
 * Pure apart from reading its arguments: tests pass both in.
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env, moduleUrl: string = import.meta.url): Paths {
  const srcDir = dirname(fileURLToPath(moduleUrl));
  const toolDir = resolve(srcDir, '..');
  const repoDir = resolve(toolDir, '..');
  const buildDir = setting(env, 'WISE_BUILD_DIR') ? resolve(setting(env, 'WISE_BUILD_DIR')) : resolve(repoDir, '..');
  const deployDir = setting(env, 'CARD_APP_DEPLOY_DIR') || resolve(buildDir, 'demo-bank-card-app-deploy');
  const checksDir = resolve(toolDir, 'checks');
  return {
    buildDir: slashes(buildDir),
    repoDir: slashes(repoDir),
    toolDir: slashes(toolDir),
    secretsFile: slashes(setting(env, 'WISE_SECRETS_FILE') || resolve(buildDir, 'secrets.env')),
    deployDir: slashes(deployDir),
    requestLogFile: slashes(setting(env, 'REQUEST_LOG_FILE') || resolve(deployDir, 'logs', 'requests.log')),
    checksDir: slashes(checksDir),
    checkFlicker: slashes(setting(env, 'CHECK_FLICKER') || resolve(checksDir, 'check-flicker.mjs')),
  };
}

/** The paths for this process, resolved once at start. */
export const paths: Paths = resolvePaths();
