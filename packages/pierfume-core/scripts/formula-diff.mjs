#!/usr/bin/env node
/**
 * pierfume-core 配方对比 CLI(独立于 Pi 运行)。
 * 逻辑见 ./formula-diff-core.mjs(与 Pi 扩展共用同一实现)。
 *
 * 用法:
 *   npm run diff-formula -- <old.yaml> <new.yaml> [--markdown]
 *   node scripts/formula-diff.mjs old.yaml new.yaml     # 默认 Markdown 报告
 *
 * 退出码:两版均可对比(过 lint)→ 0;否则 1。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { diffFormulas, renderMarkdownDiff } from "./formula-diff-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
	const args = process.argv.slice(2).filter((a) => a !== "--markdown");
	if (args.length < 2) {
		console.error("用法:node scripts/formula-diff.mjs <old.yaml> <new.yaml>");
		process.exit(2);
	}
	const [fileA, fileB] = args;
	const resolvePath = (f) => (isAbsolute(f) ? f : join(ROOT, f));
	const labelOf = (f) => (isAbsolute(f) ? f.split(/[\\/]/).pop() : f);

	const result = diffFormulas(readFileSync(resolvePath(fileA), "utf8"), readFileSync(resolvePath(fileB), "utf8"), {
		labelA: labelOf(fileA),
		labelB: labelOf(fileB),
	});
	console.log(renderMarkdownDiff(result, { labelA: labelOf(fileA), labelB: labelOf(fileB) }));
	process.exit(result.ok ? 0 : 1);
}

main();
