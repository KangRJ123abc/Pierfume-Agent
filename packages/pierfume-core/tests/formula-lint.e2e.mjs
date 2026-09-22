#!/usr/bin/env node
/**
 * formula-lint 三层测试(3 个好配方 + 5 个坏夹具,各注入一类错误):
 *   A. 单元 — scripts/formula-lint-core.mjs 共享核心(确定性,零依赖 pi/网络)
 *   B. CLI  — scripts/validate-formula.mjs(退出码 + 错误签名)
 *   C. E2E  — pi CLI print 模式真实加载 extensions/formula-lint,
 *             断言 /formula-lint 命令分发后的确定性输出(需 DEEPSEEK_API_KEY;
 *             PIERFUME_SKIP_PI_E2E=1 或无 key 时跳过)
 *
 * 用法:
 *   npm run test:formula-lint
 *   PIERFUME_SKIP_PI_E2E=1 node tests/formula-lint.e2e.mjs   # 只跑 A+B(离线)
 *
 * 注意:pi CLI print 模式下进程退出码只反映模型调用是否成功,不反映校验结果,
 * 故 C 层断言扩展输出标记(✅/❌ + 错误签名),不断言退出码;
 * 且扩展 console.log 的行在 print 模式下走 stderr(stdout 留给模型最终答复),故合并两流断言。
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "scripts/formula-lint-core.mjs");
const CLI = join(ROOT, "scripts/validate-formula.mjs");
const PI_CLI = process.env.PI_CLI
	? resolve(process.env.PI_CLI)
	: join(ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");

const GOOD = [
	"examples/formula.example.yaml",
	"examples/formula.citrus-cologne.yaml",
	"examples/formula.musk-amber.yaml",
];
const BAD = [
	{ file: "tests/fixtures/bad-unknown-material.yaml", marker: '引用的原料不存在: "iso-e-super"' },
	{ file: "tests/fixtures/bad-duplicate.yaml", marker: '原料重复出现: "hedione"' },
	{ file: "tests/fixtures/bad-category-number.yaml", marker: "期望类型 string,实际 number" },
	{ file: "tests/fixtures/bad-sum.yaml", marker: "剂量合计 80.00%" },
	{ file: "tests/fixtures/bad-syntax.yaml", marker: "YAML 解析失败" },
];

let pass = 0;
let fail = 0;
const failures = [];
function check(layer, name, cond, detail = "") {
	if (cond) {
		pass++;
		console.log(`  ✓ [${layer}] ${name}`);
	} else {
		fail++;
		failures.push(`[${layer}] ${name} ${detail}`);
		console.log(`  ✗ [${layer}] ${name} ${detail}`);
	}
}

// ---------- A. 单元:共享核心 ----------
console.log("A. 单元:lintFormulaYaml 共享核心");
const { lintFormulaYaml } = await import(pathToFileURL(CORE).href);
for (const file of GOOD) {
	const r = lintFormulaYaml(readFileSync(join(ROOT, file), "utf8"), file);
	check("A", file, r.ok === true && r.ingredientCount > 0, r.ok ? "" : `errors=${JSON.stringify(r.errors)}`);
}
for (const { file, marker } of BAD) {
	const r = lintFormulaYaml(readFileSync(join(ROOT, file), "utf8"), file);
	check(
		"A",
		file,
		r.ok === false && r.errors.join("\n").includes(marker),
		`errors=${r.errors.join(" | ").slice(0, 120)}`,
	);
}

// ---------- B. CLI 层 ----------
console.log("B. CLI:validate-formula.mjs");
for (const file of GOOD) {
	const r = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: "utf8" });
	check("B", file, r.status === 0, `status=${r.status} out=${(r.stdout + r.stderr).slice(0, 120)}`);
}
for (const { file, marker } of BAD) {
	const r = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: "utf8" });
	check(
		"B",
		file,
		r.status === 1 && (r.stdout + r.stderr).includes(marker),
		`status=${r.status} out=${(r.stdout + r.stderr).slice(0, 120)}`,
	);
}

// ---------- C. E2E:pi CLI 真实加载扩展 ----------
const SKIP_E2E = process.env.PIERFUME_SKIP_PI_E2E === "1" || !process.env.DEEPSEEK_API_KEY;
if (SKIP_E2E) {
	console.log(`C. E2E:跳过(${process.env.PIERFUME_SKIP_PI_E2E === "1" ? "PIERFUME_SKIP_PI_E2E=1" : "缺 DEEPSEEK_API_KEY"})`);
} else {
	console.log("C. E2E:pi CLI print 模式加载扩展(命令分发)");
	const runPi = (file) =>
		spawnSync(
			process.execPath,
			[PI_CLI, "--offline", "-nt", "-e", "extensions/formula-lint", `/formula-lint ${file}`],
			{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
		);
	for (const file of GOOD) {
		const r = runPi(file);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check("C", file, out.includes(`✅ ${file}: 通过 (`), `out=${out.slice(0, 150)}`);
	}
	for (const { file, marker } of BAD) {
		const r = runPi(file);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check(
			"C",
			file,
			out.includes(`❌ ${file}:`) && out.includes(marker),
			`out=${out.slice(0, 150)}`,
		);
	}
}

console.log(`\n结果:${pass} 通过,${fail} 失败`);
if (fail) {
	console.log("失败项:");
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
