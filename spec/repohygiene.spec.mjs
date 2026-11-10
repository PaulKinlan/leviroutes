/*
 * Repository hygiene for the publish gate (leviroutes-f9n).
 *
 * The publish gate runs from `prepublishOnly`, so anything that disables the
 * lifecycle disables the gate with it. A committed `.npmrc` containing
 * `ignore-scripts=true` does exactly that: `npm publish` then runs no tests and no
 * verification at all, silently (measured on npm 11.19.1 - see leviroutes-f9n).
 * `tools/verify-package.mjs` already refuses such a file, but it can only say so
 * when it runs, which is precisely what the file prevents.
 *
 * So the defence has to sit outside the lifecycle: these assertions run under
 * `npm test` and, more importantly, under the fleet's fast/full gates, which
 * invoke the suites directly rather than through npm's lifecycle hooks. They check
 * that the repository itself passes its own publish gate, that the gate still
 * bites on a leaking .npmrc (negative control), and that `.npmrc` cannot be
 * committed by an ordinary `git add .`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "../tools/verify-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

describe("publish-gate repository hygiene", function() {
  var tmp;

  beforeEach(function() {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leviroutes-hygiene-"));
  });

  afterEach(function() {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("should keep .npmrc out of git so it cannot be committed by an ordinary add", function() {
    var gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    var ignoresNpmrc = gitignore.split(/\r?\n/).some(function(line) {
      return line.trim() === ".npmrc";
    });

    expect(ignoresNpmrc).toBe(true);
  });

  it("should pass its own publish gate", async function() {
    // A committed .npmrc that disarms the lifecycle, or any other regression in the
    // package/lockfile contract, fails here in the fleet's gates even though the
    // developer's own `npm publish` would have skipped prepublishOnly entirely.
    var result = await verifyPackage(ROOT, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(true);
  });

  it("should still refuse a committed .npmrc that disarms the lifecycle", async function() {
    // Negative control: the same gate, pointed at a copy of this package with the one
    // line leviroutes-f9n describes. Without this the first assertion could pass just
    // because .npmrc is never read.
    // A full copy minus the heavy/irrelevant paths: the gate binds every export surface to a
    // file on disk (leviroutes-qubh, leviroutes-j8er) and requires the Jasmine config
    // (leviroutes-f9n), so a manifest-only fixture would fail for the wrong reason.
    fs.cpSync(ROOT, tmp, {
      recursive: true,
      filter: function(source) {
        return !/(^|[\/])(node_modules|\.git|\.beads|\.fleet)$/.test(source);
      }
    });
    fs.writeFileSync(path.join(tmp, ".npmrc"), "ignore-scripts=true\n");

    var result = await verifyPackage(tmp, { exitOnError: false, skipExecution: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ignore-scripts");

    // ...and a harmless committed .npmrc is not a false alarm (leviroutes-ago1).
    fs.writeFileSync(path.join(tmp, ".npmrc"), "ignore-scripts=false\nsave-exact=true\n");
    var allowed = await verifyPackage(tmp, { exitOnError: false, skipExecution: true });

    expect(allowed.ok).toBe(true);
    expect(readJson(path.join(tmp, "package.json")).name).toEqual(readJson(path.join(ROOT, "package.json")).name);
  });
});
