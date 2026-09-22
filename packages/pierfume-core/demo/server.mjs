#!/usr/bin/env node
/**
 * Pierfume Demo 本地服务器(D5 demo 的 GUI 形态)。
 *
 * 零依赖(node:http),仅监听 127.0.0.1。两类能力:
 *   1. 配方校验(本地、秒回):写临时文件 → 调 validate-formula.mjs / ifra-check.mjs(共享核心)
 *   2. brief → 配方生成(走 pi CLI,与已验证的手动 demo 同一条链路):
 *      pi --offline -p,Agent 读原料库 → 写 formula.yaml → 强制 formula_lint + ifra_check 工具
 *      服务端再用 CLI 独立复验,结果一并返回(不采信模型自述)
 *
 * 用法:
 *   node demo/server.mjs [port]        # 默认 3210,启动后浏览器打开 http://127.0.0.1:3210
 *
 * 目录:
 *   demo/public/    前端静态文件
 *   demo/workspace/ 生成/校验的临时配方(已 gitignore)
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { checkFormulaIfra, renderMarkdownReport } from "../scripts/ifra-check-core.mjs";
import { diffFormulas, renderMarkdownDiff } from "../scripts/formula-diff-core.mjs";

const DEMO_ROOT = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(DEMO_ROOT, "..");
const PUBLIC_DIR = join(DEMO_ROOT, "public");
const WORKSPACE = join(DEMO_ROOT, "workspace");
const LIBRARY = join(WORKSPACE, "library");
const PI_CLI = join(PKG_ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");
const MATERIALS_JSON = join(PKG_ROOT, "data/materials.sample.json");
const VALIDATE_CLI = join(PKG_ROOT, "scripts/validate-formula.mjs");
const IFRA_CLI = join(PKG_ROOT, "scripts/ifra-check.mjs");
const GENERATE_TIMEOUT_MS = 420_000;

const PORT = Number(process.argv[2]) || Number(process.env.PIERFUME_DEMO_PORT) || 3210;

mkdirSync(LIBRARY, { recursive: true });

// ------------------------------------------------------------------
// 工具:本地校验(CLI 复用,独立于 pi/模型)
// ------------------------------------------------------------------
function runValidators(yamlPath) {
	const lint = spawnSync(process.execPath, [VALIDATE_CLI, yamlPath], { encoding: "utf8" });
	const ifraRun = spawnSync(process.execPath, [IFRA_CLI, "--json", yamlPath], { encoding: "utf8" });
	let ifraJson = null;
	try {
		ifraJson = JSON.parse(ifraRun.stdout);
	} catch {
		ifraJson = null;
	}
	return {
		lint: { code: lint.status, output: (lint.stdout + lint.stderr).trim() },
		ifra: {
			code: ifraRun.status,
			json: ifraJson,
			markdown: ifraJson ? renderMarkdownReport(ifraJson) : (ifraRun.stdout + ifraRun.stderr).trim(),
		},
	};
}

// ------------------------------------------------------------------
// 生成任务(brief → pi CLI → 独立复验)
// ------------------------------------------------------------------
const jobs = new Map();

function logTail(path, max = 6000) {
	try {
		const buf = readFileSync(path);
		return buf.subarray(Math.max(0, buf.length - max)).toString("utf8");
	} catch {
		return "";
	}
}

function startGenerateJob({ brief, category, useLevelPct }) {
	const id = randomUUID().slice(0, 8);
	const jobDir = join(WORKSPACE, `job-${id}`);
	mkdirSync(jobDir, { recursive: true });
	const formulaPath = join(jobDir, "formula.yaml");
	const logPath = join(jobDir, "pi.log");
	jobs.set(id, { status: "running", dir: jobDir });

	const prompt =
		`你是调香师副驾驶。任务:为客户 brief『${brief}』设计香精配方。硬性要求:` +
		`1) 先读 ${MATERIALS_JSON.replace(/\\/g, "/")},配方只能使用其中已存在的原料 id 作为 materialRef(禁止编造);` +
		`2) 产品 Category ${category},香精添加量 ${useLevelPct}%;` +
		`3) 在当前目录创建 formula.yaml(各 pct 合计 100);` +
		`4) 创建后必须依次调用 formula_lint 和 ifra_check 两个工具校验,若不通过则修正配方直至通过;` +
		`5) 两个工具都通过后,把 meta.status 改为 approved;` +
		`6) 最后一句话给出合规结论。`;

	const logFd = openSync(logPath, "w");
	const child = spawn(process.execPath, [PI_CLI, "--offline", "-p", prompt], {
		cwd: jobDir,
		stdio: ["ignore", logFd, logFd],
	});
	const killer = setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {}
	}, GENERATE_TIMEOUT_MS);
	child.on("close", (code) => {
		clearTimeout(killer);
		closeSync(logFd);
		const job = jobs.get(id);
		if (!existsSync(formulaPath)) {
			job.status = "failed";
			job.error = `pi 退出码 ${code},且未生成 formula.yaml`;
			job.logTail = logTail(logPath);
			return;
		}
		const yaml = readFileSync(formulaPath, "utf8");
		job.status = "done";
		job.result = { yaml, piExitCode: code, ...runValidators(formulaPath), logTail: logTail(logPath) };
	});
	return id;
}

// ------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function send(res, status, body, type = "application/json; charset=utf-8") {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 256 * 1024) {
	return new Promise((resolvePromise, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > limit) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const path = url.pathname;

	try {
		// ---- 静态前端 ----
		if (req.method === "GET" && (path === "/" || path === "/index.html")) {
			return send(res, 200, readFileSync(join(PUBLIC_DIR, "index.html"), "utf8"), MIME[".html"]);
		}
		if (req.method === "GET" && path.startsWith("/static/")) {
			const rel = normalize(path.slice("/static/".length)).replace(/^(\.\.[/\\])+/, "");
			const file = join(PUBLIC_DIR, rel);
			if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) return send(res, 404, { error: "not found" });
			return send(res, 200, readFileSync(file, "utf8"), MIME[extname(file)] ?? "text/plain; charset=utf-8");
		}

		// ---- 原料/示例(只读白名单)----
		if (req.method === "GET" && path === "/api/materials") {
			const materials = JSON.parse(readFileSync(MATERIALS_JSON, "utf8")).map((m) => ({
				id: m.id, name: m.name, cas: m.cas, family: m.family, note: m.note, odor: m.odor,
				ifra: Boolean(m.ifraEntryRef),
			}));
			return send(res, 200, { materials });
		}
		if (req.method === "GET" && path === "/api/example") {
			const name = url.searchParams.get("name") ?? "";
			if (!/^(formula\.[a-z-]+\.yaml|diff-v2\.yaml)$/.test(name)) return send(res, 400, { error: "bad name" });
			const candidates = [join(PKG_ROOT, "examples", name), join(PKG_ROOT, "tests/fixtures", name)];
			const file = candidates.find((c) => existsSync(c));
			if (!file) return send(res, 404, { error: "not found" });
			return send(res, 200, { yaml: readFileSync(file, "utf8") });
		}

		// ---- 校验(本地)----
		if (req.method === "POST" && path === "/api/validate") {
			const { yaml } = JSON.parse(await readBody(req));
			if (typeof yaml !== "string" || !yaml.trim()) return send(res, 400, { error: "yaml required" });
			const file = join(WORKSPACE, `validate-${Date.now()}-${randomUUID().slice(0, 6)}.yaml`);
			writeFileSync(file, yaml, "utf8");
			try {
				return send(res, 200, runValidators(file));
			} finally {
				rmSync(file, { force: true });
			}
		}

		// ---- 对比(本地)----
		if (req.method === "POST" && path === "/api/diff") {
			const { yamlA, yamlB } = JSON.parse(await readBody(req));
			if (typeof yamlA !== "string" || typeof yamlB !== "string") return send(res, 400, { error: "yamlA/yamlB required" });
			const result = diffFormulas(yamlA, yamlB, { labelA: "A", labelB: "B" });
			return send(res, 200, { ...result, markdown: renderMarkdownDiff(result, { labelA: "A", labelB: "B" }) });
		}

		// ---- 配方库(生成结果留存)----
		if (req.method === "GET" && path === "/api/library") {
			const names = readdirSync(LIBRARY).filter((f) => f.endsWith(".yaml")).sort();
			return send(res, 200, { files: names });
		}
		if (req.method === "GET" && path === "/api/library-file") {
			const name = url.searchParams.get("name") ?? "";
			if (!/^[A-Za-z0-9_-]+\.yaml$/.test(name)) return send(res, 400, { error: "bad name" });
			const file = join(LIBRARY, name);
			if (!existsSync(file)) return send(res, 404, { error: "not found" });
			return send(res, 200, { yaml: readFileSync(file, "utf8") });
		}
		if (req.method === "POST" && path === "/api/library") {
			const { name, yaml } = JSON.parse(await readBody(req));
			if (typeof yaml !== "string" || !yaml.trim()) return send(res, 400, { error: "yaml required" });
			const safe = typeof name === "string" && /^[A-Za-z0-9_-]+\.yaml$/.test(name) ? name : `formula-${Date.now()}.yaml`;
			writeFileSync(join(LIBRARY, safe), yaml, "utf8");
			return send(res, 200, { name: safe });
		}

		// ---- 生成(brief → pi)----
		if (req.method === "POST" && path === "/api/generate") {
			const body = JSON.parse(await readBody(req));
			const brief = String(body.brief ?? "").trim().slice(0, 500);
			const category = String(body.category ?? "4");
			const useLevelPct = Number(body.useLevelPct ?? 5);
			if (!brief) return send(res, 400, { error: "brief required" });
			if (!/^\d{1,2}[A-D]?$/.test(category)) return send(res, 400, { error: "bad category" });
			if (!(useLevelPct > 0 && useLevelPct <= 100)) return send(res, 400, { error: "bad useLevelPct" });
			const id = startGenerateJob({ brief, category, useLevelPct });
			return send(res, 202, { id });
		}
		if (req.method === "GET" && path.startsWith("/api/job/")) {
			const id = path.slice("/api/job/".length);
			const job = jobs.get(id);
			if (!job) return send(res, 404, { error: "no such job" });
			return send(res, 200, job);
		}

		send(res, 404, { error: "not found" });
	} catch (e) {
		send(res, 500, { error: e instanceof Error ? e.message : String(e) });
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`Pierfume demo → http://127.0.0.1:${PORT}`);
});
