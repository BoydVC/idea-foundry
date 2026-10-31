const boardEl = document.querySelector("#idea-board");
const lanesEl = document.querySelector("#stack-lanes");
const lessonsEl = document.querySelector("#lessons");
const chartEl = document.querySelector("#statechart");
const chartSource = document.querySelector("#statechart-source");
const invariantsEl = document.querySelector("#invariants");
const statusEl = document.querySelector("#status");
const versionEl = document.querySelector("#version");
const countsEl = document.querySelector("#counts");
const form = document.querySelector("#new-idea");
const titleInput = document.querySelector("#idea-title");
const showAll = document.querySelector("#show-all");

const LANES = ["specced", "gated", "dispatched", "verified", "rejected", "parked"];
const PARKABLE = new Set(["raw", "restated", "approved", "specced", "gated", "dispatched"]);

let board = { version: 0, ideas: [], specs: [], lessons: [] };
let chart = { edges: [], mermaid: "", invariants: [] };
let focus = "all";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  void post("/api/idea", { title, version: board.version }).then(() => {
    titleInput.value = "";
  });
});

showAll.addEventListener("click", () => {
  focus = "all";
  render();
});

async function load() {
  const [stateResponse, chartResponse] = await Promise.all([fetch("/api/state"), fetch("/api/statechart")]);
  board = await stateResponse.json();
  chart = await chartResponse.json();
  const hash = location.hash.replace("#", "");
  if (hash && board.ideas.some((idea) => idea.id === hash)) focus = hash;
  render();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status === 409) {
    setStatus(data.next || "Re-read the board and retry.");
    await load();
    return data;
  }
  if (!data.ok) {
    setStatus(`${data.error} ${data.next || ""}`.trim());
    await load();
    return data;
  }
  board = { ...board, ...data.snapshot };
  if (data.ideaId) {
    focus = data.ideaId;
    location.hash = data.ideaId;
  }
  setStatus(data.noop ? "Already there." : "Saved.");
  render();
  return data;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function render() {
  versionEl.textContent = `version ${board.version}`;
  const tally = countStates(board.ideas);
  countsEl.textContent = Object.entries(tally).map(([state, count]) => `${count} ${state}`).join(" · ");
  renderIdeas();
  renderLanes();
  renderLessons();
  renderChart();
}

function countStates(records) {
  const tally = {};
  for (const record of records) tally[record.state] = (tally[record.state] || 0) + 1;
  return tally;
}

function renderIdeas() {
  if (board.ideas.length === 0) {
    boardEl.innerHTML = `<li class="empty">No ideas yet. Add one above.</li>`;
    return;
  }
  boardEl.innerHTML = board.ideas.map((idea) => ideaCard(idea)).join("");
  boardEl.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const idea = board.ideas.find((item) => item.id === button.dataset.id);
      if (!idea) return;
      const action = button.dataset.action;
      if (action === "focus") {
        focus = idea.id;
        location.hash = idea.id;
        render();
        return;
      }
      const body = { id: idea.id, version: board.version, recordVersion: idea.version };
      if (action === "approve") {
        const note = boardEl.querySelector(`[data-note="${idea.id}"]`);
        body.note = note ? note.value : "";
      }
      void post(`/api/${action}`, body);
    });
  });
}

function ideaCard(idea) {
  const on = focus === idea.id ? " on" : "";
  const questions = idea.questions.length
    ? `<ol class="questions">${idea.questions.map((question) => `<li>${esc(question)}</li>`).join("")}</ol>`
    : "";
  const restatement = idea.restatement ? `<p>${esc(idea.restatement)}</p>` : "";
  const note = idea.state === "restated"
    ? `<label for="note-${idea.id}">Approval note</label><input id="note-${idea.id}" data-note="${idea.id}" type="text" maxlength="240" placeholder="Ship the sample slice." />`
    : "";
  const buttons = [
    `<button type="button" class="quiet" data-action="focus" data-id="${idea.id}">Show stack</button>`,
    idea.state === "raw" ? actionButton("restate", idea.id, "Restate") : "",
    idea.state === "restated" ? actionButton("approve", idea.id, "Approve") : "",
    idea.state === "approved" ? actionButton("decompose", idea.id, "Decompose") : "",
    idea.state === "specced" || idea.state === "gated" ? actionButton("gate", idea.id, "Run gates") : "",
    PARKABLE.has(idea.state) ? actionButton("park", idea.id, "Park", true) : "",
  ].join("");
  return `<li><article class="${on}" aria-label="${esc(idea.title)}" data-state="${idea.state}">
    <p class="state">${esc(idea.state)}</p>
    <h3 id="${idea.id}-title">${esc(idea.title)}</h3>
    <p class="hint">${esc(idea.id)}</p>
    ${restatement}
    ${questions}
    ${idea.note ? `<p class="hint">Note: ${esc(idea.note)}</p>` : ""}
    ${note}
    <div class="actions">${buttons}</div>
  </article></li>`;
}

