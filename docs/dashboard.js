"use strict";

const EDITABLE = document.documentElement.dataset.mode === "local";
const STATUSES = ["Needs confirmation", "Planned", "In progress", "Blocked", "Complete"];
const ACTIVITY_STATUSES = ["Active", "Observer", "Inactive"];
const INFRASTRUCTURE_STATUSES = ["In Use", "In Development", "Planned"];
const LEGACY_INFRASTRUCTURE_STATUSES = {
  "Needs confirmation": "Planned",
  "Planned": "Planned",
  "In progress": "In Development",
  "Blocked": "Planned",
  "Complete": "In Use"
};
const PRIORITIES = ["High", "Medium", "Low"];
const EVIDENCE = ["Reported", "Proposed follow-up", "User update"];
const COLLECTIONS = ["workstreams", "milestones", "people", "infrastructure", "decisions", "risks", "timeline"];
const PRODUCT_DATASETS = ["Euclid Data", "FS2", "SHECAL"];
const DATA_PRODUCTS = [
  { id: "deep-photometry", title: "Deep AUX photometry", match: (text) => /\b(?:deep|aux)\b/.test(text) && /\b(?:photometr\w*|mocks?|catalogues?)\b/.test(text) && !/\bsoms?\b/.test(text) },
  { id: "redshift", title: "Redshift samples", match: (text) => /\bredshift\b.*\b(?:samples?|mocks?)\b/.test(text) },
  { id: "wide-wl", title: "Wide photometry for WL", sample: "WL", match: (text) => /\bwide\b/.test(text) && /\b(?:photometr\w*|samples?|catalogues?)\b/.test(text) && !/\b(?:soms?|transfer)\b/.test(text) },
  { id: "wide-gc", title: "Wide photometry for GC", sample: "GC", match: (text) => /\bwide\b/.test(text) && /\b(?:photometr\w*|samples?|catalogues?)\b/.test(text) && !/\b(?:soms?|transfer)\b/.test(text) },
  { id: "transfer-wl", title: "Transfer function for WL", sample: "WL", match: (text) => /\btransfer functions?\b/.test(text) },
  { id: "transfer-gc", title: "Transfer function for GC", sample: "GC", match: (text) => /\btransfer functions?\b/.test(text) },
  { id: "deep-som", title: "Deep SOM", match: (text) => /\b(?:deep|aux)\b.*\bsoms?\b/.test(text) },
  { id: "wide-som", title: "Wide SOM", match: (text) => /\bwide\b.*\bsoms?\b/.test(text) }
];
const SOURCE_DESCRIPTIONS = {
  "Infrastructure.txt": "Capabilities, supported samples and the endorsed production route.",
  "Personnel.txt": "Initial 16-person roster; role fields are empty in the source.",
  "Project_Activity.txt": "Explicit technical responsibilities and ongoing methodological testing.",
  "ou-phz-ztf_full_summary_top10.txt": "July 2025-October 2026 timeline and approximate contributor profiles; partial thread coverage.",
  "ou-phz-ztf_summary_6months.txt": "Detailed May-October 2026 science, DR1 prior deadline and full-thread addenda.",
  "ztf_contributions.tsv": "Approximate channel activity, including grouped lower-ranked rows."
};
const TAB_INFO = {
  overview: ["PROJECT AT A GLANCE", "Overview", "The DR1 calibration programme, its priorities and next handoff."],
  workstreams: ["DELIVERY & METHODOLOGY", "Workstreams", "Editable technical work, assignments and progress notes."],
  milestones: ["DELIVERY CHECKPOINTS", "Milestones", "Reported achievements and planned handoffs; dates are only set where supported."],
  people: ["PEOPLE & OWNERSHIP", "Team & responsibilities", "16 roster members plus 3 explicitly named collaborators. Roles are sourced; current availability needs confirmation."],
  infrastructure: ["ANALYSIS & PRODUCTION", "Infrastructure", "SGS is the only Consortium- and ESA-endorsed production route."],
  governance: ["ASSUMPTIONS & DEPENDENCIES", "Decisions & risks", "Distinguish the reported baseline from unresolved methodological choices."],
  timeline: ["PROJECT HISTORY & SCHEDULE", "Project timeline", "Project history plus live workstreams and milestones, ordered by target date; undated items appear last."],
  gantt: ["SCHEDULE & HANDOFFS", "Gantt chart", "Workstream schedules and dated milestones. Click a row to edit its dates and progress."],
  products: ["DELIVERABLES & RESPONSIBILITY", "Data products", "Eight products across Euclid Data, FS2 and SHECAL, linked to the current workstreams and milestones."],
  sources: ["EVIDENCE & CONTEXT", "Sources & activity", "Read the six original files. Activity counts are not responsibility or performance metrics."]
};
let state;
let tab = "overview";
let dirty = false;
let saving = false;
let conflict = false;
let generation = 0;
let editorContext = null;
let sourceList = [];
let contributions = [];
let selectedPersonId = null;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const slug = (value) => value.toLowerCase().replaceAll(" ", "-");
const options = (values, blank = null) => (blank === null ? "" : `<option value="">${escapeHtml(blank)}</option>`) + values.map((value) => `<option>${escapeHtml(value)}</option>`).join("");
const statusesFor = (collection) => collection === "people" ? ACTIVITY_STATUSES : collection === "infrastructure" ? INFRASTRUCTURE_STATUSES : STATUSES;
const byTargetDate = (a, b) => a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0;
const isUmbrella = (record) => record.workflow_type === "Umbrella";
const workflowParent = (record) => state.workstreams.find((item) => item.id === record.parent_id);
const dateLabel = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not set";
function daysTo(value) {
  const today = new Date();
  return value ? Math.round((new Date(`${value}T00:00:00`) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000) : null;
}
function dueLabel(record) {
  if (!record.due) return '<span>No confirmed target</span>';
  const days = daysTo(record.due);
  const active = record.status !== "Complete";
  const suffix = active && days < 0 ? " (overdue)" : active && days === 0 ? " (today)" : "";
  return `<span class="${active && days < 0 ? "due-overdue" : active && days <= 30 ? "due-soon" : ""}">Target <strong>${escapeHtml(dateLabel(record.due))}${suffix}</strong></span>`;
}
function badge(status) {
  return `<span class="badge status-${slug(status)}">${escapeHtml(status)}</span>`;
}
function showError(message, selector = "#error") {
  $(selector).textContent = message;
  $(selector).hidden = false;
}
function clearError() {
  $("#error").hidden = true;
}
async function request(path, config = {}) {
  if (!EDITABLE && config.method && config.method !== "GET") throw new Error("Published snapshots cannot be edited.");
  const response = await fetch(path, { cache: "no-store", ...config });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}
function updateSaveStatus(message) {
  $("#save-status").textContent = !EDITABLE ? `Published read-only snapshot${state.updated_at ? ` | Last saved ${new Date(state.updated_at).toLocaleString()}` : ""}` : message || (dirty ? "Unsaved changes" : state.updated_at ? `Saved ${new Date(state.updated_at).toLocaleString()}` : "Initial source snapshot");
  $("#retry").hidden = !EDITABLE || !dirty || saving || conflict;
  $("#import").disabled = !EDITABLE || saving || dirty;
}
function requireEditing() {
  if (EDITABLE) return true;
  showError("This is a read-only published snapshot. Edit the local dashboard, then regenerate and publish it.");
  return false;
}
function markChanged() {
  if (!requireEditing()) return;
  dirty = true;
  generation += 1;
  render();
  updateSaveStatus();
  if (!conflict) persist();
}
async function persist() {
  if (!requireEditing()) return;
  if (saving || !dirty || conflict) return;
  saving = true;
  const savedGeneration = generation;
  const outgoing = structuredClone(state);
  updateSaveStatus("Saving to dashboard-state.json...");
  try {
    const saved = await request("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(outgoing) });
    state.revision = saved.revision;
    state.updated_at = saved.updated_at;
    dirty = generation !== savedGeneration;
    clearError();
    saving = false;
    updateSaveStatus();
    if (dirty) persist();
  } catch (error) {
    saving = false;
    conflict = error.status === 409;
    showError(`Changes are still in this window but were NOT saved. ${error.message}${conflict ? " Export JSON to preserve your edits, reload, then reconcile or import your backup." : " Retry save when the server is available, or export JSON as a backup."}`);
    updateSaveStatus("NOT SAVED - export a backup");
  }
}
function card(record, collection, showType = false) {
  const hideReferences = collection === "people" || collection === "infrastructure";
  const parent = collection === "workstreams" ? workflowParent(record) : null;
  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(record.title)}</h3>${EDITABLE ? `<button data-edit="${escapeHtml(record.id)}" data-collection="${collection}">Edit</button>` : ""}</div>
    <div class="tags">${showType ? `<span class="badge">${collection === "workstreams" ? "Workstream" : "Milestone"}</span>` : ""}${badge(record.status)}<span class="badge priority-${slug(record.priority)}">${collection === "people" ? `Bus risk: ${escapeHtml(record.priority)}` : `${escapeHtml(record.priority)} priority`}</span>${collection === "people" ? (isRedshiftSampleTeam(record) ? '<span class="badge">zTFTz</span>' : "") : hideReferences ? "" : `<span class="badge">${escapeHtml(record.evidence)}</span>`}</div>
    <p class="card-detail">${escapeHtml(record.detail)}</p>
    ${collection === "workstreams" && isUmbrella(record) ? '<p class="hint">Umbrella workflow</p>' : parent ? `<p class="hint">Umbrella: ${escapeHtml(parent.title)}</p>` : ""}
    ${collection === "people" ? "" : `<div class="record-meta">${collection === "timeline" ? "" : `<span>Owner <strong>${escapeHtml(record.owner || "Unassigned")}</strong></span>`}${hideReferences ? "" : `${record.start ? `<span>Start <strong>${escapeHtml(dateLabel(record.start))}</strong></span>` : ""}${dueLabel(record)}`}</div>`}
    ${!hideReferences && record.source ? `<div class="record-source">${EDITABLE ? `<button class="source-link" data-source="${escapeHtml(record.source)}">${escapeHtml(record.source)}</button>` : `<span class="source-link">Reference: ${escapeHtml(record.source)} (not published)</span>`}</div>` : ""}
  </article>`;
}
function focusRow(record, collection, index) {
  return `<div class="focus-row"><span class="focus-number">${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(record.title)}</h3>${badge(record.status)}<p>${escapeHtml(record.owner || "Owner to confirm")}</p>${dueLabel(record)}</div>${EDITABLE ? `<button data-edit="${escapeHtml(record.id)}" data-collection="${collection}">Edit</button>` : ""}</div>`;
}
function panel(title, collection, records) {
  return `<section class="panel"><div class="panel-heading"><h2>${title}</h2><button data-goto="${collection === "risks" ? "governance" : collection}">View all &rarr;</button></div>${records.length ? records.map((record, index) => focusRow(record, collection, index)).join("") : '<p class="empty">No active items.</p>'}</section>`;
}
function renderOverview() {
  const work = state.workstreams.filter((record) => !isUmbrella(record));
  const done = work.filter((record) => record.status === "Complete").length;
  const active = work.filter((record) => record.status === "In progress").length;
  const highRisks = state.risks.filter((record) => record.priority === "High" && record.status !== "Complete");
  const unconfirmed = work.filter((record) => record.status === "Needs confirmation").length;
  const targetDays = daysTo(state.project.target);
  const targetTime = targetDays === null ? "No target set" : targetDays < 0 ? `${Math.abs(targetDays)} days past target` : targetDays === 0 ? "Target is today" : `${targetDays} days to target`;
  const sorted = work.filter((record) => record.status !== "Complete").sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.due || "9999").localeCompare(b.due || "9999"));
  const milestones = state.milestones.filter((record) => record.status !== "Complete").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  $("#overview").innerHTML = `
    <div class="hero"><div><p class="eyebrow">REDSHIFT DISTRIBUTIONS / DR1</p><h2>${escapeHtml(state.project.title)}</h2><p>${escapeHtml(state.project.summary)}</p></div><div class="hero-aside"><p class="eyebrow">NEXT PRIOR HANDOFF</p><div class="target">${escapeHtml(dateLabel(state.project.target))}</div><p>${escapeHtml(targetTime)}</p><p>${escapeHtml(state.project.target_note)}</p></div></div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Workstreams</div><div class="metric-value">${work.length}</div><small>${active} reported in progress</small></div>
      <div class="metric"><div class="metric-label">High-priority risks</div><div class="metric-value">${highRisks.length}</div><small>Unresolved, not a severity score</small></div>
      <div class="metric"><div class="metric-label">Assignments to review</div><div class="metric-value">${unconfirmed}</div><small>Workstreams needing confirmation</small></div>
      <div class="metric"><div class="metric-label">Completed workstreams</div><div class="metric-value">${done} / ${work.length}</div><small>Tracked statuses, not % science complete</small></div>
    </div>
    ${ganttChart(false)}
    <div class="overview-grid"><div>${panel("Priority work", "workstreams", sorted.slice(0, 5))}</div><div>${panel("Upcoming checkpoints", "milestones", milestones.slice(0, 3))}${panel("Risks to resolve", "risks", highRisks.slice(0, 3))}</div></div>
    <div class="notice"><strong>Production boundary:</strong> only SGS can produce Consortium- and ESA-endorsed products. CosmoPipe and other tools support analysis and validation.</div>
    <div class="caveats"><strong>How to read this dashboard</strong><p>${escapeHtml(state.project.caveats)}</p></div>`;
}
function normalizeWords(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function isRedshiftSampleTeam(person) {
  const bio = normalizeWords(person.detail);
  if (/\bnot (?:a )?(?:member of|part of) (?:the )?ztftz\b/.test(bio)) return false;
  return /\b(?:member of|part of) (?:the )?ztftz\b|\bztftz member\b/.test(bio) ||
    /\b(?:spectroscopic|redshift|calibration) sample (?:definition|construction|compilation)\b/.test(bio);
}
function assignedToPerson(record, person) {
  const owner = ` ${normalizeWords(record.owner)} `;
  const name = normalizeWords(person.title);
  const names = name === "will hartley" || name === "william hartley" ? ["will hartley", "william hartley"] : [name];
  return owner.includes(" ztf ") || (owner.includes(" ztftz ") && isRedshiftSampleTeam(person)) ||
    names.some((candidate) => candidate && owner.includes(` ${candidate} `));
}
function renderPersonSchedule() {
  const people = [...state.people].sort((a, b) => a.title.localeCompare(b.title));
  const person = people.find((item) => item.id === selectedPersonId) || state.people[0];
  const select = $("#schedule-person");
  select.innerHTML = people.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
  select.disabled = !person;
  selectedPersonId = person ? person.id : null;
  if (!person) {
    select.innerHTML = '<option>No team members</option>';
    $("#person-gantt").innerHTML = '<p class="empty">No team members are available for a personal schedule.</p>';
    return;
  }
  select.value = person.id;
  $("#person-gantt").innerHTML = ganttChart(false, person);
}
function ganttChart(applyFilters, person = null) {
  const items = ["workstreams", "milestones"].flatMap((collection) => state[collection].map((record) => ({ record, collection })))
    .filter(({ record }) => (!applyFilters || filtered(record)) && (!person || assignedToPerson(record, person)));
  const dated = items.filter(({ record }) => record.start || record.due)
    .sort((a, b) => (a.record.start || a.record.due).localeCompare(b.record.start || b.record.due));
  const unscheduled = items.filter(({ record }) => !record.start && !record.due);
  const heading = `<div class="panel-heading"><h2>${person ? `${escapeHtml(person.title)}: workstreams & milestones` : "Delivery schedule"}</h2>${person ? "" : applyFilters ? (EDITABLE ? '<div><button data-add="workstreams">+ Workstream</button> <button data-add="milestones">+ Milestone</button></div>' : "") : '<button data-goto="gantt">Open Gantt view &rarr;</button>'}</div>`;
  let chart = `<p class="empty">${EDITABLE ? "No dated items. Set workstream start/target dates or milestone targets to build the chart." : "No dated items in this published snapshot."}</p>`;
  if (person && !items.length) chart = `<p class="empty">No workstreams or milestones are assigned to ${escapeHtml(person.title)}.</p>`;
  if (dated.length) {
    const parse = (value) => Date.parse(`${value}T00:00:00Z`);
    const dates = dated.flatMap(({ record }) => [record.start, record.due].filter(Boolean)).map(parse);
    if (state.project.snapshot) dates.push(parse(state.project.snapshot));
    const first = new Date(Math.min(...dates));
    const last = new Date(Math.max(...dates));
    const from = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    const until = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
    const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
    const width = Math.max(1050, 310 + months * 85);
    const left = 310;
    const right = width - 24;
    const top = 52;
    const rowHeight = 62;
    const height = top + dated.length * rowHeight + 15;
    const x = (timestamp) => left + (timestamp - from) / (until - from) * (right - left);
    const ticks = Array.from({ length: months }, (_, index) => {
      const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
      return `<line class="gantt-gridline" x1="${x(month.getTime())}" y1="35" x2="${x(month.getTime())}" y2="${height}"/><text class="gantt-month" x="${x(month.getTime()) + 5}" y="23">${escapeHtml(month.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }))}</text>`;
    }).join("");
    const rows = dated.map(({ record, collection }, index) => {
      const y = top + index * rowHeight;
      const start = record.start ? x(parse(record.start)) : null;
      const end = record.due ? x(parse(record.due)) : null;
      const milestone = collection === "milestones";
      const summary = record.start ? `${dateLabel(record.start)}${record.due ? ` - ${dateLabel(record.due)}` : " (no target)"}` : `Target ${dateLabel(record.due)}${milestone ? "" : " (no start)"}`;
      const title = record.title.length > 39 ? record.title.slice(0, 36) + "..." : record.title;
      const point = end === null ? start : end;
      const mark = !milestone && start !== null && end !== null
        ? `<rect class="gantt-bar" x="${start}" y="${y + 15}" width="${Math.max(4, end - start)}" height="19" rx="5"/>`
        : `<path class="${milestone ? "gantt-milestone" : "gantt-deadline"}" d="M ${point} ${y + 15} l 9 9 l -9 9 l -9 -9 Z"/>`;
      const tag = EDITABLE ? "a" : "g";
      return `<${tag} ${EDITABLE ? `href="#" data-edit="${escapeHtml(record.id)}" data-collection="${collection}"` : ""} aria-label="${escapeHtml(`${EDITABLE ? "Edit " : ""}${record.title}: ${summary}`)}">
        <title>${escapeHtml(`${record.title} | ${summary} | ${record.status} | ${record.owner || "Unassigned"}`)}</title>
        <rect class="gantt-row-background" x="0" y="${y}" width="${width}" height="${rowHeight}"/>
        <text class="gantt-label" x="16" y="${y + 22}">${escapeHtml(title)}</text>
        <text class="gantt-date" x="16" y="${y + 42}">${escapeHtml(summary)}</text>
        <g class="gantt-status-${slug(record.status)}">${mark}</g>
      </${tag}>`;
    }).join("");
    const today = new Date();
    const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const todayLine = now >= from && now < until ? `<line class="gantt-today" x1="${x(now)}" y1="35" x2="${x(now)}" y2="${height}"/><text class="gantt-today-label" x="${x(now) + 4}" y="45">Today</text>` : "";
    chart = `<div class="gantt-scroll" tabindex="0" role="region" aria-label="Scrollable project schedule"><svg class="gantt-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Gantt schedule: workstream durations and milestone dates">${ticks}${rows}${todayLine}</svg></div>`;
  }
  const pending = unscheduled.length ? `<details class="gantt-unscheduled"><summary>${unscheduled.length} unscheduled items (no dates assumed)</summary><div>${unscheduled.map(({ record, collection }) => EDITABLE ? `<button data-edit="${escapeHtml(record.id)}" data-collection="${collection}">${escapeHtml(record.title)}</button>` : `<span>${escapeHtml(record.title)}</span>`).join("")}</div></details>` : "";
  if (applyFilters) $("#result-count").textContent = `${items.length} items`;
  return `<section class="panel gantt-panel">${heading}<p class="gantt-legend">Bars: workstreams with start and target dates. Gold diamonds: milestones. Teal diamonds: single workstream dates. Dashed line: today. ${EDITABLE ? "Dates are editable" : "Read-only published dates"}; missing dates are never inferred.</p>${chart}${pending}</section>`;
}
function collectionsForTab() {
  if (tab === "gantt") return ["workstreams", "milestones"];
  if (tab === "timeline") return ["timeline", "workstreams", "milestones"];
  return tab === "governance" ? ["decisions", "risks"] : COLLECTIONS.includes(tab) ? [tab] : [];
}
function refreshOwnerFilter() {
  const current = $("#owner-filter").value;
  const owners = [...new Set(collectionsForTab().flatMap((collection) => state[collection].map((record) => record.owner)).filter(Boolean))].sort();
  $("#owner-filter").innerHTML = options(owners, "All owners");
  if (owners.includes(current)) $("#owner-filter").value = current;
}
function filtered(record) {
  const query = $("#search").value.trim().toLowerCase();
  const parentTitle = tab === "workstreams" ? (workflowParent(record) || {}).title || "" : "";
  return (!query || [record.title, record.owner, record.detail, record.source, record.evidence, parentTitle].some((value) => value.toLowerCase().includes(query))) &&
    (!$("#status-filter").value || record.status === $("#status-filter").value) &&
    (!$("#owner-filter").value || record.owner === $("#owner-filter").value) &&
    (!$("#priority-filter").value || record.priority === $("#priority-filter").value);
}
function renderRecords() {
  if (tab === "gantt") {
    $("#gantt").innerHTML = ganttChart(true);
    return;
  }
  if (tab === "workstreams") {
    const projects = state.workstreams.filter((record) => !isUmbrella(record));
    const groups = state.workstreams.filter((record) => !record.parent_id).map((record) => {
      const children = isUmbrella(record) ? projects.filter((item) => item.parent_id === record.id).sort(byTargetDate) : [];
      const matches = children.filter(filtered);
      return { record, children, matches, due: record.due || (children.find((item) => item.due) || {}).due || "" };
    }).filter(({ record, matches }) => filtered(record) || matches.length).sort(byTargetDate);
    $("#records").innerHTML = groups.length ? groups.map(({ record, children, matches }) => isUmbrella(record)
      ? `<section class="workflow-group" data-umbrella="${escapeHtml(record.id)}">
          ${card(record, "workstreams")}
          <div class="section-heading"><h2>Subprojects (${matches.length} / ${children.length})</h2>${EDITABLE ? `<button data-add="workstreams" data-parent="${escapeHtml(record.id)}">+ Add subproject</button>` : ""}</div>
          ${matches.length ? `<div class="record-grid">${matches.map((item) => card(item, "workstreams")).join("")}</div>` : '<p class="empty">No matching subprojects.</p>'}
        </section>`
      : card(record, "workstreams")).join("") : '<p class="empty">No matching workflows. Try clearing the filters.</p>';
    $("#result-count").textContent = `${projects.filter(filtered).length} projects; ${groups.filter(({ record }) => isUmbrella(record)).length} umbrellas`;
    return;
  }
  if (tab === "timeline") {
    const history = state.timeline.filter(filtered);
    const schedule = ["workstreams", "milestones"].flatMap((collection) =>
      state[collection].filter(filtered).map((record) => ({ record, collection }))
    ).sort((a, b) => byTargetDate(a.record, b.record));
    $("#records").innerHTML = `
      <div class="section-heading"><h2>Project history</h2></div>
      ${history.length ? `<div class="timeline-list">${history.map((record) => card(record, "timeline")).join("")}</div>` : '<p class="empty">No matching history entries.</p>'}
      <div class="section-heading"><h2>Workstreams & milestones</h2></div>
      <p class="hint">Automatically linked to the original items. Earliest target dates first; undated items last.</p>
      ${schedule.length ? `<div class="timeline-list">${schedule.map(({ record, collection }) => card(record, collection, true)).join("")}</div>` : '<p class="empty">No matching workstreams or milestones.</p>'}`;
    $("#result-count").textContent = `${history.length + schedule.length} items`;
    return;
  }
  let count = 0;
  const html = collectionsForTab().map((collection) => {
    const records = state[collection].filter(filtered);
    if (collection === "workstreams" || collection === "milestones") records.sort(byTargetDate);
    count += records.length;
    const heading = tab === "governance" ? `<div class="section-heading"><h2>${collection === "decisions" ? "Decisions & open choices" : "Risks & dependencies"}</h2>${EDITABLE ? `<button data-add="${collection}">+ Add ${collection === "risks" ? "risk" : "decision"}</button>` : ""}</div>` : "";
    return heading + (records.length ? `<div class="${collection === "timeline" ? "timeline-list" : "record-grid"}">${records.map((record) => card(record, collection)).join("")}</div>` : `<p class="empty">No matching items. ${EDITABLE ? "Clear filters or add a new item." : "Try clearing the filters."}</p>`);
  }).join("");
  $("#records").innerHTML = html;
  $("#result-count").textContent = `${count} items`;
}
function renderSources() {
  $("#sources").innerHTML = `<div class="notice">${EDITABLE ? "Sources are never overwritten by dashboard edits. The editable snapshot is stored separately in <strong>dashboard-state.json</strong>. Export JSON for backups or transfer; import replaces the full dashboard after confirmation." : "This is a read-only published snapshot. Original source documents are not included. Source filenames on records are references only. Updates are made in the local dashboard, then regenerated and published. Export JSON downloads this published snapshot."}</div>
    <div class="source-grid">${sourceList.map((source) => `<article class="source-card"><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(SOURCE_DESCRIPTIONS[source.name])}</p><button data-source="${escapeHtml(source.name)}">Read original &rarr;</button> <span class="hint">${(source.bytes / 1024).toFixed(1)} KB</span></article>`).join("")}</div>
    <section class="panel"><div class="panel-heading"><h2>Channel contribution activity</h2><span class="hint">Source: ztf_contributions.tsv</span></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Contributor(s)</th><th>Messages / replies</th><th>Reactions</th><th>Total</th></tr></thead><tbody>${contributions.map((row) => `<tr><td>${escapeHtml(row.rank)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.messages)}</td><td>${escapeHtml(row.reactions)}</td><td>${escapeHtml(row.total)}${/^\d+$/.test(row.total) && !row.name.includes(",") ? `<progress class="activity-bar" value="${Number(row.total)}" max="171" aria-label="Approximate activity total"></progress>` : ""}</td></tr>`).join("")}</tbody></table></div></section>
    <div class="caveats"><strong>Activity caveats</strong><p>Counts include messages, replies and reactions, are approximate and omit some unread threads. Grouped rows retain their original ranges; no invented individual values. TSV and narrative rankings disagree in places. Sentiment interpretations from contributor profiles are deliberately not presented as project facts.</p></div>`;
}
function productReferences(product, dataset) {
  return ["workstreams", "milestones"].flatMap((collection) => state[collection].flatMap((record) => {
    const text = normalizeWords(record.title);
    if (!product.match(text)) return [];
    const datasets = PRODUCT_DATASETS.filter((name) => {
      if (name === "Euclid Data") return /\b(?:euclid|real data|data)\b/.test(text);
      return new RegExp(`\\b${name.toLowerCase()}\\b`).test(text);
    });
    if (datasets.length && !datasets.includes(dataset)) return [];
    const samples = [];
    if (/\b(?:wl|weak lensing|shear|lensmc|metacal)\b/.test(text)) samples.push("WL");
    if (/\b(?:gc|galaxy clustering|position)\b/.test(text)) samples.push("GC");
    if (product.sample && samples.length && !samples.includes(product.sample)) return [];
    const caveats = [];
    if (!datasets.length) caveats.push("Dataset not specified");
    if (product.sample && !samples.length) caveats.push("WL/GC scope not specified");
    if (!/^(?:build|construct|construction|produce|production|generate|compile|compilation|train|define|finalise|finalize)\b/.test(text) ||
        /\b(?:test|tests|testing|validation|cross validate|review|weighting|augment)\b/.test(text)) {
      caveats.push("Related analysis or validation, not a production assignment");
    }
    if (product.id === "redshift" && /ownership.*(?:needs|to).*confirm/i.test(record.detail)) {
      caveats.push("Redshift-production ownership explicitly needs confirmation");
    }
    return [{ record, collection, caveats }];
  })).sort((a, b) => byTargetDate(a.record, b.record));
}
function productReference({ record, collection, caveats }) {
  return `<div class="product-reference">
    <p><strong>${escapeHtml(record.owner.trim() || "Unassigned")}</strong> <span class="hint">(${collection === "workstreams" ? "workstream" : "milestone"} owner)</span></p>
    ${caveats.length ? `<p class="hint">${escapeHtml(caveats.join("; "))}.</p>` : ""}
    ${EDITABLE ? `<button class="source-link" data-edit="${escapeHtml(record.id)}" data-collection="${collection}">${escapeHtml(record.title)}</button>` : `<p>${escapeHtml(record.title)}</p>`}
    <div class="tags">${badge(record.status)}</div>
    <details><summary>Record details</summary><p class="card-detail">${escapeHtml(record.detail || "No additional notes.")}</p>${dueLabel(record)}</details>
  </div>`;
}
function renderProducts() {
  $("#products").innerHTML = `
    <div class="notice">Owners below come directly from linked workstreams and milestones, not from channel activity or biographies. Matching uses product and dataset names in item titles. Records with unspecified datasets or WL/GC scope are shown as related work, not assignments to all variants. Input mentions in notes do not establish production ownership. ${EDITABLE ? "Edit a linked item to update its owner or clarify its product and dataset in the title." : "This is a read-only published snapshot."}</div>
    ${DATA_PRODUCTS.map((product) => `<section class="product-group"><div class="section-heading"><h2>${product.title}</h2></div><div class="product-grid">
      ${PRODUCT_DATASETS.map((dataset) => {
        const references = productReferences(product, dataset);
        const assigned = references.filter(({ record, caveats }) => !caveats.length && record.owner.trim());
        const related = references.filter((reference) => !assigned.includes(reference));
        return `<article class="card product-card" data-product="${product.id}" data-dataset="${dataset}">
          <h3>${dataset}</h3>
          <p class="eyebrow">${assigned.length ? "REPORTED RESPONSIBILITY" : "PRODUCTION OWNER NOT CONFIRMED"}</p>
          ${assigned.map(productReference).join("")}
          ${related.length ? `<details class="product-related" open><summary>Related / scope-unconfirmed work (${related.length})</summary>${related.map(productReference).join("")}</details>` : ""}
          ${!references.length ? '<p class="hint">No matching workstream or milestone currently specifies this product and dataset.</p>' : ""}
        </article>`;
      }).join("")}
    </div></section>`).join("")}`;
}
function render() {
  const info = TAB_INFO[tab];
  $("#section-kicker").textContent = info[0];
  $("#section-title").textContent = info[1];
  $("#section-subtitle").textContent = tab === "people" ? `${state.people.length} tracked people. Responsibilities are sourced; current availability needs confirmation.` : info[2];
  if (!EDITABLE && tab === "workstreams") $("#section-subtitle").textContent = "Published technical work, assignments and progress notes.";
  if (!EDITABLE && tab === "gantt") $("#section-subtitle").textContent = "Published workstream schedules and dated milestones.";
  if (!EDITABLE && tab === "sources") $("#section-subtitle").textContent = "Original documents are not published. Activity counts are not responsibility or performance metrics.";
  document.querySelectorAll("nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
    button.setAttribute("aria-current", button.dataset.tab === tab ? "page" : "false");
  });
  $("#overview").hidden = tab !== "overview";
  $("#sources").hidden = tab !== "sources";
  $("#gantt").hidden = tab !== "gantt";
  $("#products").hidden = tab !== "products";
  $("#person-schedule").hidden = tab !== "people";
  $("#filters").hidden = !collectionsForTab().length;
  $("#records").hidden = !collectionsForTab().length || tab === "gantt";
  $("#edit-project").hidden = !EDITABLE || tab !== "overview";
  $("#add-record").hidden = !EDITABLE || !COLLECTIONS.includes(tab);
  $("#snapshot-label").textContent = state.project.snapshot ? dateLabel(state.project.snapshot) : "not set";
  const isPeople = tab === "people";
  const statuses = statusesFor(tab);
  const statusFilter = $("#status-filter");
  const selectedStatus = statusFilter.value;
  statusFilter.innerHTML = options(statuses, isPeople ? "All activity statuses" : "All statuses");
  if (statuses.includes(selectedStatus)) statusFilter.value = selectedStatus;
  statusFilter.setAttribute("aria-label", isPeople ? "Filter by activity status" : "Filter by status");
  $("#owner-filter").hidden = isPeople;
  const priorityFilter = $("#priority-filter");
  const selectedPriority = priorityFilter.value;
  priorityFilter.innerHTML = options(PRIORITIES, isPeople ? "All bus risk levels" : "All priorities");
  priorityFilter.value = selectedPriority;
  priorityFilter.setAttribute("aria-label", isPeople ? "Filter by bus risk" : "Filter by priority");
  refreshOwnerFilter();
  if (tab === "people") renderPersonSchedule();
  if (tab === "overview") renderOverview();
  else if (tab === "sources") renderSources();
  else if (tab === "products") renderProducts();
  else renderRecords();
}
function goTo(next) {
  tab = next;
  $("#search").value = "";
  $("#status-filter").value = "";
  $("#owner-filter").value = "";
  $("#priority-filter").value = "";
  render();
}
function openEditor(collection, id = null) {
  if (!requireEditing()) return;
  $("#editor-error").hidden = true;
  const record = id ? state[collection].find((item) => item.id === id) : { title: "", owner: "", status: collection === "people" ? "Observer" : "Planned", priority: "Medium", due: "", detail: "", source: "", evidence: "User update" };
  editorContext = { collection, id };
  $("#editor-title").textContent = id ? `Edit ${collection === "people" ? "person" : "item"}` : `Add to ${collection}`;
  $("#delete-record").hidden = !id;
  const form = $("#edit-form");
  const isWorkflow = collection === "workstreams";
  $("#workflow-fields").hidden = !isWorkflow;
  form.elements.workflow_type.disabled = !isWorkflow;
  form.elements.workflow_type.value = record.workflow_type || "Project";
  form.elements.parent_id.innerHTML = '<option value="">None (standalone)</option>' + state.workstreams
    .filter((item) => isUmbrella(item) && item.id !== id).sort((a, b) => a.title.localeCompare(b.title))
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
  form.elements.parent_id.value = record.parent_id || "";
  form.elements.parent_id.disabled = !isWorkflow || isUmbrella(record);
  const isPerson = collection === "people";
  const hideReferences = isPerson || collection === "infrastructure";
  $("#owner-field").hidden = isPerson;
  $("#due-field").hidden = hideReferences;
  form.elements.owner.disabled = isPerson;
  form.elements.due.disabled = hideReferences;
  $("#status-label").textContent = isPerson ? "Activity Status" : "Status";
  $("#priority-label").textContent = isPerson ? "Bus risk" : "Priority";
  form.elements.status.innerHTML = options(statusesFor(collection));
  $("#evidence-field").hidden = hideReferences;
  $("#source-field").hidden = hideReferences;
  form.elements.evidence.disabled = hideReferences;
  form.elements.source.disabled = hideReferences;
  $("#detail-label").textContent = isPerson ? "Bio / responsibilities" : "Details / progress notes";
  $("#editor-hint").textContent = isPerson
    ? 'zTFTz membership follows redshift, spectroscopic or calibration-sample definition, construction or compilation responsibilities in the bio, or an explicit "Member of zTFTz" statement.'
    : collection === "infrastructure" ? "Track usage or development status, ownership and progress notes."
    : 'No date means no confirmed deadline. Mark new observations as "User update"; retain source references for traceability.';
  $("#start-field").hidden = collection !== "workstreams";
  form.elements.start.disabled = collection !== "workstreams";
  form.elements.start.value = record.start || "";
  form.elements.due.setCustomValidity("");
  for (const [key, value] of Object.entries(record)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  $("#editor").showModal();
}
function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ztf-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validateImport(data) {
  const keys = ["version", "revision", "updated_at", "project", ...COLLECTIONS].sort();
  if (!data || typeof data !== "object" || JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(keys) || data.version !== 1 || !Number.isInteger(data.revision) || data.revision < 0 || typeof data.updated_at !== "string") throw new Error("Unsupported or incomplete dashboard JSON.");
  const projectKeys = ["title", "summary", "snapshot", "target", "target_note", "caveats"].sort();
  const validDate = (value) => value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  if (!data.project || JSON.stringify(Object.keys(data.project).sort()) !== JSON.stringify(projectKeys) || Object.values(data.project).some((value) => typeof value !== "string" || value.length > 20000) || !data.project.title.trim() || !validDate(data.project.snapshot) || !validDate(data.project.target)) throw new Error("Invalid project overview.");
  const ids = new Set();
  const recordKeys = ["id", "title", "owner", "status", "priority", "due", "detail", "source", "evidence"].sort();
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(data[collection]) || data[collection].length > 1000) throw new Error(`Invalid ${collection} collection.`);
    for (const record of data[collection]) {
      if (collection === "people" && record && STATUSES.includes(record.status)) record.status = "Observer";
      if (collection === "infrastructure" && record && Object.hasOwn(LEGACY_INFRASTRUCTURE_STATUSES, record.status)) record.status = LEGACY_INFRASTRUCTURE_STATUSES[record.status];
      const statuses = statusesFor(collection);
      const optional = collection === "workstreams" ? ["start", "workflow_type", "parent_id"] : ["start"];
      if (!record || JSON.stringify(Object.keys(record).filter((key) => !optional.includes(key)).sort()) !== JSON.stringify(recordKeys) || Object.values(record).some((value) => typeof value !== "string" || value.length > 20000) || !record.title.trim() || !record.id || ids.has(record.id) || !statuses.includes(record.status) || !PRIORITIES.includes(record.priority) || !EVIDENCE.includes(record.evidence) || !validDate(record.due) || !validDate(record.start || "") || (record.start && record.due && record.start > record.due) || (record.source && !Object.hasOwn(SOURCE_DESCRIPTIONS, record.source))) throw new Error(`Invalid record in ${collection}.`);
      ids.add(record.id);
    }
  }
  const workflows = new Map(data.workstreams.map((record) => [record.id, record]));
  for (const record of workflows.values()) {
    if (!["Project", "Umbrella"].includes(record.workflow_type ?? "Project") || (isUmbrella(record) && record.parent_id) ||
        (record.parent_id && (record.parent_id === record.id || !workflows.has(record.parent_id) || !isUmbrella(workflows.get(record.parent_id))))) {
      throw new Error("Invalid workflow hierarchy: subprojects need an existing umbrella, and umbrellas cannot be nested.");
    }
  }
}
async function importState(file) {
  if (!requireEditing()) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("File exceeds the 2 MB import limit.");
    const data = JSON.parse(await file.text());
    validateImport(data);
    if (saving || dirty) throw new Error("Finish saving current changes before importing.");
    if (!confirm("Replace the entire dashboard with this JSON file? Export a backup first if you need to keep the current contents. Original source files will not change.")) return;
    data.revision = state.revision;
    state = data;
    markChanged();
  } catch (error) {
    showError(`Import failed: ${error.message}`);
  } finally {
    $("#import-file").value = "";
  }
}
async function readSource(name) {
  if (!EDITABLE) {
    showError("Original source documents are not included in the published snapshot.");
    return;
  }
  $("#source-title").textContent = name;
  $("#source-text").textContent = "Loading original source...";
  $("#source-reader").showModal();
  try {
    const response = await fetch(`/sources/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    const text = await response.text();
    if ($("#source-title").textContent === name) $("#source-text").textContent = text;
  } catch (error) {
    $("#source-text").textContent = `Unable to read source: ${error.message}`;
  }
}
async function init() {
  $("#status-filter").innerHTML = options(STATUSES, "All statuses");
  const form = $("#edit-form");
  form.elements.status.innerHTML = options(STATUSES);
  form.elements.priority.innerHTML = options(PRIORITIES);
  form.elements.evidence.innerHTML = options(EVIDENCE);
  form.elements.source.innerHTML = options(Object.keys(SOURCE_DESCRIPTIONS), "No source / new update");
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button, [data-edit]");
    if (!button) return;
    if (button.dataset.close) $(`#${button.dataset.close}`).close();
    else if (state) {
      if (button.dataset.tab) goTo(button.dataset.tab);
      else if (button.dataset.goto) goTo(button.dataset.goto);
      else if (button.dataset.edit) {
        event.preventDefault();
        openEditor(button.dataset.collection, button.dataset.edit);
      }
      else if (button.dataset.add) {
        openEditor(button.dataset.add);
        if (button.dataset.parent) form.elements.parent_id.value = button.dataset.parent;
      }
      else if (button.dataset.source) readSource(button.dataset.source);
    }
  });
  if (EDITABLE) {
    $("#add-record").addEventListener("click", () => openEditor(tab));
    $("#edit-project").addEventListener("click", () => {
      for (const [key, value] of Object.entries(state.project)) $("#project-form").elements.namedItem(key).value = value;
      $("#project-editor").showModal();
    });
    $("#edit-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const record = Object.fromEntries(new FormData(event.target));
      record.title = record.title.trim();
      if (!record.title) {
        form.elements.title.setCustomValidity("Title cannot be blank.");
        form.elements.title.reportValidity();
        return;
      }
      if (record.start && record.due && record.start > record.due) {
        form.elements.due.setCustomValidity("Target date must be on or after the start date.");
        form.elements.due.reportValidity();
        return;
      }
      record.id = editorContext.id || crypto.randomUUID();
      const records = state[editorContext.collection];
      const index = records.findIndex((item) => item.id === record.id);
      if (editorContext.collection === "workstreams") {
        if (record.workflow_type === "Umbrella") record.parent_id = "";
        if (record.workflow_type !== "Umbrella" && state.workstreams.some((item) => item.parent_id === record.id)) {
          showError("Move this umbrella's subprojects before converting it to a project.", "#editor-error");
          return;
        }
      }
      if (editorContext.collection === "people" || editorContext.collection === "infrastructure") {
        const existing = records[index];
        if (editorContext.collection === "people") record.owner = existing ? existing.owner : "";
        record.due = existing ? existing.due : "";
        record.evidence = existing ? existing.evidence : "User update";
        record.source = existing ? existing.source : "";
        if (existing && existing.start !== undefined) record.start = existing.start;
      }
      if (index < 0) records.push(record);
      else records[index] = record;
      $("#editor").close();
      markChanged();
    });
    form.elements.workflow_type.addEventListener("change", () => {
      const umbrella = form.elements.workflow_type.value === "Umbrella";
      if (umbrella) form.elements.parent_id.value = "";
      form.elements.parent_id.disabled = umbrella;
    });
    form.elements.title.addEventListener("input", () => form.elements.title.setCustomValidity(""));
    for (const field of ["start", "due"]) form.elements.namedItem(field).addEventListener("input", () => form.elements.due.setCustomValidity(""));
    $("#project-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const project = Object.fromEntries(new FormData(event.target));
      project.title = project.title.trim();
      if (!project.title) {
        event.target.elements.title.setCustomValidity("Title cannot be blank.");
        event.target.elements.title.reportValidity();
        return;
      }
      state.project = project;
      $("#project-editor").close();
      markChanged();
    });
    $("#project-form").elements.title.addEventListener("input", () => $("#project-form").elements.title.setCustomValidity(""));
    $("#delete-record").addEventListener("click", () => {
      if (editorContext.collection === "workstreams" && state.workstreams.some((item) => item.parent_id === editorContext.id)) {
        showError("Move or delete this umbrella's subprojects before deleting the umbrella. No items were deleted.", "#editor-error");
        return;
      }
      if (!confirm("Delete this dashboard item? The original source files will not change.")) return;
      state[editorContext.collection] = state[editorContext.collection].filter((item) => item.id !== editorContext.id);
      $("#editor").close();
      markChanged();
    });
    $("#import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (event) => {
      if (event.target.files[0]) importState(event.target.files[0]);
    });
    $("#retry").addEventListener("click", persist);
  }
  $("#search").addEventListener("input", renderRecords);
  $("#schedule-person").addEventListener("change", (event) => {
    selectedPersonId = event.target.value;
    renderPersonSchedule();
  });
  for (const selector of ["#status-filter", "#owner-filter", "#priority-filter"]) $(selector).addEventListener("change", renderRecords);
  $("#export").addEventListener("click", exportState);
  window.addEventListener("beforeunload", (event) => {
    if (dirty || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  try {
    const paths = EDITABLE ? ["/api/state", "/api/sources", "/api/contributions"] : ["./dashboard-state.json", "./sources.json", "./contributions.json"];
    [state, sourceList, contributions] = await Promise.all(paths.map((path) => request(path)));
    validateImport(state);
    $("#loading").hidden = true;
    $("#app").hidden = false;
    $("#export").disabled = false;
    $("#import").disabled = !EDITABLE;
    if (!EDITABLE) {
      $("#workspace-label").textContent = "PUBLISHED SNAPSHOT";
      $("#workspace-description").textContent = "Read-only. Updates are published from the local dashboard.";
      $("#snapshot-note").textContent = "Dates and initial statuses require confirmation. Original source documents are not published.";
    }
    render();
    updateSaveStatus();
  } catch (error) {
    $("#loading").textContent = "Dashboard unavailable.";
    showError(`Unable to load dashboard: ${error.message}. ${EDITABLE ? "Run python3 dashboard_server.py and open http://127.0.0.1:8765 (do not open the HTML file directly)." : "Serve the generated docs folder over HTTP, or check that all published JSON files are present. Do not open index.html directly as a file."}`);
  }
}
init();
