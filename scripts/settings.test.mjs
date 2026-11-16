import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWrite, mergeSettings, readLocalSettings, serializeSettings, validateSettings } from "./lib.mjs";
const configured = () => ({ AUTH_SECRET: "a-stable-example-only-secret-with-more-than-32-characters" });
test("setup generates and preserves a secret", () => {
  const first = mergeSettings({}, {}), second = mergeSettings({}, {}); assert.ok(first.AUTH_SECRET.length >= 32); assert.notEqual(first.AUTH_SECRET, second.AUTH_SECRET); assert.deepEqual(mergeSettings(configured(), {}), configured());
});
test("placeholder is replaced and settings validate", () => {
  assert.ok(!mergeSettings({ AUTH_SECRET: "gere_um_segredo_aleatorio_com_pelo_menos_32_caracteres" }, {}).AUTH_SECRET.startsWith("gere_um_segredo")); assert.throws(() => validateSettings({}), /AUTH_SECRET/); assert.throws(() => validateSettings({ AUTH_SECRET: "short" }), /32/);
});
test("settings round-trip and malformed files fail", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "miniverso-settings-test-")); t.after(() => rm(directory, { recursive: true, force: true })); const path = join(directory, ".dev.vars");
  await atomicWrite(path, serializeSettings(configured())); assert.deepEqual({ ...await readLocalSettings(path) }, configured()); assert.ok(!(await readFile(path, "utf8")).includes("VITE_"));
  for (const malformed of ["not-an-assignment", "AUTH_SECRET='unfinished", "SAME=one\nSAME=two\n"]) { await writeFile(path, malformed); await assert.rejects(readLocalSettings(path), /malformado/); }
});
