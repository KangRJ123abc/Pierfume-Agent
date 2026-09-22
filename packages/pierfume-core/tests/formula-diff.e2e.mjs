#!/usr/bin/env node
/**
 * formula-diff + 项目禁限用清单 三层测试。
 *   A. 单元 — scripts/formula-diff-core.mjs / formula-lint-core.mjs(确定性)
 *   B. CLI  — scripts/formula-diff.mjs / validate-formula.mjs(退出码 + 输出)
 *   C. E2E  — pi CLI print 模式真实加载 extensions(需 DEEPSEEK_API_KEY;
 *             PIERFUME_SKIP_PI_E2E=1 或无 key 时跳过)
 *
 * 用例(结构断言,无合规数值断言):
 *   diff:citrus-cologne vs tests/fixtures/diff-v2.yaml
 *     → 调整 2(limonene -5、ethanol +0.5)/ 新增 1(benzyl-salicylate)/ 移除 1(vanillin)/ 未变 6
 *   banned:tests/fixtures/project-banned/ 下 pierfume.project.json 禁 coumarin
 *     → 同一份 formula.yaml 在该 cwd 判违规,在包根(无项目文件)通过
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIFF_CORE = join(ROOT, "scripts/formula-diff-core.mjs");
const LINT_CORE = join(ROOT, "scripts/formula-lint-core.mjs");
const DIFF_CLI = join(ROOT, "scripts/formula-diff.mjs");
const LINT_CLI = join(ROOT, "scripts/validate-formula.mjs");
const PI_CLI = process.env.PI_CLI ? resolve(process.env.PI_CLI) : join(ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");

const FILE_A = "examples/formula.citrus-cologne.yaml";
const FILE_B = "tests/fixtures/diff-v2.yaml";
const BANNED_DIR = join(ROOT, "tests/fixtures/project-banned");
const BANNED_FORMULA_ABS = join(BANNED_DIR, "formula.yaml");

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

// ---------- A. 单元 ----------
console.log("A. 单元:diffFormulas + lintFormulaYaml(project)");
const { diffFormulas } = await import(pathToFileURL(DIFF_CORE).href);
const { lintFormulaYaml, loadProjectRules } = await import(pathToFileURL(LINT_CORE).href);

const rawA = readFileSync(join(ROOT, FILE_A), "utf8");
const rawB = readFileSync(join(ROOT, FILE_B), "utf8");
{
	const r = diffFormulas(rawA, rawB, { labelA: FILE_A, labelB: FILE_B });
	const lim = r.changed.find((c) => c.materialRef === "limonene");
	const eth = r.changed.find((c) => c.materialRef === "ethanol");
	check(
		"A",
		"diff 结构(citrus vs v2)",
		r.ok === true &&
			r.changed.length === 2 && !!lim && eq(lim.delta, -5) && !!eth && eq(eth.delta, 0.5) &&
			r.added.length === 1 && r.added[0].materialRef === "benzyl-salicylate" &&
			r.removed.length === 1 && r.removed[0].materialRef === "vanillin" &&
			r.unchangedCount === 6,
		`changed=${JSON.stringify(r.changed)} added=${JSON.stringify(r.added)} removed=${JSON.stringify(r.removed)}`,
	);
	check(
		"A",
		"diff 合规摘要(两版均合规)",
		r.compliance && r.compliance.a.ok === true && r.compliance.b.ok === true &&
			r.compliance.newViolationsInB.length === 0 && r.compliance.resolvedViolations.length === 0,
		`compliance=${JSON.stringify(r.compliance)}`,
	);
}
{
	// 坏版无法对比:bad-sum 与 citrus 对比 → ok=false,errors 非空
	const r = diffFormulas(rawA, readFileSync(join(ROOT, "tests/fixtures/bad-sum.yaml"), "utf8"), { labelA: "a", labelB: "bad" });
	check("A", "坏版拒绝对比", r.ok === false && r.errors.some((e) => e.includes("bad")), `errors=${r.errors.join("|")}`);
}
{
	const yaml = readFileSync(BANNED_FORMULA_ABS, "utf8");
	const banned = loadProjectRules(BANNED_DIR);
	check("A", "loadProjectRules 读到 banned", banned.bannedMaterials.includes("coumarin"), `rules=${JSON.stringify(banned)}`);
	const hit = lintFormulaYaml(yaml, "f", banned);
	const clean = lintFormulaYaml(yaml, "f", { bannedMaterials: [] });
	check(
		"A",
		"banned 命中判违规 / 无项目规则通过",
		hit.ok === false && hit.errors.some((e) => e.includes('禁限用清单命中: "coumarin"')) && clean.ok === true,
		`hit=${hit.errors.join("|")}`,
	);
}

// ---------- B. CLI ----------
console.log("B. CLI:formula-diff.mjs / validate-formula.mjs");
{
	const r = spawnSync(process.execPath, [DIFF_CLI, FILE_A, FILE_B], { cwd: ROOT, encoding: "utf8" });
	const out = r.stdout + r.stderr;
	check(
		"B",
		"diff CLI 退出 0 且含变更行",
		r.status === 0 && out.includes("| limonene | 30 | 25 | -5 |") && out.includes("## 合规差异"),
		`status=${r.status}`,
	);
}
{
	const inDir = spawnSync(process.execPath, [LINT_CLI, "tests/fixtures/project-banned/formula.yaml"], { cwd: BANNED_DIR, encoding: "utf8" });
	const inRoot = spawnSync(process.execPath, [LINT_CLI, "tests/fixtures/project-banned/formula.yaml"], { cwd: ROOT, encoding: "utf8" });
	check(
		"B",
		"banned:项目 cwd 判违规 / 包根通过",
		inDir.status === 1 && (inDir.stdout + inDir.stderr).includes("禁限用清单命中") && inRoot.status === 0,
		`inDir=${inDir.status} inRoot=${inRoot.status}`,
	);
}

// ---------- C. E2E ----------
const SKIP_E2E = process.env.PIERFUME_SKIP_PI_E2E === "1" || !process.env.DEEPSEEK_API_KEY;
if (SKIP_E2E) {
	console.log(`C. E2E:跳过(${process.env.PIERFUME_SKIP_PI_E2E === "1" ? "PIERFUME_SKIP_PI_E2E=1" : "缺 DEEPSEEK_API_KEY"})`);
} else {
	console.log("C. E2E:pi CLI 真实加载扩展");
	const baseArgs = ["--offline", "-nt", "--no-session"];
	{
		const r = spawnSync(
			process.execPath,
			[PI_CLI, ...baseArgs, "-e", "extensions/formula-lint", `/formula-diff ${FILE_A} ${FILE_B}`],
			{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
		);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check(
			"C",
			"/formula-diff 命令分发",
			out.includes("# 配方对比") && out.includes("| limonene | 30 | 25 | -5 |"),
			`out=${out.slice(0, 150)}`,
		);
	}
	{
		const r = spawnSync(
			process.execPath,
			[PI_CLI, ...baseArgs, "-e", join(ROOT, "extensions/formula-lint"), `/formula-lint ${BANNED_FORMULA_ABS}`],
			{ cwd: BANNED_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
		);
		const out = (r.stdout ?? "") + (r.stderr ?? "");
		check(
			"C",
			"/formula-lint 命中项目禁限用清单",
			out.includes("禁限用清单命中"),
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
