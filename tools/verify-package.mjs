import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { minify } from 'terser';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 1. Validate package.json configuration, scripts, and lifecycle hooks BEFORE any execution
const pkgPath = path.join(root, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('verify-package: FAIL - missing package.json');
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch (err) {
  console.error('verify-package: FAIL - invalid JSON in package.json:', err.message);
  process.exit(1);
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
    console.error(`verify-package: FAIL - missing ${entry.field} in package.json`);
    process.exit(1);
  }
}

// Validate package-lock.json configuration, integrity hashes, and dependency parity BEFORE any execution
const lockPath = path.join(root, 'package-lock.json');
if (!fs.existsSync(lockPath)) {
  console.error('verify-package: FAIL - missing package-lock.json');
  process.exit(1);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (err) {
  console.error('verify-package: FAIL - invalid JSON in package-lock.json:', err.message);
  process.exit(1);
}

if (lock.name !== pkg.name) {
  console.error(`verify-package: FAIL - package-lock.json name "${lock.name}" does not match package.json name "${pkg.name}"`);
  process.exit(1);
}

if (lock.version !== pkg.version) {
  console.error(`verify-package: FAIL - package-lock.json version "${lock.version}" does not match package.json version "${pkg.version}"`);
  process.exit(1);
}

if (!lock.packages || typeof lock.packages !== 'object') {
  console.error('verify-package: FAIL - package-lock.json missing packages object');
  process.exit(1);
}

const rootPkg = lock.packages[''] || {};
for (const depType of ['dependencies', 'devDependencies']) {
  const pkgDeps = pkg[depType] || {};
  const lockDeps = rootPkg[depType] || {};
  for (const [dep, req] of Object.entries(pkgDeps)) {
    if (lockDeps[dep] !== req) {
      console.error(`verify-package: FAIL - package-lock.json ${depType}["${dep}"] ("${lockDeps[dep]}") does not match package.json ("${req}")`);
      process.exit(1);
    }
  }
  for (const dep of Object.keys(lockDeps)) {
    if (!(dep in pkgDeps)) {
      console.error(`verify-package: FAIL - package-lock.json has extraneous ${depType}["${dep}"] not in package.json`);
      process.exit(1);
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
    console.error(`verify-package: FAIL - package-lock.json contains invalid integrity hash for ${pkgKey}: ${pkgEntry.integrity}`);
    process.exit(1);
  }
}

// Validate underlying scripts invoked by the prepublish lifecycle
const testBody = (pkg.scripts?.test || '').trim();
if (testBody !== 'jasmine') {
  console.error(`verify-package: FAIL - package.json scripts.test must be exactly "jasmine" (got: ${testBody})`);
  process.exit(1);
}

const verifyBody = (pkg.scripts?.['verify:package'] || '').trim();
if (!verifyBody || verifyBody !== 'node tools/verify-package.mjs') {
  console.error('verify-package: FAIL - package.json scripts["verify:package"] must execute "node tools/verify-package.mjs"');
  process.exit(1);
}

const buildBody = (pkg.scripts?.build || '').trim();
if (buildBody !== 'npm run build:min') {
  console.error(`verify-package: FAIL - package.json scripts.build must be exactly "npm run build:min" (got: ${buildBody})`);
  process.exit(1);
}

const buildMinBody = (pkg.scripts?.['build:min'] || '').trim();
if (buildMinBody !== 'terser src/routes.js -o dist/routes.min.js -c -m --comments false') {
  console.error(`verify-package: FAIL - package.json scripts["build:min"] must be exactly "terser src/routes.js -o dist/routes.min.js -c -m --comments false" (got: ${buildMinBody})`);
  process.exit(1);
}

// Reject unallowlisted npm lifecycle hooks that could bypass or mutate build/test artifacts
const forbiddenHooks = [
  'prebuild', 'prebuild:min', 'postbuild', 'postbuild:min',
  'pretest', 'posttest', 'prepublish', 'prepare', 'prepack'
];
for (const hook of forbiddenHooks) {
  if (pkg.scripts && hook in pkg.scripts) {
    console.error(`verify-package: FAIL - package.json defines unallowlisted lifecycle hook scripts["${hook}"]`);
    process.exit(1);
  }
}

// Assert prepublishOnly script enforces tests and package verification before publishing
const prepublishOnly = (pkg.scripts?.prepublishOnly || '').trim();

if (!prepublishOnly) {
  console.error('verify-package: FAIL - missing prepublishOnly script in package.json');
  process.exit(1);
}

// Reject all shell metacharacters, backgrounding, pipes, subshells, redirections, etc.
// Only the "&&" delimiter is permitted between allowlisted commands.
const withoutAndAnd = prepublishOnly.replaceAll('&&', ' ');
if (/[;&|><$`\\(){}\n\r]/.test(withoutAndAnd)) {
  console.error('verify-package: FAIL - prepublishOnly script contains forbidden shell metacharacters (only && delimiter permitted)');
  process.exit(1);
}

const commands = prepublishOnly.split('&&').map(c => c.trim()).filter(Boolean);
const testPattern = /^(?:npm\s+(?:run\s+)?test|jasmine)$/;
const verifyPattern = /^(?:npm\s+run\s+verify:package|node\s+tools\/verify-package\.mjs)$/;
const buildPattern = /^(?:npm\s+run\s+build(?::min)?)$/;

let testIdx = -1;
let verifyIdx = -1;
let buildIdx = -1;

for (let i = 0; i < commands.length; i++) {
  const cmd = commands[i];
  if (testPattern.test(cmd)) {
    if (testIdx === -1) testIdx = i;
  } else if (verifyPattern.test(cmd)) {
    if (verifyIdx === -1) verifyIdx = i;
  } else if (buildPattern.test(cmd)) {
    if (buildIdx === -1) buildIdx = i;
  } else {
    console.error(`verify-package: FAIL - prepublishOnly contains unallowlisted command segment: ${cmd}`);
    process.exit(1);
  }
}

if (testIdx === -1 || verifyIdx === -1 || buildIdx === -1 || testIdx > verifyIdx || verifyIdx > buildIdx || commands.length !== 3) {
  console.error('verify-package: FAIL - prepublishOnly script must strictly chain test, verify:package, and build commands in order: npm test && npm run verify:package && npm run build');
  process.exit(1);
}

// 2. Bind the effective Jasmine config: a higher-precedence .mjs/.js config
// would silently override the checked JSON and could narrow the publish test set.
for (const config of [
  'spec/support/jasmine.mjs', 'spec/support/jasmine.js',
  'jasmine.mjs', 'jasmine.js'
]) {
  if (fs.existsSync(path.join(root, config))) {
    console.error(`verify-package: FAIL - unexpected Jasmine config ${config} (only spec/support/jasmine.json is allowed)`);
    process.exit(1);
  }
}
const jasmineConfigPath = path.join(root, 'spec', 'support', 'jasmine.json');
if (!fs.existsSync(jasmineConfigPath)) {
  console.error('verify-package: FAIL - missing spec/support/jasmine.json');
  process.exit(1);
}
let jasmineConfig;
try {
  jasmineConfig = JSON.parse(fs.readFileSync(jasmineConfigPath, 'utf8'));
} catch (err) {
  console.error('verify-package: FAIL - invalid JSON in spec/support/jasmine.json:', err.message);
  process.exit(1);
}
if (jasmineConfig.spec_dir !== 'spec' || !Array.isArray(jasmineConfig.spec_files) || !jasmineConfig.spec_files.includes('**/*[sS]pec.?(m)js')) {
  console.error('verify-package: FAIL - spec/support/jasmine.json must specify spec_dir "spec" and spec_files ["**/*[sS]pec.?(m)js"]');
  process.exit(1);
}

// Check installed dependencies only after all static configuration checks. Negative
// validation must not pay for npm startup, but a valid package still checks its tree.
try {
  execSync('npm ls', { cwd: root, stdio: 'pipe' });
} catch (err) {
  console.error('verify-package: FAIL - npm ls dependency check failed:', err.message);
  process.exit(1);
}

// 3. Build minified artifact and assert regeneration from src/routes.js (AFTER script validation)
const distPath = path.join(root, 'dist', 'routes.min.js');
if (fs.existsSync(distPath)) {
  fs.unlinkSync(distPath);
}

try {
  execSync('npm run build', { cwd: root, stdio: 'pipe' });
} catch (err) {
  console.error('verify-package: FAIL - npm run build failed:', err.message);
  process.exit(1);
}

if (!fs.existsSync(distPath)) {
  console.error('verify-package: FAIL - npm run build did not generate dist/routes.min.js');
  process.exit(1);
}

// Assert dist/routes.min.js matches exact compilation of src/routes.js
const srcContent = fs.readFileSync(path.join(root, 'src', 'routes.js'), 'utf8');
const compiled = await minify(srcContent, { compress: true, mangle: true, format: { comments: false } });
const distContent = fs.readFileSync(distPath, 'utf8');
if (compiled.code.trim() !== distContent.trim()) {
  console.error('verify-package: FAIL - dist/routes.min.js is not compiled from src/routes.js');
  process.exit(1);
}

// 4. Validate file presence on disk
for (const entry of requiredEntries) {
  const resolved = path.join(root, entry.target);
  if (!fs.existsSync(resolved)) {
    console.error(`verify-package: FAIL - ${entry.field} (${entry.target}) does not exist on disk`);
    process.exit(1);
  }
  const stat = fs.statSync(resolved);
  if (stat.size === 0) {
    console.error(`verify-package: FAIL - ${entry.field} (${entry.target}) is an empty file`);
    process.exit(1);
  }
}

// 5. Import and smoke test src/routes.js
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
  console.error('verify-package: FAIL - src smoke verification failed:', err.message);
  process.exit(1);
}

// 6. Import and smoke test dist/routes.min.js
try {
  const { default: RoutesDist } = await import(path.join(root, pkg.browser));
  if (typeof RoutesDist !== 'function') {
    throw new Error('Default export from browser artifact is not a constructor/function');
  }
  const r2 = new RoutesDist();
  let calledDist = false;
  r2.get('/verify-dist', () => { calledDist = true; });
  r2.test('/verify-dist');
  if (!calledDist) {
    throw new Error('Routing match failed in dist instance');
  }
} catch (err) {
  console.error('verify-package: FAIL - dist smoke verification failed:', err.message);
  process.exit(1);
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

  // Assert browser condition resolves to minified dist artifact
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
  console.error('verify-package: FAIL - package condition resolution failed:', err.message);
  process.exit(1);
}

console.log('verify-package: PASS (build, package metadata, ESM import, browser export verified)');
process.exit(0);
