const PHASES = ["raw", "restated", "approved", "specced", "gated", "dispatched", "verified", "rejected", "parked"];
const DEMO_PR = "https://github.com/example-org/demo-board/pull/1";

const POS = {
  raw: [70, 48],
  restated: [210, 48],
  approved: [350, 48],
  specced: [490, 48],
  gated: [630, 48],
  dispatched: [770, 48],
  verified: [910, 48],
  rejected: [770, 150],
  parked: [70, 150],
};

let selected = null;

const board = document.querySelector("#board");
const detail = document.querySelector("#detail");
const banner = document.querySelector("#banner");
const lessons = document.querySelector("#lessons");
const chart = document.querySelector("#statechart");
const chartSrc = document.querySelector("#statechart-src");

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "hidden") node.hidden = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function showError(result) {
  if (!result) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  if (result.ok === false) {
    banner.hidden = false;
    banner.textContent = `${result.message} ${result.next}`;
    return;
  }
  if (typeof result.warning === "string" && result.warning.length > 0) {
    banner.hidden = false;
    banner.textContent = result.warning;
    return;
  }
  banner.hidden = true;
  banner.textContent = "";
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response.text();
}

function specsFor(state, idea) {
  if (!idea || !idea.stackId) return [];
  return state.specs.filter((spec) => spec.stackId === idea.stackId).sort((a, b) => a.index - b.index);
}

function renderBoard(state) {
  board.replaceChildren();
  for (const phase of PHASES) {
    const column = el("div", { class: "column" });
    const ideas = state.ideas.filter((idea) => idea.state === phase);
    column.append(el("h3", { text: `${phase} ${ideas.length}` }));
    for (const idea of ideas) {
      const card = el("button", {
        class: idea.id === selected ? "card selected" : "card",
        type: "button",
        "data-testid": `idea-${idea.id}`,
      });
      card.append(el("span", { class: "id", text: idea.id }));
      card.append(el("strong", { text: idea.title }));
      card.addEventListener("click", () => {
        selected = idea.id;
        renderBoard(state);
        renderDetail(state);
      });
      column.append(card);
    }
    board.append(column);
  }
}

function actionButton(label, testid, onClick) {
  const button = el("button", { type: "button", text: label, "data-testid": testid });
  button.addEventListener("click", onClick);
  return button;
}

function renderDetail(state) {
  detail.replaceChildren();
  const idea = state.ideas.find((item) => item.id === selected) || state.ideas[0];
  if (!idea) {
    detail.append(el("p", { text: "Add an idea to open a stack." }));
    return;
  }
  selected = idea.id;
  detail.append(el("h2", { text: idea.title }));
  detail.append(el("p", { class: "mono", text: `${idea.id} · ${idea.state} · v${idea.version}` }));
  if (idea.restatement) detail.append(el("p", { text: idea.restatement }));
  const actions = el("div", { class: "actions" });
  if (idea.state === "raw") {
    actions.append(actionButton("Restate", "action-restate", () => post(`/api/idea/${idea.id}/restate`, { version: idea.version })));
  }
  if (idea.state === "restated") {
    const note = el("input", { class: "note", id: "approve-note", "data-testid": "approve-note", value: "Ship the smallest slice" });
    actions.append(note);
    actions.append(actionButton("Approve", "action-approve", () => post(`/api/idea/${idea.id}/approve`, { note: note.value, version: idea.version })));
  }
  if (idea.state === "approved") {
    actions.append(actionButton("Decompose", "action-decompose", () => post(`/api/idea/${idea.id}/decompose`, { version: idea.version })));
  }
  if (idea.state === "specced" || idea.state === "gated") {
    actions.append(actionButton("Run gates", "action-gate", () => post(`/api/idea/${idea.id}/gate`, { version: idea.version })));
  }
  if (idea.state !== "parked" && idea.state !== "verified" && idea.state !== "rejected") {
    actions.append(actionButton("Park", "action-park", () => post(`/api/idea/${idea.id}/park`, { version: idea.version })));
  }
  detail.append(actions);

  const specs = specsFor(state, idea);
  if (specs.length === 0) return;
  const lanes = el("div", { class: "lanes", "data-testid": "lanes" });
  for (const spec of specs) {
    const lane = el("article", { class: "lane", "data-testid": `spec-${spec.id}` });
    lane.append(el("div", { class: "index", text: spec.index === 1 ? `bottom · ${spec.id}` : `slice ${spec.index} · ${spec.id}` }));
    lane.append(el("h3", { text: spec.title }));
    lane.append(el("p", { class: "mono", text: spec.state }));
    for (const gate of spec.gates) {
      const row = el("p", {
        class: gate.pass ? "pass" : "fail",
        "data-testid": `gate-${spec.id}-${gate.gate}`,
        text: gate.pass ? `${gate.gate} pass` : `${gate.gate} fail: ${gate.findings.map((item) => item.detail).join(" ")}`,
      });
      lane.append(row);
    }
    if (spec.state === "gated") {
      lane.append(actionButton("Dispatch", `dispatch-${spec.id}`, () => post(`/api/spec/${spec.id}/dispatch`, { version: spec.version })));
    }
    if (spec.state === "dispatched") {
      const pr = el("input", { class: "pr", "data-testid": `ingest-pr-${spec.id}`, value: DEMO_PR });
      const draft = el("input", { type: "checkbox", "data-testid": `ingest-draft-${spec.id}` });
      draft.checked = true;
      const draftLabel = el("label", { text: " Draft pull request" });
      draftLabel.prepend(draft);
      lane.append(pr, draftLabel);
      lane.append(
        actionButton("Ingest", `ingest-${spec.id}`, () =>
          post(`/api/spec/${spec.id}/ingest`, { pr: pr.value, draft: draft.checked, verdict: "verified", version: spec.version }),
        ),
      );
    }
    lanes.append(lane);
  }
  detail.append(lanes);
}

