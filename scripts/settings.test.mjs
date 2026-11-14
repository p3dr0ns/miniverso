import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { atomicWrite, mergeSettings, readLocalSettings, serializeSettings, validateSettings } from "./lib.mjs";

const configured = () => ({
  AUTH_SECRET: "a-stable-example-only-secret-with-more-than-32-characters",
  BREVO_API_KEY: "example-only-key-that-is-never-sent-to-a-provider",
  MAIL_FROM_EMAIL: "sender@example.org",
  MAIL_FROM_NAME: "Miniverso"
});

test("setup generates a random secret once and preserves existing credentials on rerun", () => {
  const first = mergeSettings({}, {});
  const second = mergeSettings({}, {});
  assert.ok(first.AUTH_SECRET.length >= 32);
  assert.notEqual(first.AUTH_SECRET, second.AUTH_SECRET);
  const saved = { ...configured(), OTHER_SETTING: "preserved" };
  assert.deepEqual(mergeSettings(saved, {}), saved);
  assert.throws(() => mergeSettings(saved, { AUTH_SECRET: "different-secret-do-not-rotate" }), /difere/);
});

test("template placeholders are replaced rather than mistaken for configured credentials", () => {
  const settings = mergeSettings({
    AUTH_SECRET: "gere_um_segredo_aleatorio_com_pelo_menos_32_caracteres",
    BREVO_API_KEY: "sua_chave_api_brevo",
    MAIL_FROM_EMAIL: "remetente_verificado@exemplo.com"
  }, {});
  assert.ok(settings.AUTH_SECRET.length >= 32);
  assert.ok(!settings.AUTH_SECRET.startsWith("gere_um_segredo"));
  assert.equal(settings.BREVO_API_KEY, undefined);
  assert.equal(settings.MAIL_FROM_EMAIL, undefined);
});

test("settings serialization round-trips quotes, names and other supported variables", () => {
  for (const name of ["Miniverso", "Coleção João", "D'Pedro", 'Coleção "Miniverso"']) {
    const settings = { ...configured(), MAIL_FROM_NAME: name, OTHER_SETTING: "literal\\path # value" };
    assert.deepEqual(parseEnv(serializeSettings(settings)), settings);
  }
});

test("settings reject missing fields, placeholders and dotenv interpolation before saving", () => {
  for (const key of ["AUTH_SECRET", "BREVO_API_KEY", "MAIL_FROM_EMAIL", "MAIL_FROM_NAME"]) {
    const settings = configured();
    delete settings[key];
    assert.throws(() => validateSettings(settings), new RegExp(key));
  }
  assert.throws(() => validateSettings({ ...configured(), AUTH_SECRET: "too-short" }), /32/);
  assert.throws(() => validateSettings({ ...configured(), MAIL_FROM_EMAIL: "invalid" }), /remetente/);
  assert.throws(() => serializeSettings({ ...configured(), MAIL_FROM_NAME: "$CLOUDFLARE_API_TOKEN" }), /MAIL_FROM_NAME/);
  assert.throws(() => serializeSettings({ ...configured(), MAIL_FROM_NAME: "first\nSECOND=value" }), /MAIL_FROM_NAME/);
});

test("atomic settings writes preserve values and can replace an existing file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "miniverso-settings-test-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("miniverso-settings-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, ".dev.vars");
  assert.deepEqual(await readLocalSettings(path), {});
  await atomicWrite(path, serializeSettings(configured()));
  assert.deepEqual(await readLocalSettings(path), configured());
  const updated = { ...configured(), MAIL_FROM_NAME: "Coleção nova" };
  await atomicWrite(path, serializeSettings(updated));
  assert.deepEqual(await readLocalSettings(path), updated);
  assert.ok(!(await readFile(path, "utf8")).includes("VITE_"));
});

test("malformed or duplicate settings fail before an existing file can be replaced", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "miniverso-settings-test-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("miniverso-settings-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, ".dev.vars");
  for (const malformed of ["not-an-assignment", "AUTH_SECRET='unfinished", "SAME=one\nSAME=two\n"]) {
    await writeFile(path, malformed);
    await assert.rejects(readLocalSettings(path), /malformado/);
    assert.equal(await readFile(path, "utf8"), malformed);
  }
});
