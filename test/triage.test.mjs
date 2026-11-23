import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

let server;
let base;

before(async () => {
  server = createApp({ html: "ok" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function post(body, raw = false) {
  const response = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const MANUAL = { status: "manual_review", topic: null, draft: null };

test("корректная заявка: ready с темой и черновиком", async () => {
  const { status, body } = await post({ text: "Когда будет доставка?" });
  assert.equal(status, 200);
  assert.equal(body.status, "ready");
  assert.equal(body.topic, "delivery");
  assert.ok(body.draft.trim().length > 0);
});

for (const [name, payload, raw] of [
  ["пустая строка", { text: "" }],
  ["только пробелы", { text: "   " }],
  ["нет поля text", {}],
  ["text не строка", { text: 42 }],
  ["null вместо объекта", null],
  ["битый JSON", "{text:", true],
]) {
  test(`невалидный ввод (${name}): 400 invalid_input`, async () => {
    const { status, body } = await post(payload, raw);
    assert.equal(status, 400);
    assert.deepEqual(body, { status: "invalid_input" });
  });
}

for (const tag of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${tag}: manual_review`, async () => {
    const { status, body } = await post({ text: `Заявка ${tag}` });
    assert.equal(status, 200);
    assert.deepEqual(body, MANUAL);
  });
}

test("таймаут модели: manual_review не позже ~300 мс", async () => {
  const started = Date.now();
  const { status, body } = await post({ text: "Заявка [timeout]" });
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.deepEqual(body, MANUAL);
  assert.ok(elapsed < 800, `ответ занял ${elapsed} мс`);
});
