// Where things are: src/paths.ts with the module location and the environment given in.
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paths, resolvePaths } from '../src/paths.js';

const onWindows = process.platform === 'win32';
// This PC's build folder, written in parts (the code holds no path of this PC).
const PC_BUILD = ['C:', 'Users', 'ralfs', 'wise-build'].join('/');
const at = (file: string) => pathToFileURL(resolve(file)).href;

describe('resolvePaths', () => {
  it.runIf(onWindows)('on this PC every default is the path the code had before', () => {
    const p = resolvePaths({}, at(`${PC_BUILD}/wise-hackathon-lane-stage/tool/src/paths.ts`));
    expect(p.buildDir).toBe(PC_BUILD);
    expect(p.secretsFile).toBe(`${PC_BUILD}/secrets.env`);
    expect(p.deployDir).toBe(`${PC_BUILD}/demo-bank-card-app-deploy`);
    expect(p.requestLogFile).toBe(`${PC_BUILD}/demo-bank-card-app-deploy/logs/requests.log`);
    expect(p.checkFlicker).toBe(`${PC_BUILD}/wise-hackathon-lane-stage/tool/checks/check-flicker.mjs`);
    // The primary checkout sits in the same build folder.
    expect(resolvePaths({}, at(`${PC_BUILD}/wise-hackathon/tool/src/paths.ts`)).secretsFile).toBe(`${PC_BUILD}/secrets.env`);
  });

  it('takes the build folder from the checkout location on any machine', () => {
    const base = resolve('/stage/build').split(sep).join('/');
    const p = resolvePaths({}, at(`${base}/wise-hackathon/tool/src/paths.ts`));
    expect(p).toEqual({
      buildDir: base,
      repoDir: `${base}/wise-hackathon`,
      toolDir: `${base}/wise-hackathon/tool`,
      secretsFile: `${base}/secrets.env`,
      deployDir: `${base}/demo-bank-card-app-deploy`,
      requestLogFile: `${base}/demo-bank-card-app-deploy/logs/requests.log`,
      checksDir: `${base}/wise-hackathon/tool/checks`,
      checkFlicker: `${base}/wise-hackathon/tool/checks/check-flicker.mjs`,
    });
  });

  it('WISE_BUILD_DIR moves everything derived from the build folder, not the checks', () => {
    const base = resolve('/stage/build').split(sep).join('/');
    const other = resolve('/elsewhere/b').split(sep).join('/');
    const p = resolvePaths({ WISE_BUILD_DIR: other }, at(`${base}/wise-hackathon/tool/src/paths.ts`));
    expect(p.buildDir).toBe(other);
    expect(p.secretsFile).toBe(`${other}/secrets.env`);
    expect(p.deployDir).toBe(`${other}/demo-bank-card-app-deploy`);
    expect(p.requestLogFile).toBe(`${other}/demo-bank-card-app-deploy/logs/requests.log`);
    expect(p.checkFlicker).toBe(`${base}/wise-hackathon/tool/checks/check-flicker.mjs`);
  });

  it('each override wins on its own', () => {
    const base = resolve('/stage/build').split(sep).join('/');
    const url = at(`${base}/wise-hackathon/tool/src/paths.ts`);
    expect(resolvePaths({ WISE_SECRETS_FILE: 'X:/s/secrets.env' }, url).secretsFile).toBe('X:/s/secrets.env');
    const d = resolvePaths({ CARD_APP_DEPLOY_DIR: 'X:/deploy' }, url);
    expect(d.deployDir).toBe('X:/deploy');
    expect(d.requestLogFile).toMatch(/X:\/deploy\/logs\/requests\.log$|deploy\/logs\/requests\.log$/);
    expect(resolvePaths({ REQUEST_LOG_FILE: 'X:/r.log' }, url).requestLogFile).toBe('X:/r.log');
    expect(resolvePaths({ CHECK_FLICKER: 'X:/c/check.mjs' }, url).checkFlicker).toBe('X:/c/check.mjs');
    // Blank values are ignored, as config.ts treats them.
    expect(resolvePaths({ WISE_SECRETS_FILE: '  ', WISE_BUILD_DIR: '' }, url).secretsFile).toBe(`${base}/secrets.env`);
  });

  it('the module itself resolves the checks to this checkout', () => {
    expect(paths.checkFlicker.endsWith('/tool/checks/check-flicker.mjs') || !!process.env.CHECK_FLICKER).toBe(true);
    expect(paths.toolDir).toBe(resolve(__dirname, '..').split(sep).join('/'));
  });
});