function actionButton(action, id, label, quiet) {
  return `<button type="button" ${quiet ? "class=\"quiet\"" : ""} data-action="${action}" data-id="${id}">${label}</button>`;
}

function renderLanes() {
  const specs = focus === "all" ? board.specs : board.specs.filter((spec) => spec.ideaId === focus);
  lanesEl.innerHTML = LANES.map((lane) => {
    const cards = specs.filter((spec) => spec.state === lane).map((spec) => specCard(spec)).join("");
    return `<div class="lane" data-lane="${lane}"><h3>${lane}</h3>${cards || `<p class="empty">None</p>`}</div>`;
  }).join("");
  lanesEl.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const spec = board.specs.find((item) => item.id === button.dataset.id);
      if (!spec) return;
      const body = { id: spec.id, version: board.version, recordVersion: spec.version };
      if (button.dataset.action === "verify" || button.dataset.action === "reject") {
        const verdict = button.dataset.action === "verify" ? "verified" : "rejected";
        body.draft = true;
        body.pr = `https://github.com/BoydVC/idea-foundry/pull/${spec.index}`;
        body.report = `---\ndraft: true\nverdict: ${verdict}\n---\nSample report for ${spec.id}. Synthetic data only. No personal data.\n`;
        void post("/api/ingest", body);
        return;
      }
      void post(`/api/${button.dataset.action}`, body);
    });
  });
}

function specCard(spec) {
  const idea = board.ideas.find((item) => item.id === spec.ideaId);
  const chips = (spec.gates.length ? spec.gates : ["G1", "G2", "G3"].map((gate) => ({ gate, pass: null, reasons: [] })))
    .map((gate) => {
      const tone = gate.pass === true ? "pass" : gate.pass === false ? "fail" : "";
      const label = gate.pass === null ? `${gate.gate} not run` : `${gate.gate} ${gate.pass ? "pass" : "fail"}`;
      const reason = gate.reasons && gate.reasons.length ? gate.reasons.join(" ") : label;
      return `<span class="chip ${tone}" data-gate="${gate.gate}" title="${esc(reason)}">${esc(label)}</span>`;
    })
    .join("");
  const buttons = [
    spec.state === "gated" ? `<button type="button" data-action="dispatch" data-id="${spec.id}">Dispatch</button>` : "",
    spec.state === "dispatched" ? `<button type="button" data-action="verify" data-id="${spec.id}">Record verified draft</button>` : "",
    spec.state === "dispatched" ? `<button type="button" class="quiet" data-action="reject" data-id="${spec.id}">Record rejected draft</button>` : "",
    PARKABLE.has(spec.state) ? `<button type="button" class="quiet" data-action="park" data-id="${spec.id}">Park</button>` : "",
  ].join("");
  const pr = spec.prUrl ? `<p><a href="${esc(spec.prUrl)}">Draft pull request</a></p>` : "";
  return `<article aria-label="${esc(spec.id)} ${esc(spec.title)}" data-state="${spec.state}">
    <p class="hint">Step ${spec.index}${idea ? ` · ${esc(idea.title)}` : ""}</p>
    <h3>${esc(spec.title)}</h3>
    <p>${esc(spec.summary)}</p>
    <div class="chips">${chips}</div>
    ${pr}
    <div class="actions">${buttons}</div>
  </article>`;
}

function renderLessons() {
  if (board.lessons.length === 0) {
    lessonsEl.innerHTML = `<li class="empty">No repeated finding yet. A finding becomes a check after it happens twice.</li>`;
    return;
  }
  lessonsEl.innerHTML = board.lessons
    .map((lesson) => `<li class="lesson"><strong>${esc(lesson.code)}</strong> · ${esc(lesson.gate)} · seen ${lesson.count} times<p>${esc(lesson.check)}</p><p>${esc(lesson.detail)}</p></li>`)
    .join("");
}

function renderChart() {
  const edges = chart.edges || [];
  chartEl.innerHTML = edges.length
    ? edges.map((edge) => `<li class="chart-node"><strong>${esc(edge.from)}</strong> ${esc(edge.label.replaceAll("_", " "))} <strong>${esc(edge.to)}</strong></li>`).join("")
    : `<li class="empty">The statechart is not loaded.</li>`;
  chartSource.textContent = chart.mermaid || "";
  invariantsEl.textContent = chart.invariants ? `Checked by TLC: ${chart.invariants.join(", ")}.` : "";
}

load().catch((error) => setStatus(error.message));
