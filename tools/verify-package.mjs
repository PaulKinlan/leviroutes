import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 1. Build minified artifact
try {
  execSync('npm run build', { cwd: root, stdio: 'pipe' });
} catch (err) {
  console.error('verify-package: FAIL - npm run build failed:', err.message);
  process.exit(1);
}

// 2. Validate package.json fields and file presence
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

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

// Validate underlying scripts invoked by the prepublish lifecycle
const testBody = (pkg.scripts?.test || '').trim();
if (!testBody || /[;&|><$`\\(){}\n\r]/.test(testBody)) {
  console.error('verify-package: FAIL - package.json scripts.test is missing or contains forbidden shell metacharacters');
  process.exit(1);
}
if (!/^(?:[A-Za-z0-9_]+=[A-Za-z0-9_.-]+\s+)*(?:jasmine)(?:\s+(?!--help\b|-h\b)[A-Za-z0-9_.-]+)*$/.test(testBody)) {
  console.error(`verify-package: FAIL - package.json scripts.test must resolve to a valid runner command (got: ${testBody})`);
  process.exit(1);
}

const verifyBody = (pkg.scripts?.['verify:package'] || '').trim();
if (!verifyBody || verifyBody !== 'node tools/verify-package.mjs') {
  console.error('verify-package: FAIL - package.json scripts["verify:package"] must execute "node tools/verify-package.mjs"');
  process.exit(1);
}

const buildBody = (pkg.scripts?.build || '').trim();
if (!buildBody || /[;&|><$`\\(){}\n\r]/.test(buildBody) || !/^(?:npm\s+run\s+build:min|terser\b.*)$/.test(buildBody)) {
  console.error('verify-package: FAIL - package.json scripts.build must resolve to a valid build command (npm run build:min)');
  process.exit(1);
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
if (commands.length === 0) {
  console.error('verify-package: FAIL - prepublishOnly script contains no commands');
  process.exit(1);
}

const testPattern = /^(?:[A-Za-z0-9_]+=[A-Za-z0-9_.-]+\s+)*(?:npm\s+(?:run\s+)?test|jasmine)$/;
const verifyPattern = /^(?:[A-Za-z0-9_]+=[A-Za-z0-9_.-]+\s+)*(?:npm\s+run\s+verify:package|node\s+tools\/verify-package\.mjs)$/;
const buildPattern = /^(?:[A-Za-z0-9_]+=[A-Za-z0-9_.-]+\s+)*(?:npm\s+run\s+build(?::min)?)$/;

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

if (testIdx === -1 || verifyIdx === -1 || (buildIdx !== -1 && (buildIdx < testIdx || buildIdx < verifyIdx))) {
  console.error('verify-package: FAIL - prepublishOnly script must run tests and verify:package before building/publishing');
  process.exit(1);
}

// 3. Import and smoke test src/routes.js
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

// 4. Import and smoke test dist/routes.min.js
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

// 5. Package export resolution assertions
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