function renderLessons(state) {
  lessons.replaceChildren();
  if (state.lessons.length === 0) {
    lessons.append(el("li", { text: "No repeated finding yet." }));
    return;
  }
  for (const lesson of state.lessons) {
    lessons.append(el("li", { text: `${lesson.key} repeated ${lesson.count} times. Promoted to ${lesson.promotedTo}. ${lesson.detail}` }));
  }
}

function renderHealth(health) {
  const root = document.querySelector("#health-stats");
  if (!root) return;
  const pipe = health && health.pipeline;
  root.replaceChildren();
  if (!pipe) return;
  const states = el("p", { "data-testid": "health-states" });
  for (const phase of PHASES) states.append(el("span", { class: "chip", text: `${phase} ${pipe.ideasByState[phase] || 0}` }));
  const rates = ["G1", "G2", "G3"]
    .map((id) => {
      const row = pipe.gatePassRates[id];
      const label = !row || row.rate === null ? "n/a" : `${Math.round(row.rate * 100)}%`;
      return `${id} ${label}`;
    })
    .join(" · ");
  const mean = pipe.meanMinutesIdeaToVerified === null ? "n/a" : `${pipe.meanMinutesIdeaToVerified} min`;
  const card = (title, node) => {
    const article = el("article");
    article.append(el("h3", { text: title }));
    article.append(node);
    return article;
  };
  root.append(
    card("Ideas by state", states),
    card("Gate pass rates", el("p", { text: rates, "data-testid": "health-gates" })),
    card("Mean time idea to verified", el("p", { text: mean, "data-testid": "health-mean" })),
    card("Lessons promoted", el("p", { text: String(pipe.lessonsPromoted), "data-testid": "health-lessons" })),
  );
}

function renderChart(source, counts) {
  chartSrc.textContent = source;
  const edges = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^\s*([a-z]+) --> ([a-z]+): ([a-z_]+)\s*$/);
    if (match) edges.push({ from: match[1], to: match[2], event: match[3] });
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1000 210");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Lifecycle statechart");
  for (const edge of edges) {
    const start = POS[edge.from];
    const end = POS[edge.to];
    if (!start || !end) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(start[0]));
    line.setAttribute("y1", String(start[1]));
    line.setAttribute("x2", String(end[0]));
    line.setAttribute("y2", String(end[1]));
    line.setAttribute("stroke", "#1d1a16");
    line.setAttribute("stroke-width", "1.2");
    svg.append(line);
  }
  for (const phase of PHASES) {
    const at = POS[phase];
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(at[0] - 48));
    rect.setAttribute("y", String(at[1] - 18));
    rect.setAttribute("width", "96");
    rect.setAttribute("height", "36");
    rect.setAttribute("fill", counts[phase] ? "#b45324" : "#fbf6ec");
    rect.setAttribute("stroke", "#1d1a16");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(at[0]));
    text.setAttribute("y", String(at[1] + 4));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "DejaVu Sans Mono, ui-monospace, monospace");
    text.textContent = `${phase} ${counts[phase] || 0}`;
    group.append(rect, text);
    svg.append(group);
  }
  chart.replaceChildren(svg);
}

async function refresh(keep) {
  const [state, source, health] = await Promise.all([api("/api/state"), api("/api/statechart"), api("/api/health")]);
  if (health && health.port) document.querySelector("#port-label").textContent = `:${health.port}`;
  if (!keep && !selected && state.ideas[0]) selected = state.ideas[0].id;
  const counts = {};
  for (const phase of PHASES) counts[phase] = state.ideas.filter((idea) => idea.state === phase).length;
  renderBoard(state);
  renderDetail(state);
  renderLessons(state);
  renderHealth(health);
  renderChart(source, counts);
  return state;
}

async function post(path, body) {
  const result = await api(path, body);
  showError(result);
  if (result && result.ok && result.data && result.data.id) selected = result.data.id;
  if (result && result.ok && result.data && result.data.idea && result.data.idea.id) selected = result.data.idea.id;
  await refresh(true);
}

document.querySelector("#add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#add-idea-title");
  const result = await api("/api/idea", { title: input.value });
  showError(result);
  if (result && result.ok && result.data) selected = result.data.id;
  input.value = "";
  await refresh(true);
});

refresh(false).catch((error) => {
  banner.hidden = false;
  banner.textContent = error instanceof Error ? error.message : "The board failed to load.";
});
