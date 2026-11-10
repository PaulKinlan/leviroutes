/*
 * Hermetic npm environment for the verify-package specs (leviroutes-grg4).
 *
 * tools/verify-package.mjs reads npm's own configuration surfaces - the npm_config_* env vars
 * and, when npm exports their paths, the user-level and global npmrc files. That is deliberate
 * (a real publish is affected by all of them), but it also means a spec that just calls
 * verifyPackage() would inherit whatever the machine running the suite happens to have: a
 * developer with `registry=<corporate mirror>` in ~/.npmrc, or a `npm test` invocation, where npm
 * exports npm_config_userconfig, would fail these fixtures for reasons that have nothing to do
 * with the code under test.
 *
 * Saving and clearing those variables around each spec keeps the verdict a function of the
 * fixture alone, which is the independence contract in docs/speed.md.
 */
const VARS = [
  "npm_config_registry",
  "NPM_CONFIG_REGISTRY",
  "npm_config_ignore_scripts",
  "NPM_CONFIG_IGNORE_SCRIPTS",
  "npm_config_userconfig",
  "NPM_CONFIG_USERCONFIG",
  "npm_config_globalconfig",
  "NPM_CONFIG_GLOBALCONFIG"
];

export function isolateNpmEnv() {
  const saved = {};
  for (const name of VARS) {
    saved[name] = Object.prototype.hasOwnProperty.call(process.env, name)
      ? process.env[name]
      : undefined;
    delete process.env[name];
  }
  return function restore() {
    for (const name of VARS) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  };
}
