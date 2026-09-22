import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI_CLI = join(ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");
const file = "examples/formula.example.yaml";

const r = spawnSync(
	process.execPath,
	[PI_CLI, "--offline", "-nt", "-e", "extensions/formula-lint", `/formula-lint ${file}`],
	{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
);

const needle = `✅ ${file}: 通过 (`;
const h = r.stdout ?? "";
console.log("typeof stdout:", typeof r.stdout, "len:", h.length);
console.log("includes:", h.includes(needle));
console.log("haystack JSON:", JSON.stringify(h.slice(0, 80)));
const idx = h.indexOf(": 通过");
console.log("idx of ': 通过':", idx);
if (idx >= 0) {
	const region = h.slice(idx - 5, idx + 12);
	console.log("region JSON:", JSON.stringify(region));
	console.log("region codepoints:", [...region].map((c) => c.codePointAt(0).toString(16)).join(" "));
}
console.log("needle codepoints:", [...needle].map((c) => c.codePointAt(0).toString(16)).join(" "));
console.log("stderr JSON:", JSON.stringify((r.stderr ?? "").slice(0, 100)));
