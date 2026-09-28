/**
 * markdown.js — 对话气泡的轻量 Markdown 渲染器(零依赖,无外部库)。
 *
 * 设计:
 *   - IIFE 包裹,只暴露 window.mdToHtml,不泄漏任何顶层标识符(经典 script 共享全局作用域陷阱);
 *   - mdInline 输入**原始文本**,内部先抽出行内代码占位 → 整体 HTML 转义 → 其余行内转换
 *     → 还原占位,模型输出不可能注入脚本;
 *   - 支持 LLM 常用子集:围栏代码块、标题、无序/有序/嵌套列表、GFM 表格、引用、分割线、
 *     粗体/斜体/删除线、行内代码、链接(http/https/mailto 白名单)、裸 URL 自动链接;
 *   - 段落内单换行按 <br> 处理(对话流式惯例);图片降级为链接文本(不加载远程图)。
 *
 * 可在 Node 中直接 require 做单元验证(module.exports 同具)。
 */
(function (global) {
  "use strict";

  const mdEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mdSafeHref = (url) => {
    const u = String(url ?? "").trim();
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
  };

  // 行内转换:输入原始文本(未转义);占位符 \u0001N\u0001 无 HTML 特殊字符,可安全穿过转义
  function mdInline(raw) {
    const hold = [];
    let s = String(raw ?? "").replace(/`([^`\n]*)`/g, (_, c) =>
      `\u0001${hold.push(`<code class="md-code-inline">${mdEsc(c)}</code>`) - 1}\u0001`);
    s = mdEsc(s);

    // 链接 [text](url)(先处理;href 属性内不再做其他行内)
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
      const href = mdSafeHref(url.replace(/&amp;/g, "&"));
      return href ? `<a href="${mdEsc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    });
    // 图片降级为链接文本(不加载远程图)
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
      const href = mdSafeHref(url.replace(/&amp;/g, "&"));
      return href ? `<a href="${mdEsc(href)}" target="_blank" rel="noopener noreferrer">[图片: ${alt || "未命名"}]</a>` : (alt || "[图片]");
    });
    // 裸 URL(不处理已生成 <a href="..."> 内的;负向后瞻排除引号/等号/占位符前)
    s = s.replace(/(?<!["'=(\u0001])https?:\/\/[^\s<>\u0001]+/g, (u) => {
      const clean = u.replace(/[),.;!?]+$/, "");
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>` + u.slice(clean.length);
    });
    // 粗斜删除(顺序:***、**、*、~~)
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => hold[Number(i)]);
  }

  const mdIsListItem = (line) => /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/.exec(line);
  const mdListIndent = (m) => m[1].replace(/\t/g, "  ").length;

  // 列表解析:支持嵌套(indent 步长 2)、续行、有序无序分组
  function mdList(lines, start) {
    const baseIndent = mdListIndent(mdIsListItem(lines[start]));
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = mdIsListItem(lines[i]);
      if (!m) {
        if (lines[i].trim() === "") {
          if (i + 1 >= lines.length || !mdIsListItem(lines[i + 1])) break;
          i++;
          continue;
        }
        if (items.length) items[items.length - 1].lines.push(lines[i].trim());
        i++;
        continue;
      }
      const indent = mdListIndent(m);
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        if (!items.length) break;
        const nested = mdList(lines, i);
        items[items.length - 1].nested = nested.html;
        i = nested.next;
        continue;
      }
      items.push({ ordered: /^\d/.test(m[2]), lines: [m[4].trim()], nested: "" });
      i++;
    }
    const allOrdered = items.every((it) => it.ordered);
    const tag = allOrdered && items.length ? "ol" : "ul";
    const html = `<${tag} class="md-list">` + items.map((it) =>
      `<li>${it.lines.map(mdInline).join("<br>")}${it.nested}</li>`).join("") + `</${tag}>`;
    return { html, next: i };
  }

  function mdTable(lines, start) {
    const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const header = splitRow(lines[start]);
    const aligns = splitRow(lines[start + 1]).map((c) => {
      const l = c.startsWith(":"), r = c.endsWith(":");
      return l && r ? "center" : r ? "right" : l ? "left" : "";
    });
    let i = start + 2;
    const rows = [];
    while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
      rows.push(splitRow(lines[i]));
      i++;
    }
    const alignAttr = (j) => (aligns[j] ? ` style="text-align:${aligns[j]}"` : "");
    const html = `<table class="md-table"><thead><tr>${header.map((c, j) => `<th${alignAttr(j)}>${mdInline(c)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${r.map((c, j) => `<td${alignAttr(j)}>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return { html, next: i };
  }

  const mdIsTableSep = (l) => l.includes("|") && l.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(l);

  /** Markdown 文本 → 安全 HTML。 */
  function mdToHtml(src) {
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let para = [];
    const flushPara = () => {
      if (!para.length) return;
      out.push(`<p class="md-p">${para.map(mdInline).join("<br>")}</p>`);
      para = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (t === "") { flushPara(); i++; continue; }

      // 围栏代码块
      if (/^\s*```/.test(line)) {
        flushPara();
        const lang = /^\s*```(\S*)/.exec(line)[1];
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre class="md-pre"${lang ? ` data-lang="${mdEsc(lang)}"` : ""}><code>${mdEsc(buf.join("\n"))}</code></pre>`);
        continue;
      }

      // 标题(要求 # 后有空格,防误伤)
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { flushPara(); out.push(`<h${h[1].length} class="md-h${h[1].length}">${mdInline(h[2].trim())}</h${h[1].length}>`); i++; continue; }

      // 分割线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); out.push(`<hr class="md-hr">`); i++; continue; }

      // 引用(递归渲染内部)
      if (/^\s*>/.test(line)) {
        flushPara();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push(`<blockquote class="md-quote">${mdToHtml(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // 表格(当前行含 | 且下一行是分隔行)
      if (line.includes("|") && i + 1 < lines.length && mdIsTableSep(lines[i + 1])) {
        flushPara();
        const tbl = mdTable(lines, i);
        out.push(tbl.html);
        i = tbl.next;
        continue;
      }

      // 列表
      if (mdIsListItem(line)) {
        flushPara();
        const lst = mdList(lines, i);
        out.push(lst.html);
        i = lst.next;
        continue;
      }

      para.push(t);
      i++;
    }
    flushPara();
    return out.join("\n");
  }

  global.mdToHtml = mdToHtml;
  if (typeof module !== "undefined" && module.exports) module.exports = { mdToHtml };
})(typeof window !== "undefined" ? window : globalThis);
