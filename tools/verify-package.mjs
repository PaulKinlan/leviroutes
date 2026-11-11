import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');

export async function verifyPackage(root = defaultRoot, options = {}) {
  const { exitOnError = true, skipExecution = false } = options;

  const fail = (msg) => {
    const fullMsg = `verify-package: FAIL - ${msg}`;
    if (exitOnError) {
      console.error(fullMsg);
      process.exit(1);
    }
    return { ok: false, error: fullMsg };
  };

  // 1. Validate package.json configuration, scripts, and lifecycle hooks BEFORE any execution
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return fail('missing package.json');
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return fail(`invalid JSON in package.json: ${err.message}`);
  }

  // 1b. Pin the publish registry before any other check. npm resolves the publish
  // endpoint from the environment, publishConfig and .npmrc, and any of them can
  // silently redirect a publish (and its credentials) to a third-party host; the
  // lockfile integrity hashes are only shape-checked below, so the rest of this
  // guard would certify a substituted registry. A committed .npmrc is parsed here
  // rather than trusted: registry= repins the host, and ignore-scripts=true
  // disables the whole prepublishOnly lifecycle without any message (leviroutes-e0f,
  // leviroutes-f9n).
  const OFFICIAL_REGISTRY = 'https://registry.npmjs.org/';
  const normalizeRegistry = (url) => String(url).trim().replace(/\/+$/, '') + '/';
  // npm's own boolean coercion (nopt validateBoolean, npm 11.x): a numeric value
  // becomes Boolean(Number(v)) - so '2', '1.0' and '0x1' are true while '0', '0.0'
  // and '00' are false - the exact strings 'false' and 'null' are false, and EVERY
  // other string is true, including 'no', 'off', 'FALSE', 'f', 'n' and 'tru e'. A
  // bare key or an empty value is true as well (ini parses both to true). Quoted
  // values are compared after the quotes come off, and a trailing ' # ...' / ' ; ...'
  // comment is dropped, both of which npm does too. Reproducing that rule is what
  // makes the guard sound: the blacklist leviroutes-mwg introduced only caught the
  // spellings that happen to be famous, so 'no'/'off'/'2' still disarmed
  // prepublishOnly and passed the gate (leviroutes-rje).
  // leviroutes-ago1: npm's numeric branch is Boolean(Number(v)), and Number() accepts
  // the binary and octal literals too - '0b0' and '0o0' are 0, exactly like '0' and
  // '0x0', so all of them leave the lifecycle ENABLED. The first version of this rule
  // only matched decimal and 0x, so a safe 'ignore-scripts=0b0' was flagged while npm
  // happily ran prepublishOnly (measured on npm 11.19.1 with a marker script and
  // 'npm publish --dry-run').
  const NPM_NUMERIC = /^(?:0[bB][01]+|0[oO][0-7]+|0[xX][0-9a-fA-F]+|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
  const npmBoolean = (raw) => {
    let value = String(raw).trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2].trim();
    if (NPM_NUMERIC.test(value)) {
      return Boolean(Number(value));
    }
    // Case-SENSITIVE: nopt compares the exact strings 'false' and 'null', so
    // 'FALSE' and 'NULL' are true and npm skips the lifecycle for them. Measured
    // against npm 11.19.1 'npm publish --dry-run'.
    return !(value === 'false' || value === 'null');
  };
  const registryOffenders = [];
  const envRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY;
  if (envRegistry && normalizeRegistry(envRegistry) !== OFFICIAL_REGISTRY) {
    registryOffenders.push(`environment npm_config_registry=${envRegistry}`);
  }
  // leviroutes-grg4: ignore-scripts comes from the environment too, and that is how CI normally
  // sets it, but only npm_config_registry was read - so 'npm_config_ignore_scripts=true' passed
  // the gate while npm skipped the whole prepublishOnly chain.
  const envIgnoreScripts = process.env.npm_config_ignore_scripts || process.env.NPM_CONFIG_IGNORE_SCRIPTS;
  if (envIgnoreScripts !== undefined && npmBoolean(envIgnoreScripts)) {
    registryOffenders.push(`environment npm_config_ignore_scripts=${envIgnoreScripts.trim() || '(empty)'} disables the prepublishOnly lifecycle`);
  }
  if (pkg.publishConfig && pkg.publishConfig.registry && normalizeRegistry(pkg.publishConfig.registry) !== OFFICIAL_REGISTRY) {
    registryOffenders.push(`package.json publishConfig.registry=${pkg.publishConfig.registry}`);
  }
  // Scan one npm config file for the two settings that decide where a publish goes and whether the
  // lifecycle runs at all. Returns the offenders so the project, user and global layers all report
  // through the same rule instead of the project file being the only one checked (leviroutes-grg4).
  const scanNpmrc = (label, file, unreadableFails) => {
    if (!file || !fs.existsSync(file)) return [];
    let npmrc;
    try {
      npmrc = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return unreadableFails
        ? [label + ' unreadable: ' + err.message]
        : [];
    }
    const offenders = [];
    for (const rawLine of npmrc.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      // The '=' is optional: a bare 'ignore-scripts' key is true to npm, and that is
      // exactly the shape a hand-written config uses when it means 'on'.
      // leviroutes-grg4: a scoped key (@scope:registry=) pins the registry for that scope and
      // never matched this regex, so the gate could be green while a scope resolved elsewhere.
      const m = /^(@[^:\s]+:)?(registry|ignore-scripts)\s*(?:=\s*(.*))?$/.exec(line);
      if (!m) continue;
      const scope = m[1] || '';
      const key = m[2];
      // ini drops a trailing ' # comment' / ' ; comment' - and npm also drops it when
      // there is NO whitespace in front of it, so 'false;comment' and 'false#c' both
      // run the lifecycle (measured on npm 11.19.1). Requiring whitespace flagged a
      // safe config (leviroutes-ago1).
      // leviroutes-8twg: that drop only happens for an UNQUOTED value. Once the value starts
      // with a quote, npm keeps everything after '=' unless the closing quote is the last
      // character, so 'ignore-scripts="false";comment' is the literal string '"false";comment'
      // to npm (config get shows the quotes) and nopt therefore makes it TRUE - the lifecycle is
      // skipped. Stripping the comment first turned it into '"false"' -> false -> gate green on a
      // config that disables the whole publish chain (measured on npm 11.19.1 with a
      // prepublishOnly marker and 'npm publish --dry-run': plain "false" RAN, "false";comment
      // SKIPPED, and the same for single quotes and for "0"/"0b0" followed by a comment).
      const rawValue = m[3] === undefined ? '' : m[3];
      const trimmedValue = rawValue.trim();
      const startsQuoted = trimmedValue.startsWith("'") || trimmedValue.startsWith('"');
      const value = startsQuoted ? trimmedValue : rawValue.replace(/[#;].*$/, '');
      if (key === 'registry' && normalizeRegistry(value) !== OFFICIAL_REGISTRY) {
        offenders.push(`${label} ${scope}registry=${value}`);
      }
      if (key === 'ignore-scripts' && npmBoolean(value)) {
        offenders.push(`${label} ignore-scripts=${value.trim() || '(bare key)'} disables the prepublishOnly lifecycle`);
      }
    }
    return offenders;
  };
  const npmrcOffenders = scanNpmrc('.npmrc', path.join(root, '.npmrc'), true);
  registryOffenders.push(...npmrcOffenders);
  // npm also reads a user-level and a global config file, and when the lifecycle runs under npm it
  // exports their paths. Those layers are invisible to the gate otherwise, so read them when npm
  // hands them over; a missing file is normal and is skipped. When the paths are absent the gate
  // cannot see those layers - the README states that the release step must be a plain
  // 'npm publish' with no --registry / --ignore-scripts flags (leviroutes-grg4).
  const userConfig = process.env.npm_config_userconfig || process.env.NPM_CONFIG_USERCONFIG;
  const globalConfig = process.env.npm_config_globalconfig || process.env.NPM_CONFIG_GLOBALCONFIG;
  registryOffenders.push(...scanNpmrc('user-level .npmrc', userConfig, false));
  registryOffenders.push(...scanNpmrc('global .npmrc', globalConfig, false));
  if (registryOffenders.length > 0) {
    return fail(`publish configuration must keep ${OFFICIAL_REGISTRY} and the prepublishOnly lifecycle (offenders: ${registryOffenders.join('; ')})`);
  }

  const requiredEntries = [
    { field: 'main', target: pkg.main },
    { field: 'module', target: pkg.module },
    { field: 'browser', target: pkg.browser },
    { field: 'exports["."].import', target: pkg.exports?.['.']?.import },
    { field: 'exports["."].browser', target: pkg.exports?.['.']?.browser }
  ];

  for (const entry of requiredEntries) {
    if (!entry.target) {
      return fail(`missing ${entry.field} in package.json`);
    }
  }

  // leviroutes-eew: only PRESENCE was checked, so the no-build publish layout leviroutes-o71
  // installed could regress silently - a package.json whose main is src/routes.js but whose
  // browser condition (or files[] entry) points at a gitignored dist/ artifact passed the gate,
  // which is exactly the defect o71 fixed. Normalise the targets once and bind them together.
  const normalizeTarget = (target) => path.posix.normalize(String(target).trim().replace(/^\.\//, '')).replace(/\/+$/, '');
  const normalizedEntries = requiredEntries.map((entry) => ({ field: entry.field, target: normalizeTarget(entry.target) }));
  const primaryTarget = normalizedEntries.find((entry) => entry.field === 'main').target;
  for (const entry of normalizedEntries) {
    if (entry.target !== primaryTarget) {
      return fail(`${entry.field} resolves to ${entry.target} but main resolves to ${primaryTarget}; every entry point must load the same shipped source rather than a substituted artifact`);
    }
  }
  // leviroutes-qubh: binding only the five required fields left other ways into a substituted
  // artifact - exports["."].default/.require, any export subpath, and the unpkg/jsdelivr fields
  // that CDNs read. Walk the whole exports tree (strings and arrays) and those two fields.
  const extraEntryPoints = [];
  const collectExportTargets = (node, label) => {
    if (typeof node === 'string') {
      extraEntryPoints.push({ field: label, target: node });
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => collectExportTargets(child, `${label}[${index}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) collectExportTargets(value, `${label}[${JSON.stringify(key)}]`);
    }
  };
  if (pkg.exports !== undefined) collectExportTargets(pkg.exports, 'exports');
  for (const field of ['unpkg', 'jsdelivr']) {
    if (pkg[field] !== undefined) extraEntryPoints.push({ field: field, target: pkg[field] });
  }
  for (const entry of extraEntryPoints) {
    const target = normalizeTarget(entry.target);
    if (target !== primaryTarget) {
      return fail(`${entry.field} resolves to ${target} but main resolves to ${primaryTarget}; every entry point must load the same shipped source rather than a substituted artifact`);
    }
  }
  // The published tree has to be stated, cover that source, and exclude build output: npm ships
  // every path under files[], so a stale 'dist/' entry alone re-publishes an unreviewed artifact.
  const BUILD_OUTPUT_PATTERN = /(^|\/)(dist|build|out|bundle|bundles)(\/|$)|\.min\.js$/i;
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    return fail('package.json files[] must list the published tree so the gate can verify it covers the shipped source and carries no build output');
  }
  const nonStringFiles = pkg.files.filter((entry) => typeof entry !== 'string' || entry.trim() === '');
  if (nonStringFiles.length > 0) {
    return fail('package.json files[] must contain non-empty path strings');
  }
  // leviroutes-j8er: a literal check cannot bound what a glob ships ('**/*' includes dist/, measured
  // with npm pack --dry-run) and a negation can drop the shipped source ('!src/routes.js'), so the
  // published tree has to be stated literally rather than pattern-matched.
  const negatedFiles = pkg.files.filter((entry) => entry.trim().startsWith('!'));
  if (negatedFiles.length > 0) {
    return fail(`package.json files[] uses a negation (${negatedFiles.join(', ')}), which can drop the shipped source; state the published paths literally`);
  }
  const globbedFiles = pkg.files.filter((entry) => /[*?[\]{}]/.test(entry));
  if (globbedFiles.length > 0) {
    return fail(`package.json files[] uses a glob (${globbedFiles.join(', ')}), which can pull in build output the gate cannot see; state the published paths literally`);
  }
  const filesEntries = pkg.files.map(normalizeTarget);
  const buildOutputs = filesEntries.filter((entry) => BUILD_OUTPUT_PATTERN.test(entry));
  if (buildOutputs.length > 0) {
    return fail(`package.json files[] names build output (${buildOutputs.join(', ')}); the package ships reviewed source, not a generated artifact`);
  }
  const sourceCovered = filesEntries.some((entry) => entry === primaryTarget || primaryTarget.startsWith(entry + '/'));
  if (!sourceCovered) {
    return fail(`package.json files[] does not include the shipped source ${primaryTarget}`);
  }

  // Validate package-lock.json configuration, integrity hashes, and dependency parity BEFORE any execution
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return fail('missing package-lock.json');
  }

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    return fail(`invalid JSON in package-lock.json: ${err.message}`);
  }

  if (lock.name !== pkg.name) {
    return fail(`package-lock.json name "${lock.name}" does not match package.json name "${pkg.name}"`);
  }

  if (lock.version !== pkg.version) {
    return fail(`package-lock.json version "${lock.version}" does not match package.json version "${pkg.version}"`);
  }

  if (!lock.packages || typeof lock.packages !== 'object') {
    return fail('package-lock.json missing packages object');
  }

  const rootPkg = lock.packages[''] || {};
  for (const depType of ['dependencies', 'devDependencies']) {
    const pkgDeps = pkg[depType] || {};
    const lockDeps = rootPkg[depType] || {};
    for (const [dep, req] of Object.entries(pkgDeps)) {
      if (lockDeps[dep] !== req) {
        return fail(`package-lock.json ${depType}["${dep}"] ("${lockDeps[dep]}") does not match package.json ("${req}")`);
      }
    }
    for (const dep of Object.keys(lockDeps)) {
      if (!(dep in pkgDeps)) {
        return fail(`package-lock.json has extraneous ${depType}["${dep}"] not in package.json`);
      }
    }
  }

  const checkSri = (sri) => {
    const parts = sri.trim().split(/\s+/);
    if (parts.length === 0) return false;
    for (const part of parts) {
      const m = /^sha(512|384|1)-([A-Za-z0-9+/]+={0,2})$/.exec(part);
      if (!m) return false;
      const [_, alg, b64] = m;
      const expectedLen = alg === '512' ? 64 : alg === '384' ? 48 : 20;
      const buf = Buffer.from(b64, 'base64');
      if (buf.length !== expectedLen || buf.toString('base64') !== b64) return false;
    }
    return true;
  };

  for (const [pkgKey, pkgEntry] of Object.entries(lock.packages)) {
    if (pkgEntry.integrity && !checkSri(pkgEntry.integrity)) {
      return fail(`package-lock.json contains invalid integrity hash for ${pkgKey}: ${pkgEntry.integrity}`);
    }
  }

  // leviroutes-e0f: pinning the publish endpoint is only half the job - every lockfile entry also
  // records the URL its tarball comes from, and `npm ci` fetches that URL verbatim. A substituted host
  // in `resolved` therefore installs different bytes than the registry pinned above, and the SRI check
  // just passed only proves the integrity string is well formed, not that it describes bytes from the
  // pinned host. Local workspace links are the one exception (they cannot be substituted remotely);
  // anything else - another host, plain http, a git or ssh spec - is refused, because this package has
  // no production dependencies and such a source is a supply-chain decision that must be made in the
  // open rather than arrive as a lockfile edit.
  // leviroutes-m5ly: an entry with no resolved URL at all passes the host-pin loop and the integrity
  // check if resolved is missing. Every remote package must specify a resolved URL.
  const LOCAL_RESOLUTION = /^(?:file|link):/;
  const resolvedOffenders = [];
  const integrityOffenders = [];
  const missingResolvedOffenders = [];
  for (const [pkgKey, pkgEntry] of Object.entries(lock.packages)) {
    if (pkgKey === '') continue;
    if (pkgEntry && pkgEntry.link) continue;
    const resolved = pkgEntry && pkgEntry.resolved;
    if (typeof resolved !== 'string' || resolved.trim() === '') {
      missingResolvedOffenders.push(pkgKey);
      continue;
    }
    if (LOCAL_RESOLUTION.test(resolved)) continue;
    if (!resolved.startsWith(OFFICIAL_REGISTRY)) resolvedOffenders.push(`${pkgKey} -> ${resolved}`);
    // leviroutes-6dub: host pinning bounds WHERE the bytes come from, but an entry with no integrity hash
    // has nothing to check those bytes against - npm installs whatever the host returns, and the SRI loop
    // above only validates a hash that is present. Stripped-integrity lockfile edits are the accidental
    // half of supply-chain substitution, so a remote resolution now requires one. Local file:/link:
    // resolutions legitimately carry none and are exempt.
    if (!pkgEntry.integrity) integrityOffenders.push(pkgKey);
  }
  if (missingResolvedOffenders.length > 0) {
    const shown = missingResolvedOffenders.slice(0, 3).join(', ');
    const extra = missingResolvedOffenders.length > 3 ? `, +${missingResolvedOffenders.length - 3} more` : '';
    return fail(`package-lock.json resolves packages without a resolved URL (${shown}${extra}); every remote dependency must specify its resolution source`);
  }
  if (integrityOffenders.length > 0) {
    const shown = integrityOffenders.slice(0, 3).join(', ');
    const extra = integrityOffenders.length > 3 ? `, +${integrityOffenders.length - 3} more` : '';
    return fail(`package-lock.json resolves packages without an integrity hash (${shown}${extra}); a remote tarball must be checked against a recorded hash`);
  }
  if (resolvedOffenders.length > 0) {
    const shown = resolvedOffenders.slice(0, 3).join(', ');
    const extra = resolvedOffenders.length > 3 ? `, +${resolvedOffenders.length - 3} more` : '';
    return fail(`package-lock.json resolves packages from outside ${OFFICIAL_REGISTRY} (${shown}${extra}); the resolved URL is what npm ci fetches, so it must be the pinned registry`);
  }

  // Validate underlying scripts invoked by the prepublish lifecycle
  const testBody = (pkg.scripts?.test || '').trim();
  if (testBody !== 'jasmine') {
    return fail(`package.json scripts.test must be exactly "jasmine" (got: ${testBody})`);
  }

  const verifyBody = (pkg.scripts?.['verify:package'] || '').trim();
  if (!verifyBody || verifyBody !== 'node tools/verify-package.mjs') {
    return fail('package.json scripts["verify:package"] must execute "node tools/verify-package.mjs"');
  }

  // The package ships its source directly: the browser condition points at
  // src/routes.js and there is no build step (leviroutes-o71, Paul's Option A).
  // A build or build:min script would recreate the unreviewable build-output
  // artifact this contract removed, so their presence fails the guard.
  if (pkg.scripts && ('build' in pkg.scripts || 'build:min' in pkg.scripts)) {
    return fail('package.json must not define build scripts: the browser condition exports src/routes.js directly (leviroutes-o71)');
  }

  // Reject lifecycle hooks outside the gate's control. npm auto-runs a package's
  // install-family scripts on every CONSUMER machine at npm install, and the
  // publish/version family around npm publish and npm version - exactly the
  // arbitrary-code and artifact-mutating surfaces a maintainer could add after
  // review (leviroutes-1bty: the original nine-entry list covered the build/test
  // family and prepublish/prepare/prepack only, so a committed postinstall or
  // publish hook passed this gate). npm also auto-runs pre<script>/post<script>
  // for any `npm run <script>`, which is why the build/test entries stay listed
  // even though the build scripts themselves are banned above. prepublishOnly is
  // deliberately absent: it is required and shape-checked below.
  const forbiddenHooks = [
    'prebuild', 'prebuild:min', 'postbuild', 'postbuild:min',
    'pretest', 'posttest',
    'prepublish', 'prepare', 'prepack', 'postpack', 'publish', 'postpublish',
    'preversion', 'version', 'postversion',
    'preinstall', 'install', 'postinstall',
    'preuninstall', 'uninstall', 'postuninstall'
  ];
  for (const hook of forbiddenHooks) {
    if (pkg.scripts && hook in pkg.scripts) {
      return fail(`package.json defines unallowlisted lifecycle hook scripts["${hook}"]`);
    }
  }

  // Assert prepublishOnly script enforces tests and package verification before publishing
  const prepublishOnly = (pkg.scripts?.prepublishOnly || '').trim();

  if (!prepublishOnly) {
    return fail('missing prepublishOnly script in package.json');
  }

  // Reject all shell metacharacters, backgrounding, pipes, subshells, redirections, etc.
  // Only the "&&" delimiter is permitted between allowlisted commands.
  const withoutAndAnd = prepublishOnly.replaceAll('&&', ' ');
  if (/[;&|><$`\\(){}\n\r]/.test(withoutAndAnd)) {
    return fail('prepublishOnly script contains forbidden shell metacharacters (only && delimiter permitted)');
  }

  const commands = prepublishOnly.split('&&').map(c => c.trim()).filter(Boolean);
  const testPattern = /^(?:npm\s+(?:run\s+)?test|jasmine)$/;
  const verifyPattern = /^(?:npm\s+run\s+verify:package|node\s+tools\/verify-package\.mjs)$/;

  let testIdx = -1;
  let verifyIdx = -1;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (testPattern.test(cmd)) {
      if (testIdx === -1) testIdx = i;
    } else if (verifyPattern.test(cmd)) {
      if (verifyIdx === -1) verifyIdx = i;
    } else {
      return fail(`prepublishOnly contains unallowlisted command segment: ${cmd}`);
    }
  }

  if (testIdx === -1 || verifyIdx === -1 || testIdx > verifyIdx || commands.length !== 2) {
    return fail('prepublishOnly script must strictly chain test and verify:package in order: npm test && npm run verify:package');
  }

  // 2. Bind the effective Jasmine config: a higher-precedence .mjs/.js config
  // would silently override the checked JSON and could narrow the publish test set.
  for (const config of [
    'spec/support/jasmine.mjs', 'spec/support/jasmine.js',
    'jasmine.mjs', 'jasmine.js'
  ]) {
    if (fs.existsSync(path.join(root, config))) {
      return fail(`unexpected Jasmine config ${config} (only spec/support/jasmine.json is allowed)`);
    }
  }
  const jasmineConfigPath = path.join(root, 'spec', 'support', 'jasmine.json');
  if (!fs.existsSync(jasmineConfigPath)) {
    return fail('missing spec/support/jasmine.json');
  }
  let jasmineConfig;
  try {
    jasmineConfig = JSON.parse(fs.readFileSync(jasmineConfigPath, 'utf8'));
  } catch (err) {
    return fail(`invalid JSON in spec/support/jasmine.json: ${err.message}`);
  }
  if (jasmineConfig.spec_dir !== 'spec' || !Array.isArray(jasmineConfig.spec_files) || !jasmineConfig.spec_files.includes('**/*[sS]pec.?(m)js')) {
    return fail('spec/support/jasmine.json must specify spec_dir "spec" and spec_files ["**/*[sS]pec.?(m)js"]');
  }

  // Static checks complete. If skipExecution or VERIFY_STATIC_ONLY is set, exit cleanly here
  // so callers testing static parity or negative mutations do not pay the cost of npm startup.
  if (skipExecution || process.env.VERIFY_STATIC_ONLY === '1') {
    const passMsg = 'verify-package: PASS (static package and lockfile configuration verified)';
    if (exitOnError) {
      console.log(passMsg);
      process.exit(0);
    }
    return { ok: true, output: passMsg };
  }

  // Check installed dependencies only after all static configuration checks. Negative
  // validation must not pay for npm startup, but a valid package still checks its tree.
  // leviroutes-e0f: npm_config_audit=false is a decision, not an oversight. Dependency advisories are
  // deliberately NOT part of this gate: it has to answer offline and deterministically at publish time
  // (a registry or audit endpoint that is slow, rate-limited or down would turn a publish into a
  // flake), the package has no production dependencies at all and two devDependencies, and advisories
  // for those arrive from the nightly deps-supply-chain station, which tracks them as beads rather
  // than as a blocking gate step. Recorded here because the alternative - an audit leg in
  // prepublishOnly - would also have to survive the exact two-segment chain this guard enforces.
  const npmEnv = {
    ...process.env,
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  };

  if (process.env.VERIFY_SKIP_NPM_LS !== '1') {
    try {
      execSync('npm ls', { cwd: root, stdio: 'pipe', env: npmEnv });
    } catch (err) {
      return fail(`npm ls dependency check failed: ${err.message}`);
    }
  }

  // 3. Validate file presence on disk (browser and main both point at src/routes.js:
  // the package ships its source, there is no build output to regenerate - leviroutes-o71)
  for (const entry of requiredEntries) {
    const resolved = path.join(root, entry.target);
    if (!fs.existsSync(resolved)) {
      return fail(`${entry.field} (${entry.target}) does not exist on disk`);
    }
    const stat = fs.statSync(resolved);
    if (stat.size === 0) {
      return fail(`${entry.field} (${entry.target}) is an empty file`);
    }
  }

  // 4. Import and smoke test src/routes.js (the main, module and browser
  // condition all resolve to the same reviewed source file)
  try {
    const { default: RoutesSrc } = await import(path.join(root, pkg.main));
    if (typeof RoutesSrc !== 'function') {
      throw new Error('Default export from main is not a constructor/function');
    }
    const r1 = new RoutesSrc();
    let calledSrc = false;
    r1.get('/verify-src', () => { calledSrc = true; });
    r1.test('/verify-src');
    if (!calledSrc) {
      throw new Error('Routing match failed in src instance');
    }
  } catch (err) {
    return fail(`src smoke verification failed: ${err.message}`);
  }

  // 5. Import and smoke test the browser-condition export
  try {
    const { default: RoutesBrowser } = await import(path.join(root, pkg.browser));
    if (typeof RoutesBrowser !== 'function') {
      throw new Error('Default export from browser condition is not a constructor/function');
    }
    const r2 = new RoutesBrowser();
    let calledBrowser = false;
    r2.get('/verify-browser', () => { calledBrowser = true; });
    r2.test('/verify-browser');
    if (!calledBrowser) {
      throw new Error('Routing match failed in browser-condition instance');
    }
  } catch (err) {
    return fail(`browser smoke verification failed: ${err.message}`);
  }

  // 7. Package export resolution assertions
  try {
    // Assert default condition resolves to main ESM file
    const defaultUrl = execSync(
      'node --input-type=module -e "console.log(import.meta.resolve(\'leviroutes\'))"',
      { cwd: root, encoding: 'utf8' }
    ).trim();
    const defaultResolvedPath = fileURLToPath(defaultUrl);
    const expectedDefault = path.resolve(root, pkg.main);
    if (path.resolve(defaultResolvedPath) !== expectedDefault) {
      throw new Error(`Default import resolved to ${defaultResolvedPath}, expected ${expectedDefault}`);
    }

    // Assert the browser condition resolves to the shipped source file (there is no build output:
    // leviroutes-o71 / leviroutes-x8g)
    const browserUrl = execSync(
      'node --conditions=browser --input-type=module -e "console.log(import.meta.resolve(\'leviroutes\'))"',
      { cwd: root, encoding: 'utf8' }
    ).trim();
    const browserResolvedPath = fileURLToPath(browserUrl);
    const expectedBrowser = path.resolve(root, pkg.browser);
    if (path.resolve(browserResolvedPath) !== expectedBrowser) {
      throw new Error(`Browser condition resolved to ${browserResolvedPath}, expected ${expectedBrowser}`);
    }

    // Functional check in child process
    execSync(
      'node --conditions=browser -e "import(\'leviroutes\').then(({default: R}) => { const r = new R(); let ok = false; r.get(\'/smoke\', () => ok = true); r.test(\'/smoke\'); if (!ok) process.exit(1); })"',
      { cwd: root, stdio: 'pipe' }
    );
  } catch (err) {
    return fail(`package condition resolution failed: ${err.message}`);
  }

  const passMsg = 'verify-package: PASS (package metadata, ESM import, browser export verified)';
  if (exitOnError) {
    console.log(passMsg);
    process.exit(0);
  }
  return { ok: true, output: passMsg };
}

const isMain = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) {
  verifyPackage(defaultRoot, {
    exitOnError: true,
    skipExecution: process.env.VERIFY_STATIC_ONLY === '1'
  }).catch((err) => {
    console.error('verify-package: FAIL - unexpected error:', err.message);
    process.exit(1);
  });
}
