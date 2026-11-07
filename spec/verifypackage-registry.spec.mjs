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
    // npm coerces booleans case-insensitively across true/t/yes/y/1/on and
    // quoted forms (leviroutes-mwg repro B: each skips prepublishOnly).
    for (const spelling of ["1", "TRUE", "Yes", "on", "t", "y", "\"true\"", "'on'"]) {
      fs.writeFileSync(path.join(root, "package.json"), PKG);
      fs.writeFileSync(path.join(root, ".npmrc"), `ignore-scripts=${spelling}\n`);

      const result = await verifyPackage(root, { exitOnError: false, skipExecution: true });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ignore-scripts");
    }
  });

  it("accepts falsy ignore-scripts spellings that keep the lifecycle enabled", async function() {
    for (const spelling of ["false", "0", "no", "off", "FALSE"]) {
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
