import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunLog } from "./log-writer.js";

export function generateDashboard(reportsDir: string, runs: RunLog[]): string {
	const html = buildDashboardHtml(runs);
	const filePath = join(reportsDir, "index.html");
	writeFileSync(filePath, html);
	return filePath;
}

function escapeJsonForScript(json: string): string {
	return json.replace(/<\/script>/gi, "<\\/script>");
}

export function buildDashboardHtml(runs: RunLog[]): string {
	const dataJson = escapeJsonForScript(JSON.stringify(runs));

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hall Monitor Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #111; color: #e0e0e0; display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 260px; min-width: 260px; background: #1a1a2e; overflow-y: auto; border-right: 1px solid #333; display: flex; flex-direction: column; }
.sidebar-header { padding: 16px; border-bottom: 1px solid #333; font-size: 14px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
.run-entry { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 8px; transition: background 0.15s; }
.run-entry:hover { background: #252540; }
.run-entry.active { background: #2a2a4a; border-left: 3px solid #6c63ff; }
.run-entry .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.run-entry .dot.critical { background: #e74c3c; }
.run-entry .dot.normal { background: #555; }
.run-entry .info { flex: 1; min-width: 0; }
.run-entry .date { font-size: 13px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.run-entry .meta { font-size: 11px; color: #888; margin-top: 2px; }
.main { flex: 1; overflow-y: auto; padding: 32px; }
.main h1 { font-size: 20px; margin-bottom: 8px; color: #fff; }
.main .run-meta { font-size: 13px; color: #888; margin-bottom: 24px; }
.severity-group { margin-bottom: 24px; }
.severity-group h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #333; }
.severity-group h2.critical { color: #e74c3c; }
.severity-group h2.high { color: #e67e22; }
.severity-group h2.medium { color: #f1c40f; }
.severity-group h2.low { color: #95a5a6; }
.finding { background: #1e1e30; border-radius: 6px; padding: 14px 16px; margin-bottom: 10px; }
.finding .finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.finding .badge { font-size: 11px; padding: 2px 8px; border-radius: 3px; font-weight: 600; text-transform: uppercase; }
.badge.bug-report { background: #e74c3c33; color: #e74c3c; }
.badge.regression { background: #e67e2233; color: #e67e22; }
.badge.security { background: #e74c3c33; color: #ff6b6b; }
.badge.feature-request { background: #3498db33; color: #3498db; }
.badge.pain-point { background: #f1c40f33; color: #f1c40f; }
.badge.praise { background: #2ecc7133; color: #2ecc71; }
.badge.trend { background: #9b59b633; color: #9b59b6; }
.finding .title { font-size: 14px; font-weight: 600; color: #fff; }
.finding .title a { color: #6c9fff; text-decoration: none; }
.finding .title a:hover { text-decoration: underline; }
.finding .summary { font-size: 13px; color: #bbb; margin-top: 4px; line-height: 1.5; }
.empty { text-align: center; color: #666; padding: 60px 20px; font-size: 15px; }
</style>
</head>
<body>
<div class="sidebar">
<div class="sidebar-header">Run History</div>
<div id="run-list"></div>
</div>
<div class="main" id="main-content">
<div class="empty">Select a run from the sidebar</div>
</div>
<script>
var RUNS = ${dataJson};

var runList = document.getElementById("run-list");
var mainContent = document.getElementById("main-content");
var activeIndex = -1;

var severityOrder = ["critical", "high", "medium", "low"];

function hasCritical(run) {
  return run.findings.some(function(f) { return f.severity === "critical"; });
}

function formatDate(iso) {
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  var div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderSidebar() {
  var html = "";
  for (var i = 0; i < RUNS.length; i++) {
    var r = RUNS[i];
    var critical = hasCritical(r);
    var cls = i === activeIndex ? " active" : "";
    html += '<div class="run-entry' + cls + '" data-index="' + i + '">'
      + '<div class="dot ' + (critical ? "critical" : "normal") + '"></div>'
      + '<div class="info">'
      + '<div class="date">' + escapeHtml(formatDate(r.timestamp)) + '</div>'
      + '<div class="meta">' + r.stats.topicsChecked + ' topics, ' + r.stats.findingsCount + ' findings</div>'
      + '</div></div>';
  }
  runList.innerHTML = html;
}

function renderRun(index) {
  activeIndex = index;
  renderSidebar();
  var run = RUNS[index];
  if (!run) { mainContent.innerHTML = '<div class="empty">No run selected</div>'; return; }

  var html = '<h1>Run: ' + escapeHtml(formatDate(run.timestamp)) + '</h1>'
    + '<div class="run-meta">' + run.stats.topicsChecked + ' topics checked &middot; '
    + run.stats.findingsCount + ' findings</div>';

  var grouped = {};
  for (var i = 0; i < severityOrder.length; i++) { grouped[severityOrder[i]] = []; }
  for (var j = 0; j < run.findings.length; j++) {
    var f = run.findings[j];
    if (grouped[f.severity]) { grouped[f.severity].push(f); }
  }

  var hasFindings = false;
  for (var s = 0; s < severityOrder.length; s++) {
    var sev = severityOrder[s];
    var items = grouped[sev];
    if (items.length === 0) continue;
    hasFindings = true;
    html += '<div class="severity-group"><h2 class="' + sev + '">' + escapeHtml(sev) + ' (' + items.length + ')</h2>';
    for (var k = 0; k < items.length; k++) {
      var fi = items[k];
      html += '<div class="finding"><div class="finding-header">'
        + '<span class="badge ' + escapeHtml(fi.category) + '">' + escapeHtml(fi.category) + '</span>'
        + '<span class="title"><a href="' + escapeHtml(fi.topicUrl) + '" target="_blank">' + escapeHtml(fi.title) + '</a></span>'
        + '</div><div class="summary">' + escapeHtml(fi.summary) + '</div></div>';
    }
    html += '</div>';
  }

  if (!hasFindings) {
    html += '<div class="empty">No findings in this run</div>';
  }

  mainContent.innerHTML = html;
}

renderSidebar();
if (RUNS.length > 0) { renderRun(0); }

runList.addEventListener("click", function(e) {
  var entry = e.target.closest(".run-entry");
  if (entry) { renderRun(parseInt(entry.getAttribute("data-index"), 10)); }
});
</script>
</body>
</html>`;
}
