const columns = ["raw", "restated", "approved", "specced", "gated", "dispatched", "verified", "rejected", "parked"];
const statusNode = document.querySelector("#status");
const boardNode = document.querySelector("#board");
const detailNode = document.querySelector("#detail");
const lessonsNode = document.querySelector("#lessons");
let selected = null;
let snapshot = null;

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  return { response, body };
}

function say(text) {
  statusNode.textContent = text;
}

async function refresh() {
  const { body } = await api("/api/state");
  snapshot = body;
  drawBoard();
  drawDetail();
  drawLessons();
}

function drawBoard() {
  boardNode.replaceChildren();
  for (const state of columns) {
    const column = document.createElement("div");
    column.className = "column";
    const heading = document.createElement("h3");
    heading.textContent = state;
    column.append(heading);
    const ideas = snapshot.ideas.filter((item) => item.state === state);
    for (const idea of ideas) {
      const button = document.createElement("button");
      button.className = "card";
      button.type = "button";
      button.setAttribute("aria-pressed", idea.id === selected ? "true" : "false");
      button.dataset.ideaId = idea.id;
      button.name = idea.title;
      const title = document.createElement("div");
      title.textContent = idea.title;
      const meta = document.createElement("small");
      meta.textContent = idea.id;
      button.append(title, meta);
      button.addEventListener("click", () => {
        selected = idea.id;
        drawBoard();
        drawDetail();
      });
      column.append(button);
    }
    boardNode.append(column);
  }
}

function drawDetail() {
  const idea = snapshot.ideas.find((item) => item.id === selected);
  if (!idea) {
    detailNode.textContent = "Select an idea on the board.";
    return;
  }
  detailNode.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = idea.title;
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${idea.id} · ${idea.state} · record v${idea.version}`;
  detailNode.append(title, meta);
  if (idea.restatement) {
    const text = document.createElement("p");
    text.textContent = idea.restatement;
    detailNode.append(text);
  }
  if (idea.questions) {
    const list = document.createElement("ol");
    for (const question of idea.questions) {
      const item = document.createElement("li");
      item.textContent = question;
      list.append(item);
    }
    detailNode.append(list);
  }
  if (idea.note) {
    const note = document.createElement("p");
    note.textContent = `Note: ${idea.note}`;
    detailNode.append(note);
  }
  const actions = document.createElement("div");
  actions.className = "row";
  if (idea.state === "raw") {
    actions.append(actionButton("Restate", () => postIdea(idea.id, "restate")));
  }
  if (idea.state === "restated") {
    const note = document.createElement("input");
    note.id = "approve-note";
    note.setAttribute("aria-label", "Approval note");
    note.value = "Use the fixture only";
    const approve = actionButton("Approve", () => postIdea(idea.id, "approve", { note: note.value }));
    actions.append(note, approve);
  }
  if (idea.state === "approved") {
    actions.append(actionButton("Decompose", () => postIdea(idea.id, "decompose")));
  }
  if (idea.state === "specced" || idea.state === "gated") {
    actions.append(actionButton("Run gates", () => postIdea(idea.id, "gate")));
  }
  if (idea.state !== "parked" && idea.state !== "verified" && idea.state !== "dispatched") {
    actions.append(actionButton("Park", () => postIdea(idea.id, "park"), "secondary"));
  }
  detailNode.append(actions);
  const specs = snapshot.specs.filter((spec) => spec.ideaId === idea.id).sort((a, b) => a.order - b.order);
  for (const spec of specs) {
    detailNode.append(renderSpec(spec));
  }
}

function renderSpec(spec) {
  const lane = document.createElement("article");
  lane.className = "lane";
  lane.dataset.specId = spec.id;
  const order = document.createElement("div");
  order.className = "meta";
  order.textContent = spec.order === 1 ? "1 lands first" : String(spec.order);
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = spec.title;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${spec.id} · ${spec.state}`;
  body.append(title, meta);
  const gates = snapshot.gates.filter((gate) => gate.specId === spec.id);
  if (gates.length > 0) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const gate of gates) {
      const chip = document.createElement("span");
      chip.className = `chip ${gate.pass ? "pass" : "fail"}`;
      chip.textContent = `${gate.gate} ${gate.pass ? "pass" : "fail"}`;
      chips.append(chip);
    }
    body.append(chips);
  }
  const side = document.createElement("div");
  if (spec.state === "gated") {
    side.append(actionButton("Dispatch", () => postSpec(spec.id, "dispatch")));
  }
  if (spec.state === "dispatched") {
    side.append(ingestForm(spec));
  }
  lane.append(order, body, side);
  return lane;
}

