/*
 * The no-build publish contract (leviroutes-o71, Paul's Option A): the package
 * ships its reviewed source directly, so the browser condition points at
 * src/routes.js, there is no build script, and prepublishOnly chains exactly
 * test then verify:package.
 *
 * Same fixture approach as verifypackage-registry.spec.mjs: verifyPackage()
 * with exitOnError:false/skipExecution:true, fixtures that satisfy every check
 * before the one under test, and the first LATER check ('missing
 * spec/support/jasmine.json') as the control's proving error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPackage } from '../tools/verify-package.mjs';
import { isolateNpmEnv } from './helpers/npm-env-helper.mjs';

describe("verify-package no-build lifecycle contract", function() {
  var root;
  var restoreNpmEnv;

  beforeEach(function() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vp-lifecycle-"));
    // leviroutes-grg4: the guard also reads npm's exported config paths now, so clear the
    // machine's npm environment to keep each verdict a function of the fixture alone.
    restoreNpmEnv = isolateNpmEnv();
  });

  afterEach(function() {
    if (restoreNpmEnv) restoreNpmEnv();
    restoreNpmEnv = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  // Satisfies every static check up to (and including) the lifecycle chain,
  // so the control's first failure is the jasmine-config check that follows it.
  // lockPackages lets a case add lockfile entries (leviroutes-e0f's resolved-URL check).
  var fixture = (overrides, lockPackages) => {
    const pkg = Object.assign({
      name: "fixture",
      version: "1.0.0",
      main: "./src/routes.js",
      module: "./src/routes.js",
      browser: "./src/routes.js",
      exports: { ".": { browser: "./src/routes.js", import: "./src/routes.js" } },
      files: ["src/", "README.md", "CHANGELOG.md", "LICENCE"],
      scripts: {
        test: "jasmine",
        "verify:package": "node tools/verify-package.mjs",
        prepublishOnly: "npm test && npm run verify:package"
      }
    }, overrides || {});
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
      name: "fixture", version: "1.0.0", packages: lockPackages || {}
    }));
  };

  it("accepts the two-command prepublishOnly chain and no build script", async function() {
    fixture();

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    // The lifecycle checks passed; the first failing check is the next one in line.
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  it("rejects a reintroduced build script", async function() {
    fixture({ scripts: {
      test: "jasmine",
      "verify:package": "node tools/verify-package.mjs",
      prepublishOnly: "npm test && npm run verify:package",
      build: "npm run build:min"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("must not define build scripts");
  });

  it("rejects a build command in the prepublishOnly chain", async function() {
    fixture({ scripts: {
      test: "jasmine",
      "verify:package": "node tools/verify-package.mjs",
      prepublishOnly: "npm test && npm run verify:package && npm run build"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unallowlisted command segment: npm run build");
  });

  it("rejects verify running before test", async function() {
    fixture({ scripts: {
      test: "jasmine",
      "verify:package": "node tools/verify-package.mjs",
      prepublishOnly: "npm run verify:package && npm test"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("must strictly chain test and verify:package in order");
  });

  it("accepts the bare jasmine form of the test command", async function() {
    fixture({ scripts: {
      test: "jasmine",
      "verify:package": "node tools/verify-package.mjs",
      prepublishOnly: "jasmine && npm run verify:package"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  // npm auto-runs a package's install-family scripts on every consumer machine
  // at npm install, and the publish/version family around npm publish and
  // npm version. None of them are seen by the prepublishOnly gate, so each must
  // be rejected outright (leviroutes-1bty: the original nine-entry denylist
  // covered neither family).
  var consumerAndPublishHooks = [
    "preinstall", "install", "postinstall",
    "preuninstall", "uninstall", "postuninstall",
    "publish", "postpublish", "preversion", "version", "postversion",
    "postpack"
  ];

  consumerAndPublishHooks.forEach(function(hook) {
    it("rejects the consumer/publish-side lifecycle hook '" + hook + "'", async function() {
      fixture({ scripts: {
        test: "jasmine",
        "verify:package": "node tools/verify-package.mjs",
        prepublishOnly: "npm test && npm run verify:package"
      } });
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      pkg.scripts[hook] = "echo hook";
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));

      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("defines unallowlisted lifecycle hook scripts[\"" + hook + "\"]");
    });
  });

  it("still passes scripts the denylist does not name", async function() {
    fixture({ scripts: {
      test: "jasmine",
      "verify:package": "node tools/verify-package.mjs",
      prepublishOnly: "npm test && npm run verify:package",
      lint: "echo lint"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    // The denylist is per-hook, not a scripts allowlist: a benign extra script
    // must sail through to the next check (control's proving error).
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  // leviroutes-eew: presence-only entry-point checks let the o71 defect come back - a browser
  // condition or files[] entry pointing at a gitignored dist/ artifact passed the gate. These
  // cases bind every entry point to the same shipped source and constrain the published tree.
  it("rejects a browser condition that points at a different artifact", async function() {
    fixture({ browser: "./dist/routes.min.js" });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("browser resolves to dist/routes.min.js");
    expect(result.error).toContain("main resolves to src/routes.js");
  });

  it("rejects an exports browser condition that points at a different artifact", async function() {
    fixture({ exports: { ".": { browser: "./dist/routes.min.js", import: "./src/routes.js" } } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('exports["."].browser resolves to dist/routes.min.js');
  });

  it("rejects a files[] entry that ships build output", async function() {
    fixture({ files: ["src/", "dist/", "README.md", "LICENCE"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] names build output (dist)");
  });

  it("rejects a files[] entry that ships a minified artifact under another directory", async function() {
    fixture({ files: ["src/", "public/routes.min.js", "README.md"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] names build output (public/routes.min.js)");
  });

  it("rejects a files[] list that does not cover the shipped source", async function() {
    fixture({ files: ["README.md", "LICENCE"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] does not include the shipped source src/routes.js");
  });

  it("rejects a package that states no published tree at all", async function() {
    fixture({ files: undefined });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] must list the published tree");
  });

  it("accepts a files[] entry naming the shipped source file directly", async function() {
    fixture({ files: ["./src/routes.js", "README.md"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    // The publish-layout checks passed; the first failing check is the next one in line.
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  // leviroutes-qubh: the five required fields were the only ones bound, so a dist artifact could
  // still be reached through exports["."].default / .require, an export subpath, or the CDN fields.
  it("rejects an exports default/require condition that points at another artifact", async function() {
    fixture({ exports: {
      ".": {
        browser: "./src/routes.js",
        import: "./src/routes.js",
        default: "./dist/routes.min.js",
        require: "./dist/routes.min.js"
      }
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('exports["."]["default"] resolves to dist/routes.min.js');
  });

  it("rejects an export subpath that points at another artifact", async function() {
    fixture({ exports: {
      ".": { browser: "./src/routes.js", import: "./src/routes.js" },
      "./min": "./dist/routes.min.js"
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('exports["./min"] resolves to dist/routes.min.js');
  });

  it("rejects unpkg and jsdelivr fields that point at another artifact", async function() {
    for (const field of ["unpkg", "jsdelivr"]) {
      fixture({ [field]: "./dist/routes.min.js" });

      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

      expect(result.ok).toBe(false);
      expect(result.error).toContain(`${field} resolves to dist/routes.min.js`);
    }
  });

  it("accepts extra export conditions that point at the shipped source", async function() {
    fixture({ exports: {
      ".": {
        browser: "./src/routes.js",
        import: "./src/routes.js",
        default: "./src/routes.js",
        require: "./src/routes.js"
      }
    } });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  // leviroutes-j8er: a literal check cannot bound what a glob ships, and a negation can drop the
  // shipped source, so files[] has to state the published paths literally.
  it("rejects a glob in files[]", async function() {
    fixture({ files: ["src/", "**/*"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] uses a glob (**/*)");
  });

  it("rejects a negation in files[]", async function() {
    fixture({ files: ["src/", "!src/routes.js", "README.md"] });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("files[] uses a negation (!src/routes.js)");
  });

  // leviroutes-e0f: pinning the publish endpoint is not enough. `npm ci` fetches the URL recorded in
  // each lockfile entry, so a substituted host there installs bytes the pinned registry never served.
  const SRI = "sha512-" + Buffer.alloc(64, 7).toString("base64");

  it("accepts lockfile entries resolved from the pinned registry", async function() {
    fixture({}, {
      "node_modules/left-pad": {
        version: "1.3.0", integrity: SRI,
        resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"
      }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    // The resolved-URL check passed; the first failing check is still the jasmine config.
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  it("rejects a lockfile entry resolved from another host", async function() {
    fixture({}, {
      "node_modules/left-pad": {
        version: "1.3.0", integrity: SRI,
        resolved: "https://registry.example.internal/left-pad/-/left-pad-1.3.0.tgz"
      }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("resolves packages from outside https://registry.npmjs.org/");
    expect(result.error).toContain("registry.example.internal");
  });

  it("rejects a lockfile entry resolved over plain http or a git spec", async function() {
    fixture({}, {
      "node_modules/a": {
        version: "1.0.0", integrity: SRI,
        resolved: "http://registry.npmjs.org/a/-/a-1.0.0.tgz"
      },
      "node_modules/b": {
        version: "1.0.0", integrity: SRI,
        resolved: "git+ssh://git@github.com/someone/b.git"
      }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("node_modules/a -> http://registry.npmjs.org/");
    expect(result.error).toContain("node_modules/b -> git+ssh://");
  });

  it("still accepts a local file/link resolution, which no remote host can substitute", async function() {
    fixture({}, {
      "node_modules/local": { version: "1.0.0", resolved: "file:../local-pkg" },
      "node_modules/linked": { version: "1.0.0", resolved: "link:../linked-pkg" }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });

  // leviroutes-6dub: host pinning says where the bytes come from; an entry with no integrity hash has
  // nothing to check them against, and the SRI loop only validates a hash that is present.
  it("rejects a remote lockfile entry with no integrity hash", async function() {
    fixture({}, {
      "node_modules/a": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz"
      }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("resolves packages without an integrity hash (node_modules/a)");
  });

  it("still accepts a local entry with no integrity hash, which has none by construction", async function() {
    fixture({}, {
      "node_modules/local": { version: "1.0.0", resolved: "file:../local-pkg" }
    });

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    // Local entries are exempt from the integrity requirement; the control's failure is unrelated.
    expect(result.error).toContain("missing spec/support/jasmine.json");
  });
});
