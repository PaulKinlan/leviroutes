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

// 5. Package export resolution via child process import
try {
  execSync(
    'node -e "import(\'leviroutes\').then(({default: R}) => { const r = new R(); let ok = false; r.get(\'/smoke\', () => ok = true); r.test(\'/smoke\'); if (!ok) process.exit(1); })"',
    { cwd: root, stdio: 'pipe' }
  );
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