function ingestForm(spec) {
  const form = document.createElement("form");
  form.className = "row";
  const pr = document.createElement("input");
  pr.setAttribute("aria-label", `Draft PR for ${spec.id}`);
  pr.value = "https://github.com/BoydVC/idea-foundry/pull/1";
  const outcome = document.createElement("select");
  outcome.setAttribute("aria-label", `Outcome for ${spec.id}`);
  for (const value of ["verified", "rejected"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    outcome.append(option);
  }
  const draftLabel = document.createElement("label");
  const draft = document.createElement("input");
  draft.type = "checkbox";
  draft.checked = true;
  draft.setAttribute("aria-label", `Draft pull request for ${spec.id}`);
  draftLabel.append(draft, document.createTextNode(" draft"));
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Record outcome";
  form.append(pr, outcome, draftLabel, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    say(`Recording ${spec.id}`);
    const { response, body } = await api(`/api/spec/${spec.id}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prUrl: pr.value,
        outcome: outcome.value,
        draft: draft.checked,
        reportText: `draft: ${draft.checked}\noutcome: ${outcome.value}\n`,
      }),
    });
    say(response.ok ? `${spec.id} is ${body.spec.state}` : body.error);
    await refresh();
  });
  return form;
}

function actionButton(label, run, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  button.addEventListener("click", async () => {
    say(label);
    await run();
  });
  return button;
}

async function postIdea(id, action, payload) {
  const { response, body } = await api(`/api/idea/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  say(response.ok ? `${id} updated` : body.error);
  await refresh();
}

async function postSpec(id, action) {
  const { response, body } = await api(`/api/spec/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  say(response.ok ? `${id} dispatched` : body.error);
  await refresh();
}

function drawLessons() {
  lessonsNode.replaceChildren();
  if (snapshot.lessons.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No repeated finding has been encoded yet.";
    lessonsNode.append(item);
    return;
  }
  for (const lesson of snapshot.lessons) {
    const item = document.createElement("li");
    item.textContent = `${lesson.id} encoded as ${lesson.encodedAs}: ${lesson.finding}`;
    lessonsNode.append(item);
  }
}

async function drawChart() {
  const { body } = await api("/api/statechart");
  const chart = document.querySelector("#chart");
  chart.replaceChildren();
  const path = ["raw", "restated", "approved", "specced", "gated", "dispatched", "verified"];
  const chips = document.createElement("div");
  chips.className = "chips";
  path.forEach((state, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = index === 0 ? state : `→ ${state}`;
    chips.append(chip);
  });
  chart.append(chips);
  const list = document.createElement("ul");
  for (const row of body.rows) {
    const item = document.createElement("li");
    item.textContent = `${row.from} ${row.event} ${row.to}`;
    list.append(item);
  }
  chart.append(list);
  document.querySelector("#chart-source").textContent = body.mmd;
}

document.querySelector("#add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title");
  const { response, body } = await api("/api/idea", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (response.ok) {
    selected = body.idea.id;
    say(`Added ${body.idea.id}`);
    form.reset();
  } else {
    say(body.error);
  }
  await refresh();
});

document.querySelector("#merge-button").addEventListener("click", async () => {
  const { response, body } = await api("/api/merge", { method: "POST", body: "{}" });
  document.querySelector("#merge-result").textContent = `${response.status} ${body.error}`;
});

refresh().then(drawChart);
