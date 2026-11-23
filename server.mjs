import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify as defaultClassify } from "./mock-ai.mjs";

export const TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;
const MAX_BODY_BYTES = 64 * 1024;

const INVALID = { status: "invalid_input" };
const MANUAL = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readText(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Проверка ввода: JSON-объект с непустой строкой text.
export function parseInput(raw) {
  if (raw == null) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (typeof body.text !== "string" || body.text.trim() === "") return null;
  return body.text;
}

// Проверка результата AI: валидный JSON, известная тема, непустой черновик.
export function validateModelOutput(output) {
  if (typeof output !== "string") return null;
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (!TOPICS.has(data.topic)) return null;
  if (typeof data.draft !== "string" || data.draft.trim() === "") return null;
  return { topic: data.topic, draft: data.draft.trim() };
}

async function callModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      classify(text, { signal: controller.signal }),
      new Promise((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function triage(text, { classify = defaultClassify, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  try {
    const result = validateModelOutput(await callModel(classify, text, timeoutMs));
    if (!result) return MANUAL;
    return { status: "ready", ...result };
  } catch {
    return MANUAL;
  }
}

export function createApp({ html, classify = defaultClassify, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html ?? "");
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/triage") {
        return json(response, 404, { status: "not_found" });
      }
      const text = parseInput(await readText(request));
      if (text === null) return json(response, 400, INVALID);
      return json(response, 200, await triage(text, { classify, timeoutMs }));
    } catch {
      if (!response.headersSent) json(response, 500, { status: "server_error" });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const html = await readFile(new URL("./index.html", import.meta.url));
  const port = Number(process.env.PORT || 3000);
  createApp({ html }).listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${port}`);
  });
}
