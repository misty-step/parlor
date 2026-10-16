import assert from "node:assert/strict";

const title = process.env.PR_TITLE ?? "";
assert.doesNotMatch(
  title,
  /\p{Cc}|<|>|\[|\]/u,
  "Release titles are plain text, not active HTML or Markdown links",
);
assert.match(
  title,
  /^(?:feat|fix|chore|docs|test|build|ci|refactor|style|perf|revert)(?:\([^()\r\n]+\))?!?: [^\r\n]+$/,
  "Use a public, user-facing Conventional Commit title",
);
