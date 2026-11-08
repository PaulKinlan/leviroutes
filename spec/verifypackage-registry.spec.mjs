/*
 * Registry pinning in tools/verify-package.mjs (leviroutes-e0f, leviroutes-f9n).
 *
 * verifyPackage() is called with exitOnError:false so failures come back as
 * {ok:false,error} instead of process.exit, and skipExecution:true so the
 * fixtures only need to satisfy the checks that run before the one under
 * test. The registry check sits right after the package.json parse, so a
 * minimal fixture is enough: the control proves the check passes (the very
 * next check, "missing main", is the first failure), each mutant proves the
 * registry failure names its offender.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPackage } from '../tools/verify-package.mjs';

describe("verify-package registry pinning", function() {
  const PKG = JSON.stringify({ name: "fixture", version: "1.0.0" });

  var root;

  beforeEach(function() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vp-registry-"));
  });

  afterEach(function() {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it("does not fire for a package.json without registry configuration", async function() {
    fs.writeFileSync(path.join(root, "package.json"), PKG);

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    // The registry check passed; the first failing check is the next one in line.
    expect(result.error).toContain("missing main");
  });

  it("fails when package.json publishConfig.registry points elsewhere", async function() {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "fixture", version: "1.0.0",
      publishConfig: { registry: "https://registry.example.internal/" }
    }));

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("publishConfig.registry");
    expect(result.error).toContain("https://registry.npmjs.org/");
  });

  it("fails when a committed .npmrc repins the registry", async function() {
    fs.writeFileSync(path.join(root, "package.json"), PKG);
    fs.writeFileSync(path.join(root, ".npmrc"), "# comment\n; another\nregistry=https://registry.example.internal/\n");

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(".npmrc registry=");
  });

  it("fails when a committed .npmrc sets ignore-scripts=true", async function() {
    fs.writeFileSync(path.join(root, "package.json"), PKG);
    fs.writeFileSync(path.join(root, ".npmrc"), "ignore-scripts=true\n");

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ignore-scripts=true");
  });

  it("rejects every truthy ignore-scripts spelling npm honours", async function() {
    // Measured against npm 11.19.1 / node 24.22.0 with a prepublishOnly marker and
    // 'npm publish --dry-run': every spelling below SKIPS the lifecycle, so the gate
    // must reject it. The list is npm's rule (nopt validateBoolean: numeric ->
    // Boolean(Number(v)), false only for 'false'/'null', everything else true, and a
    // bare or empty key is true) rather than a blacklist of famous spellings
    // (leviroutes-rje, refining leviroutes-mwg).
    const bypasses = [
      "1", "TRUE", "Yes", "on", "t", "y", "'on'", "\"true\"",
      "no", "No", "off", "OFF", "FALSE", "f", "F", "n", "N",
      "2", "0x1", "1.0", "tru e", "\"\"",
      "", "ignore-scripts", "ignore-scripts  =  true"
    ];
    for (const spelling of bypasses) {
      fs.writeFileSync(path.join(root, "package.json"), PKG);
      // A spellings list entry that is itself a full line covers the bare key, the
      // empty value and the spaced '=' forms; the rest are values.
      const line = spelling.startsWith("ignore-scripts") ? spelling : `ignore-scripts=${spelling}`;
      fs.writeFileSync(path.join(root, ".npmrc"), `${line}\n`);

      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ignore-scripts");
    }
  });

  it("accepts the falsy ignore-scripts spellings that keep the lifecycle enabled", async function() {
    // Also measured: these RUN the lifecycle, so rejecting them would be a false
    // alarm on a safe config (npm's numeric rule makes '0', '0.0' and '00' false, and
    // ini drops the trailing comment, so 'false # explain' is still false).
    // leviroutes-ago1: Number() also accepts binary and octal literals, and ini drops a
    // comment even with no whitespace in front of it - so '0b0', '0o0' and
    // 'false;comment' keep the lifecycle enabled on npm 11.19.1 and must not be
    // rejected. Measured with a prepublishOnly marker script and 'npm publish --dry-run'.
    for (const spelling of [
      "false", "0", "0.0", "00", "\"false\"", "null", "false # keep scripts",
      "0b0", "0B0", "0o0", "0O0", "0x0", "'0b0'", "\"0b0\"",
      "false;comment", "false#comment", "false ;comment"
    ]) {
      fs.writeFileSync(path.join(root, "package.json"), PKG);
      fs.writeFileSync(path.join(root, ".npmrc"), `ignore-scripts=${spelling}\n`);

      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

      expect(result.ok).toBe(false);
      // The lifecycle is enabled, so the ignore-scripts check did not fire;
      // the first failing check is the next one in line.
      expect(result.error).toContain("missing main");
    }
  });

  it("accepts an .npmrc with the official registry and unrelated settings", async function() {
    fs.writeFileSync(path.join(root, "package.json"), PKG);
    fs.writeFileSync(path.join(root, ".npmrc"), "registry=https://registry.npmjs.org/\nsave-exact=true\n");

    const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing main");
  });

  it("fails when the environment repins the registry", async function() {
    fs.writeFileSync(path.join(root, "package.json"), PKG);
    const previous = process.env.npm_config_registry;
    process.env.npm_config_registry = "https://registry.example.internal/";
    try {
      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("npm_config_registry");
    } finally {
      if (previous === undefined) {
        delete process.env.npm_config_registry;
      } else {
        process.env.npm_config_registry = previous;
      }
    }
  });
});
