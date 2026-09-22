#!/usr/bin/env node
/**
 * pierfume-core IFRA 合规核查 CLI(独立于 Pi 运行,供开发/CI 使用)。
 * 核查逻辑见 ./ifra-check-core.mjs(Pi 扩展 ifra-check 与本品共用同一实现);
 * 前置结构校验由 ./formula-lint-core.mjs 完成。
 *
 * 用法:
 *   npm run check-ifra                          # 核查默认示例 examples/formula.example.yaml
 *   npm run check-ifra -- path/to/f.yaml        # 核查指定配方(支持绝对路径)
 *   node scripts/ifra-check.mjs --json <file>   # 输出 JSON 报告(默认 Markdown)
 *
 * 退出码:全部合规 → 0;任一违规/错误 → 1。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { checkFormulaIfra, renderMarkdownReport } from "./ifra-check-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
	const args = process.argv.slice(2);
	const json = args.includes("--json");
	const files = args.filter((a) => a !== "--json");
	if (files.length === 0) files.push("examples/formula.example.yaml");

	let anyFail = false;
	for (const file of files) {
		const path = isAbsolute(file) ? file : join(ROOT, file);
		const label = isAbsolute(file) ? file.split(/[\\/]/).pop() : file;

		let raw;
		try {
			raw = readFileSync(path, "utf8");
		} catch (e) {
			console.error(`❌ ${label}: 无法读取文件 — ${e.message}`);
			anyFail = true;
			continue;
		}

		const result = checkFormulaIfra(raw, label);
		if (json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(renderMarkdownReport(result));
		}
		if (!result.ok) anyFail = true;
	}

	process.exit(anyFail ? 1 : 0);
}

main();
