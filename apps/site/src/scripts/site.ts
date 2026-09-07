interface SearchEntry {
  title: string;
  description: string;
  url: string;
  body: string;
}

const dialog = document.querySelector<HTMLDialogElement>("#doc-search");
const query = document.querySelector<HTMLInputElement>("#search-query");
const results = document.querySelector<HTMLUListElement>(".search-results");
const status = document.querySelector<HTMLParagraphElement>(".search-status");
const trigger = document.querySelector<HTMLButtonElement>("[data-search-open]");
let entries: SearchEntry[] | undefined;
let loading: Promise<void> | undefined;

function renderResults() {
  if (!query || !results || !status || !entries) return;
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  results.replaceChildren();
  if (!terms.length) {
    status.textContent = "Type to search guides and API reference.";
    return;
  }
  const matches = entries
    .filter((entry) =>
      terms.every((term) =>
        `${entry.title} ${entry.description} ${entry.body}`.toLowerCase().includes(term),
      ),
    )
    .map((entry) => ({
      entry,
      rank: terms.reduce(
        (score, term) =>
          score +
          (entry.title.toLowerCase().includes(term) ? 3 : 0) +
          (entry.description.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 8);
  status.textContent = matches.length
    ? `${matches.length} ${matches.length === 1 ? "guide" : "guides"} found. Tab to explore results.`
    : "No guides found. Try “rooms”, “auth”, or “matches”.";
  for (const { entry } of matches) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.url;
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const description = document.createElement("span");
    description.textContent = entry.description;
    link.append(title, description);
    item.append(link);
    results.append(item);
  }
}

async function openSearch() {
  if (!dialog || !query || !status) return;
  if (!dialog.open) dialog.showModal();
  query.focus();
  if (!entries) {
    status.textContent = "Loading documentation…";
    loading ??= fetch("/search.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("Search unavailable");
        entries = (await response.json()) as SearchEntry[];
      })
      .finally(() => {
        loading = undefined;
      });
    try {
      await loading;
    } catch {
      status.textContent =
        "Search could not load. Check your connection or browse the documentation below.";
      return;
    }
  }
  renderResults();
}

if (trigger) {
  trigger.hidden = false;
  trigger.addEventListener("click", () => {
    void openSearch();
  });
}
query?.addEventListener("input", renderResults);
document.querySelector("[data-search-close]")?.addEventListener("click", () => dialog?.close());
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing =
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !editing) {
    event.preventDefault();
    void openSearch();
  }
});

for (const block of document.querySelectorAll<HTMLPreElement>(".prose pre, pre[data-copy]")) {
  const code = block.querySelector("code");
  if (!code) continue;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy code");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      button.textContent = "Copied";
      button.setAttribute("aria-label", "Code copied");
    } catch {
      button.textContent = "Select code";
      const range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      button.setAttribute("aria-label", "Code selected; copy with your keyboard");
    }
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code");
    }, 2500);
  });
  block.append(button);
}

for (const menu of document.querySelectorAll<HTMLDetailsElement>(".mobile-menu")) {
  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") menu.open = false;
  });
}

const roomPhases = {
  lobby: {
    label: "One room. Everyone in.",
    status: "4 friends, no accounts",
    ticket: "Room ready",
    description: "Share a code. Friends join from their phones.",
    late: "Jo is watching",
  },
  match: {
    label: "Your game takes the floor.",
    status: "4 players locked in",
    ticket: "Match in progress",
    description: "Freeze the lineup. Late arrivals watch this match.",
    late: "Jo is watching",
  },
  rematch: {
    label: "Same room. New round.",
    status: "5 friends, next match",
    ticket: "Jo can play next",
    description: "Keep the room. Include new friends in the next match.",
    late: "Jo is playing",
  },
} as const;

const sketch = document.querySelector<HTMLElement>("[data-room-sketch]");
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-phase-button]")) {
  button.addEventListener("click", () => {
    const phase = button.dataset.phaseButton;
    if (!sketch || (phase !== "lobby" && phase !== "match" && phase !== "rematch")) return;
    const next = roomPhases[phase];
    sketch.dataset.phase = phase;
    const updates: Array<[string, string]> = [
      ["[data-room-label]", next.label],
      ["[data-room-status]", next.status],
      ["[data-ticket]", next.ticket],
      ["[data-sketch-description]", next.description],
      ["[data-late-copy]", next.late],
    ];
    for (const [selector, text] of updates) {
      const element = sketch.querySelector(selector);
      if (element) element.textContent = text;
    }
    const latePlayer = sketch.querySelector<HTMLElement>("[data-late-player]");
    if (latePlayer) latePlayer.hidden = phase === "lobby";
    for (const control of sketch.querySelectorAll("[data-phase-button]")) {
      control.setAttribute("aria-pressed", String(control === button));
    }
  });
}

const navigation = document.querySelector<HTMLDetailsElement>(".docs-navigation");
if (navigation) {
  const mobile = window.matchMedia("(max-width: 900px)");
  const updateNavigation = () => {
    navigation.open = !mobile.matches;
  };
  updateNavigation();
  mobile.addEventListener("change", updateNavigation);
}

export { openSearch };
