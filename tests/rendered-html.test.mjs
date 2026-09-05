import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta = /<meta[^>]*\bname=["']codex-preview["'][^>]*>/i;
const publicWorkerUrl = "https://reveryx-studio.tjfalkahn.workers.dev";

test("renders public sharing metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<meta[^>]*\bproperty=["']og:title["'][^>]*>/i);
  assert.match(html, /<meta[^>]*\bproperty=["']og:image["'][^>]*>/i);
  assert.match(html, new RegExp(publicWorkerUrl.replaceAll(".", "\\.")));
  assert.match(html, /What do you want/i);
  assert.match(html, /to do right now\?/i);
});
