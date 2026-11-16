import test from "node:test";
import assert from "node:assert/strict";
import { parseYear } from "./validate-wiki-catalog.mjs";

test("wiki catalog parser associates code, model, series and image", () => {
  const html = `<h2>HW Workshop <span>[ ]</span></h2><table><tr><td>CFJ00</td><td>214</td><td><a>'63 Studebaker Champ</a></td><td>Heat Fleet</td><td><img data-src="https://static.wikia.nocookie.net/hotwheels/images/c/c8/studebaker.jpg/revision/latest/scale-to-width-down/75?cb=1"></td></tr></table>`;
  const [item] = parseYear(html, 2015);
  assert.equal(item.code, "CFJ00"); assert.equal(item.name, "'63 Studebaker Champ"); assert.equal(item.category, "HW Workshop"); assert.equal(item.series, "Heat Fleet"); assert.equal(item.seriesNumber, "214/250"); assert.match(item.photo, /studebaker\.jpg\/revision\/latest\?cb=1$/);
});
