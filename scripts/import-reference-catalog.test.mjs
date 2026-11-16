import test from "node:test";
import assert from "node:assert/strict";
import { prepareCatalog } from "./import-reference-catalog.mjs";

test("reference catalog normalizes Excel scales and preserves code variants", async () => {
  const csv = "nome,fabricante,escala,cor,codigo,ano,linha,serie\nCarro A,Hot Wheels,02:04,Azul,ABC12,2025,Mainline,Série A\nCarro B,Hot Wheels,1:64,Vermelho,ABC12,2026,Premium,Série B\n";
  const result = await prepareCatalog(csv);
  assert.equal(result.sourceRows, 2);
  assert.equal(result.byCode.size, 1);
  assert.equal(result.byCode.get("ABC12")[0].scale, "1:64");
  assert.equal(result.byCode.get("ABC12").length, 2);
});
