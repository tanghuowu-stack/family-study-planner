import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist-preview");
const source = await readFile(resolve(dist, "index.html"), "utf8");

const stylesheet = source.match(/<link rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);
const moduleScript = source.match(/<script type="module"[^>]+src="([^"]+)"[^>]*><\/script>/);

if (!stylesheet || !moduleScript) {
  throw new Error("找不到构建后的 CSS 或 JavaScript 入口");
}

const assetPath = (value) => resolve(dist, value.replace(/^\.\//, "").replace(/^\//, ""));
const css = await readFile(assetPath(stylesheet[1]), "utf8");
const js = await readFile(assetPath(moduleScript[1]), "utf8");

const html = source
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "")
  .replace(stylesheet[0], () => `<style>${css}</style>`)
  .replace(moduleScript[0], () => `<script type="module">${js.replaceAll("</script>", "<\\/script>")}</script>`);

const output = resolve(root, "小步计划-本地预览.html");
await writeFile(output, html, "utf8");
console.log(output);
