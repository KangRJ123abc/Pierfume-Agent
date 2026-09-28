#!/usr/bin/env node
/**
 * 以 detached 进程启动 demo 服务器(脱离终端进程树,Kimi Code/终端关闭不影响)。
 * 日志 %TEMP%/pierfume-demo.log;停止:netstat -ano | findstr :3210 → taskkill /PID <pid> /F
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openSync } from "node:fs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const logPath = join(process.env.TEMP ?? process.env.TMPDIR ?? ".", "pierfume-demo.log");
const out = openSync(logPath, "a");
const proc = spawn(process.execPath, [join("demo", "server.mjs")], {
  cwd: PKG_ROOT,
  detached: true,
  stdio: ["ignore", out, out],
});
proc.unref();
console.log(`pierfume demo 已 detached 启动:pid=${proc.pid},日志=${logPath}`);
console.log(`工作目录:${PKG_ROOT}`);
