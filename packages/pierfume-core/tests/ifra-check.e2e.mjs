#!/usr/bin/env node
/**
 * ifra-check 三层测试(合规断言全部派生自已人工核对的 data/ifra-rules.json,见各用例注释;
 * 红线 5:合规断言需人工确认后合入)。
 *
 *   A. 单元 — scripts/ifra-check-core.mjs(确定性,零依赖 pi/网络)
 *   B. CLI  — scripts/ifra-check.mjs(退出码 + --json 输出)
 *   C. E2E  — pi CLI print 模式真实加载 extensions/ifra-check,
 *             断言 /ifra-check 命令分发后的报告标记(需 DEEPSEEK_API_KEY;
 *             PIERFUME_SKIP_PI_E2E=1 或无 key 时跳过)
 *
 * 用法:
 *   npm run test:ifra-check
 *   PIERFUME_SKIP_PI_E2E=1 node tests/ifra-check.e2e.mjs   # 只跑 A+B(离线)
 *
 * 注意:同 formula-lint —— pi print 模式退出码只反映模型调用,扩展输出走 stderr,
 * 故 C 层合并 stdout/stderr 断言报告标记(✅ 合规 / ❌ 不合规)。
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "scripts/ifra-check-core.mjs");
const CLI = join(ROOT, "scripts/ifra-check.mjs");
const PI_CLI = process.env.PI_CLI
	? resolve(process.env.PI_CLI)
	: join(ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");

// 好配方:ok=true,退出码 0
const GOOD = [
	"examples/formula.example.yaml",
	"examples/formula.citrus-cologne.yaml",
	"examples/formula.musk-amber.yaml",
	// 边界:cinnamal 5% × 5 / 100 = 0.25% = Category 4 限量(ifra-cinnamal)→ 恰界合规
	"tests/fixtures/ifra-cat4-cinnamal-boundary-pass.yaml",
	// 提示:linalool/limonene 为 Specification 型 → 仅提示,不判违规
	"tests/fixtures/ifra-spec-notice.yaml",
];
// 坏配方:各命中一类违规(数值依据 data/ifra-rules.json)
const BAD = [
	{ file: "tests/fixtures/ifra-cat1-lilial-prohibited.yaml", ref: "lilial", status: "prohibited", finishedPct: 0.5, limitPct: 0, maxAllowed: 0 },
	{ file: "tests/fixtures/ifra-cat4-lyral-over.yaml", ref: "lyral", status: "over-limit", finishedPct: 0.3, limitPct: 0.2, maxAllowed: 1 },
	{ file: "tests/fixtures/ifra-musk-xylene-prohibited.yaml", ref: "musk-xylene", status: "prohibited", finishedPct: 0.15, limitPct: 0, maxAllowed: 0 },
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
const eq = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- A. 单元:共享核心 ----------
console.log("A. 单元:checkFormulaIfra 共享核心");
const { checkFormulaIfra } = await import(pathToFileURL(CORE).href);
for (const file of GOOD) {
	const r = checkFormulaIfra(readFileSync(join(ROOT, file), "utf8"), file);
	check("A", file, r.ok === true && r.errors.length === 0 && r.violations.length === 0,
		`ok=${r.ok} errors=${r.errors.join(" | ")} violations=${r.violations.length}`);
}
// 边界用例专项:cinnamal 恰在限量上
{
	const f = "tests/fixtures/ifra-cat4-cinnamal-boundary-pass.yaml";
	const r = checkFormulaIfra(readFileSync(join(ROOT, f), "utf8"), f);
	const p = r.passed.find((x) => x.materialRef === "cinnamal");
	check("A", `${f} (cinnamal 0.25=0.25)`,
		!!p && eq(p.finishedPct, 0.25) && eq(p.limitPct, 0.25),
		`passed=${JSON.stringify(p)}`);
}
// 提示用例专项:两条 specification 提示、零违规
{
	const f = "tests/fixtures/ifra-spec-notice.yaml";
	const r = checkFormulaIfra(readFileSync(join(ROOT, f), "utf8"), f);
	const specNotices = r.notices.filter((n) => n.kind === "specification");
	check("A", `${f} (2 specification 提示)`,
		r.ok && specNotices.length === 2 && r.summary.checkedCount === 0,
		`notices=${r.notices.map((n) => n.kind).join(",")} checked=${r.summary.checkedCount}`);
}
for (const { file, ref, status, finishedPct, limitPct, maxAllowed } of BAD) {
	const r = checkFormulaIfra(readFileSync(join(ROOT, file), "utf8"), file);
	const v = r.violations.find((x) => x.materialRef === ref);
	check(
		"A",
		`${file} (${ref} ${status})`,
		r.ok === false && !!v && v.status === status && eq(v.finishedPct, finishedPct) &&
			eq(v.limitPct, limitPct) && eq(v.maxAllowedConcentratePct, maxAllowed),
		`violations=${JSON.stringify(r.violations.map((x) => [x.materialRef, x.status, x.finishedPct, x.limitPct]))}`,
	);
}

// ---------- B. CLI 层 ----------
console.log("B. CLI:ifra-check.mjs");
for (const file of GOOD) {
	const r = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: "utf8" });
	check("B", file, r.status === 0, `status=${r.status} out=${(r.stdout + r.stderr).slice(0, 120)}`);
}
for (const { file, ref } of BAD) {
	const plain = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: "utf8" });
	const asJson = spawnSync(process.execPath, [CLI, "--json", file], { cwd: ROOT, encoding: "utf8" });
	let jsonOk = null;
	try {
		jsonOk = JSON.parse(asJson.stdout).ok;
	} catch {
		jsonOk = null;
	}
	check(
		"B",
		file,
		plain.status === 1 && (plain.stdout + plain.stderr).includes(ref) && jsonOk === false,
		`status=${plain.status} jsonOk=${jsonOk}`,
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
			[PI_CLI, "--offline", "-nt", "-e", "extensions/ifra-check", `/ifra-check ${file}`],
			{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
		);
	for (const file of GOOD) {
		const r = runPi(file);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check(
			"C",
			file,
			out.includes("# IFRA 合规报告") && out.includes("判定:✅ 合规"),
			`out=${out.slice(0, 150)}`,
		);
	}
	for (const { file, ref } of BAD) {
		const r = runPi(file);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check(
			"C",
			file,
			out.includes("# IFRA 合规报告") && out.includes("判定:❌ 不合规") && out.includes(ref),
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
