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
const copyStatus = document.querySelector<HTMLElement>("[data-copy-status]");
let entries: SearchEntry[] | undefined;
let loading: Promise<void> | undefined;

function announce(message: string) {
  if (copyStatus) copyStatus.textContent = message;
}

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    announce(success);
    return true;
  } catch {
    announce("Copy failed. Select the text instead.");
    return false;
  }
}

function renderResults() {
  if (!query || !results || !status || !entries) return;
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  results.replaceChildren();
  if (!terms.length) {
    status.textContent = "Type to search the guides and API reference.";
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
    ? `${matches.length} ${matches.length === 1 ? "guide" : "guides"} found.`
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

function moveSelection(delta: number) {
  if (!results) return;
  const links = [...results.querySelectorAll("a")];
  if (!links.length) return;
  const current = links.findIndex((link) => link === document.activeElement);
  const next =
    current < 0
      ? delta > 0
        ? 0
        : links.length - 1
      : (current + delta + links.length) % links.length;
  links[next]?.focus();
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
      status.textContent = "Search could not load. Browse the documentation below.";
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
dialog?.addEventListener("keydown", (event) => {
  const target = event.target;
  const inResults = target instanceof Element && target.closest(".search-results");
  if (target !== query && !inResults) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && target === query) {
    const first = results?.querySelector("a");
    if (first) {
      event.preventDefault();
      first.click();
    }
  }
});
document.querySelector("[data-search-close]")?.addEventListener("click", () => dialog?.close());
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing =
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (
    (!editing && event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) ||
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
  ) {
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
    if (await copyText(code.textContent ?? "", "Code copied")) {
      button.textContent = "Copied";
    } else {
      button.textContent = "Select code";
      const range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code");
    }, 2500);
  });
  block.append(button);
}

const copyPage = document.querySelector<HTMLButtonElement>("[data-copy-page]");
if (copyPage) {
  copyPage.hidden = false;
  copyPage.addEventListener("click", async () => {
    const path = copyPage.dataset.copyPage;
    if (!path) return;
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("unavailable");
      if (await copyText(await response.text(), "Page copied as Markdown")) {
        copyPage.textContent = "Copied";
        window.setTimeout(() => {
          copyPage.textContent = "Copy page for your agent";
        }, 2500);
      }
    } catch {
      announce("Could not copy this page. Open the Markdown link instead.");
    }
  });
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
    label: "Meet you in",
    status: "4 friends. No accounts.",
    ticket: "The room is ready",
    description: "One shared code. Everyone joins from their own phone.",
    late: "Jo is watching",
  },
  match: {
    label: "This match is locked.",
    status: "4 players. Late arrivals watch.",
    ticket: "Match in progress",
    description: "Freeze the lineup. New friends can watch, then play next time.",
    late: "Jo is watching",
  },
  rematch: {
    label: "Same room. New round.",
    status: "5 friends. Next match.",
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

const panels = document.querySelectorAll<HTMLElement>("[data-code-panel]");
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-code-tab]")) {
  button.addEventListener("click", () => {
    const tab = button.dataset.codeTab;
    for (const control of document.querySelectorAll("[data-code-tab]")) {
      control.setAttribute("aria-pressed", String(control === button));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.codePanel !== tab;
    }
  });
}

const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc-link]")];
if (tocLinks.length) {
  const headings = tocLinks
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter((heading): heading is HTMLElement => heading !== null);
  const sync = () => {
    const current =
      headings.findLast((heading) => heading.getBoundingClientRect().top <= 120) ?? headings[0];
    for (const link of tocLinks) {
      link.setAttribute("aria-current", link.hash === `#${current.id}` ? "true" : "false");
    }
  };
  sync();
  document.addEventListener("scroll", sync, { passive: true });
}
