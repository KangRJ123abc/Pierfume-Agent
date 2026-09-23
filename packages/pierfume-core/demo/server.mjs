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
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, rmSync, readdirSync, appendFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { checkFormulaIfra, renderMarkdownReport, computeHeadroom } from "../scripts/ifra-check-core.mjs";
import { diffFormulas, renderMarkdownDiff } from "../scripts/formula-diff-core.mjs";
import { lintFormulaYaml } from "../scripts/formula-lint-core.mjs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const DEMO_ROOT = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(DEMO_ROOT, "..");
const PUBLIC_DIR = join(DEMO_ROOT, "public");
const WORKSPACE = join(DEMO_ROOT, "workspace");
const LIBRARY = join(WORKSPACE, "library");
const CHATS_DIR = join(WORKSPACE, "chats");
const PI_CLI = join(PKG_ROOT, "../../pi/packages/coding-agent/dist/bundle/cli.js");
const MATERIALS_JSON = join(PKG_ROOT, "data/materials.sample.json");
const VALIDATE_CLI = join(PKG_ROOT, "scripts/validate-formula.mjs");
const IFRA_CLI = join(PKG_ROOT, "scripts/ifra-check.mjs");
const GENERATE_TIMEOUT_MS = 420_000;
// 聊天会话的工具白名单:危险内置工具(write/edit/bash)一律排除,
// 数据写入只能走受审的 formula_save(内部有 ctx.ui.confirm 审批门)
const CHAT_TOOLS = "read,material_get,formula_get,material_alternatives,formula_save,formula_lint,ifra_check,ifra_headroom,formula_diff,material_add,material_update,formula_heatmap";

const PORT = Number(process.argv[2]) || Number(process.env.PIERFUME_DEMO_PORT) || 3210;

mkdirSync(LIBRARY, { recursive: true });
mkdirSync(CHATS_DIR, { recursive: true });

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
// 原料映射(列表/详情共用;cid/cas 可缺,统一给 null)
// ------------------------------------------------------------------
function mapMaterial(m) {
	return {
		id: m.id, name: m.name, cid: m.cid ?? null, cas: m.cas ?? null,
		family: m.family ?? [], note: m.note ?? null, odor: m.odor ?? null,
		ifraEntryRef: m.ifraEntryRef ?? null,
		humanVerified: Boolean(m.provenance?.humanVerified),
		ifra: Boolean(m.ifraEntryRef), // 兼容旧前端(调色板 chip 的 * 标记)
	};
}

function loadMaterialsFile() {
	return JSON.parse(readFileSync(MATERIALS_JSON, "utf8"));
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
// 聊天子系统:pi --mode rpc 子进程 + SSE 推送 + 审批桥(extension_ui 协议)
//   - 每个会话一个 pi RPC 进程,cwd=workspace/chats/<id>/(会话文件与配方写入都在此)
//   - 事件持久化到 ui-events.jsonl(seq 递增),SSE 支持 since=seq 断点续传
//   - 审批:扩展工具内 ctx.ui.confirm/select/input → extension_ui_request →
//     前端弹层 → POST /api/chat/respond → extension_ui_response
// ------------------------------------------------------------------
const chats = new Map(); // id → chat

function chatLog(chat, rec) {
	chat.seq++;
	const full = { seq: chat.seq, ...rec };
	appendFileSync(chat.eventFile, JSON.stringify(full) + "\n");
	return full;
}

function broadcast(chat, rec) {
	const payload = `data: ${JSON.stringify(rec)}\n\n`;
	for (const res of chat.sse) {
		try {
			res.write(payload);
		} catch {
			chat.sse.delete(res);
		}
	}
}

function attachJsonlReader(stream, onLine) {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
		while (true) {
			const i = buffer.indexOf("\n");
			if (i === -1) break;
			let line = buffer.slice(0, i);
			buffer = buffer.slice(i + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.trim()) onLine(line);
		}
	});
	stream.on("end", () => {
		buffer += decoder.end();
		if (buffer.trim()) onLine(buffer);
	});
}

function spawnChat(id, { resume }) {
	const dir = join(CHATS_DIR, id);
	mkdirSync(dir, { recursive: true });
	const args = [
		PI_CLI, "--mode", "rpc", "--offline",
		"--model", "deepseek-flash",
		"--session-dir", dir,
		"--tools", CHAT_TOOLS,
		"-e", join(PKG_ROOT, "extensions/formula-lint"),
		"-e", join(PKG_ROOT, "extensions/ifra-check"),
		"-e", join(PKG_ROOT, "extensions/data-admin"),
	];
	if (resume) args.push("--continue");
	const proc = spawn(process.execPath, args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
	const chat = {
		id, dir, proc,
		createdAt: Date.now(), name: "",
		seq: 0, eventFile: join(dir, "ui-events.jsonl"),
		sse: new Set(), busy: false, dead: false,
	};
	proc.on("exit", (code) => {
		chat.dead = true;
		broadcast(chat, { type: "chat_dead", code });
	});
	proc.stderr.on("data", () => {});
	attachJsonlReader(proc.stdout, (line) => {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (event.type === "agent_settled") chat.busy = false;
		if (event.type === "agent_start") chat.busy = true;
		broadcast(chat, chatLog(chat, { type: "event", event }));
	});
	chats.set(id, chat);
	return chat;
}

function chatCmd(chat, cmd) {
	try {
		chat.proc.stdin.write(JSON.stringify(cmd) + "\n");
	} catch {
		/* 进程已退出 */
	}
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
			return send(res, 200, { materials: loadMaterialsFile().map(mapMaterial) });
		}
		if (req.method === "GET" && path === "/api/material") {
			const id = url.searchParams.get("id") ?? "";
			if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return send(res, 400, { error: "bad id" });
			const m = loadMaterialsFile().find((x) => x.id === id);
			if (!m) return send(res, 404, { error: "not found" });
			return send(res, 200, { material: mapMaterial(m) });
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
			const names = existsSync(LIBRARY) ? readdirSync(LIBRARY).filter((f) => f.endsWith(".yaml")).sort() : [];
			const recipes = names.map((file) => {
				const base = {
					file,
					meta: { id: null, name: file, version: "?", status: "?", accord: null },
					pyramid: null, ingredientCount: 0, lintOk: false,
				};
				try {
					const raw = readFileSync(join(LIBRARY, file), "utf8");
					const doc = parseYaml(raw);
					const lint = lintFormulaYaml(raw, file);
					return {
						file,
						meta: {
							id: doc?.meta?.id ?? null, name: doc?.meta?.name ?? file,
							version: doc?.meta?.version ?? "?", status: doc?.meta?.status ?? "?",
							accord: doc?.meta?.accord ?? null,
						},
						pyramid: doc?.pyramid ?? null,
						ingredientCount: Array.isArray(doc?.formula) ? doc.formula.length : 0,
						lintOk: lint.ok,
					};
				} catch (e) {
					return { ...base, error: e instanceof Error ? e.message : String(e) };
				}
			});
			return send(res, 200, { files: names, recipes });
		}
		// 配方详情:meta/product/pyramid + 原料表(解析名称/CID/香型)+ lint 结果;file 限定在库目录内
		if (req.method === "GET" && path === "/api/formula") {
			const name = url.searchParams.get("file") ?? "";
			if (!/^[A-Za-z0-9_-]+\.yaml$/.test(name)) return send(res, 400, { error: "bad file" });
			const file = join(LIBRARY, name);
			if (!file.startsWith(LIBRARY) || !existsSync(file)) return send(res, 404, { error: "not found" });
			const raw = readFileSync(file, "utf8");
			const doc = parseYaml(raw) ?? {};
			const matById = new Map(loadMaterialsFile().map((m) => [m.id, m]));
			const ingredients = (Array.isArray(doc.formula) ? doc.formula : []).map((ing) => {
				const m = matById.get(ing?.materialRef);
				return {
					materialRef: ing?.materialRef ?? "?", pct: ing?.pct ?? null,
					name: m?.name ?? null, cid: m?.cid ?? null,
					family: m?.family ?? [], note: m?.note ?? null, odor: m?.odor ?? null,
				};
			});
			const lint = lintFormulaYaml(raw, name);
			return send(res, 200, {
				file: name, meta: doc.meta ?? {}, product: doc.product ?? {},
				pyramid: doc.pyramid ?? null, ingredients,
				lint: { ok: lint.ok, errors: lint.errors },
			});
		}
		// 新建配方(手动入口,无需审批弹层,但 lint 是硬门):id 取库内 fm-NNNN 最大号 +1
		if (req.method === "POST" && path === "/api/formula") {
			const body = JSON.parse(await readBody(req));
			const name = String(body.name ?? "").trim();
			if (!name) return send(res, 400, { error: "name required" });
			const ACCORDS = ["floral", "oriental", "woody", "leather", "chypre", "fougere", "aromatic", "green", "aquatic", "citrus", "gourmand", "fruity"];
			const accord = body.accord ?? null;
			if (accord !== null && !ACCORDS.includes(accord)) return send(res, 400, { error: "bad accord" });
			const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
			if (!ingredients.length) return send(res, 400, { error: "ingredients required" });
			const category = body.category ? String(body.category) : "4";
			if (!/^\d{1,2}[A-D]?$/.test(category)) return send(res, 400, { error: "bad category" });
			const useLevel = body.fragranceUseLevelPct === undefined || body.fragranceUseLevelPct === null || body.fragranceUseLevelPct === ""
				? null : Number(body.fragranceUseLevelPct);
			if (useLevel !== null && !(useLevel > 0 && useLevel <= 100)) return send(res, 400, { error: "bad fragranceUseLevelPct" });
			const pyramid = {};
			for (const tier of ["top", "heart", "base"]) {
				const arr = Array.isArray(body[tier]) ? body[tier].filter((x) => typeof x === "string" && x) : [];
				if (arr.length) pyramid[tier] = arr;
			}
			const existing = existsSync(LIBRARY) ? readdirSync(LIBRARY).filter((f) => f.endsWith(".yaml")) : [];
			let maxSeq = 0;
			for (const f of existing) {
				const mm = f.match(/^fm-(\d{4})-v/);
				if (mm) maxSeq = Math.max(maxSeq, Number(mm[1]));
			}
			let seq = maxSeq + 1, id;
			do {
				id = `fm-${String(seq).padStart(4, "0")}`;
				seq++;
			} while (existing.some((f) => f === `${id}.yaml` || f.startsWith(`${id}-v`)));
			const doc = {
				meta: { id, name, version: "1.0.0", status: "draft", createdAt: new Date().toISOString().slice(0, 10) },
				product: { category, ...(useLevel !== null ? { fragranceUseLevelPct: useLevel } : {}) },
				...(Object.keys(pyramid).length ? { pyramid } : {}),
				formula: ingredients.map((i) => ({ materialRef: String(i.materialRef), pct: Number(i.pct) })),
			};
			if (accord) doc.meta.accord = accord;
			const yamlText = stringifyYaml(doc);
			const lint = lintFormulaYaml(yamlText, `${id}-v1.yaml`);
			if (!lint.ok) return send(res, 400, { errors: lint.errors });
			const file = `${id}-v1.yaml`;
			writeFileSync(join(LIBRARY, file), yamlText, "utf8");
			return send(res, 200, { file, id, lint: { ok: lint.ok, errors: lint.errors } });
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

		// ---- 批量审查(本地)----
		if (req.method === "POST" && path === "/api/batch") {
			const { yamlDocs } = JSON.parse(await readBody(req));
			if (!Array.isArray(yamlDocs) || yamlDocs.length === 0) return send(res, 400, { error: "yamlDocs required" });
			const rows = yamlDocs.slice(0, 50).map((yaml, i) => {
				const label = `doc-${i + 1}`;
				const lint = lintFormulaYaml(yaml, label);
				if (!lint.ok) return { label, lintOk: false, lintErrors: lint.errors, ifraOk: null, violations: 0, violationRefs: [] };
				const ifra = checkFormulaIfra(yaml, label);
				return {
					label, lintOk: true, lintErrors: [],
					ifraOk: ifra.ok, violations: ifra.violations.length,
					violationRefs: ifra.violations.map((v) => v.materialRef),
				};
			});
			return send(res, 200, { rows, total: rows.length, violated: rows.filter((r) => r.ifraOk === false).length });
		}

		// ---- 谱系(配方多版本)----
		if (req.method === "GET" && path === "/api/lineage") {
			const id = url.searchParams.get("id") ?? "";
			if (!/^[A-Za-z0-9-]+$/.test(id)) return send(res, 400, { error: "bad id" });
			const files = readdirSync(LIBRARY).filter((f) => f === `${id}.yaml` || f.startsWith(`${id}-v`)).sort();
			const versions = files.map((name) => {
				let meta = null;
				try {
					meta = parseYaml(readFileSync(join(LIBRARY, name), "utf8"))?.meta ?? null;
				} catch {}
				return { name, version: meta?.version ?? "?", status: meta?.status ?? "?", createdAt: meta?.createdAt ?? null };
			});
			return send(res, 200, { id, versions });
		}

		// ---- 聊天(pi RPC 桥)----
		if (req.method === "GET" && path === "/api/chat/list") {
			const list = [...chats.values()].map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, dead: c.dead }));
			for (const d of readdirSync(CHATS_DIR)) {
				if (!chats.has(d)) list.push({ id: d, name: "", createdAt: 0, dead: true, offline: true });
			}
			return send(res, 200, { sessions: list.sort((a, b) => b.createdAt - a.createdAt) });
		}
		if (req.method === "POST" && path === "/api/chat/new") {
			const id = randomUUID().slice(0, 8);
			spawnChat(id, { resume: false });
			return send(res, 200, { id });
		}
		if (req.method === "POST" && path === "/api/chat/resume") {
			const { id } = JSON.parse(await readBody(req));
			if (typeof id !== "string" || !/^[A-Za-z0-9-]+$/.test(id) || !existsSync(join(CHATS_DIR, id))) {
				return send(res, 404, { error: "no such chat" });
			}
			const chat = chats.get(id) ?? spawnChat(id, { resume: true });
			return send(res, 200, { id, dead: chat.dead });
		}
		if (req.method === "GET" && path === "/api/chat/history") {
			const id = url.searchParams.get("id") ?? "";
			const file = join(CHATS_DIR, id, "ui-events.jsonl");
			if (!existsSync(file)) return send(res, 200, { events: [] });
			const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
			return send(res, 200, { events });
		}
		if (req.method === "GET" && path === "/api/chat/events") {
			const id = url.searchParams.get("id") ?? "";
			// 目录存在但进程不在内存(如服务器重启)→ 自动恢复,避免前端 404 重连风暴
			const chat = chats.get(id) ?? (existsSync(join(CHATS_DIR, id)) ? spawnChat(id, { resume: true }) : null);
			if (!chat) return send(res, 404, { error: "no such chat" });
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
			res.write(": connected\n\n");
			chat.sse.add(res);
			const since = Number(url.searchParams.get("since") ?? 0);
			if (since > 0 && existsSync(chat.eventFile)) {
				for (const line of readFileSync(chat.eventFile, "utf8").split("\n")) {
					if (!line.trim()) continue;
					const rec = JSON.parse(line);
					if (rec.seq > since) res.write(`data: ${JSON.stringify(rec)}\n\n`);
				}
			}
			const heartbeat = setInterval(() => {
				try {
					res.write(": ping\n\n");
				} catch {
					/* 连接已断 */
				}
			}, 20_000);
			req.on("close", () => {
				clearInterval(heartbeat);
				chat.sse.delete(res);
			});
			return;
		}
		if (req.method === "POST" && path === "/api/chat/message") {
			const { id, text } = JSON.parse(await readBody(req));
			// 目录存在即自动恢复(如服务器重启后内存中无此会话)
			const chat = chats.get(id) ?? (existsSync(join(CHATS_DIR, id)) ? spawnChat(id, { resume: true }) : null);
			if (!chat || chat.dead) return send(res, 410, { error: "chat not live" });
			if (chat.busy) return send(res, 409, { error: "agent busy" });
			if (!chat.name) {
				chat.name = String(text).slice(0, 24);
				chatCmd(chat, { type: "set_session_name", name: chat.name });
			}
			chatCmd(chat, { type: "prompt", message: String(text) });
			chat.busy = true;
			return send(res, 200, { ok: true });
		}
		if (req.method === "POST" && path === "/api/chat/respond") {
			const { id, reqId, ...payload } = JSON.parse(await readBody(req));
			const chat = chats.get(id);
			if (!chat || chat.dead) return send(res, 410, { error: "chat not live" });
			chatCmd(chat, { type: "extension_ui_response", id: reqId, ...payload });
			return send(res, 200, { ok: true });
		}
		if (req.method === "POST" && path === "/api/chat/abort") {
			const { id } = JSON.parse(await readBody(req));
			const chat = chats.get(id);
			if (chat && !chat.dead) chatCmd(chat, { type: "abort" });
			return send(res, 200, { ok: true });
		}

		send(res, 404, { error: "not found" });
	} catch (e) {
		send(res, 500, { error: e instanceof Error ? e.message : String(e) });
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`Pierfume demo → http://127.0.0.1:${PORT}`);
});
