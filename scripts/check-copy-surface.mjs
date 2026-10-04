import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

const defaultPath = fileURLToPath(new URL("../examples/first-tap/convex/game.ts", import.meta.url));
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : defaultPath;
const sourceText = readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const failures = [];
let tap;

const propertyName = (property) => {
  if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
    return property.name.text;
  }
  return undefined;
};

const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "tap") {
    tap = node.initializer;
  }

  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "completeMatch"
  ) {
    const input = node.arguments[1];
    const hasActor =
      input &&
      ts.isObjectLiteralExpression(input) &&
      input.properties.some((property) => propertyName(property) === "actor");
    if (!hasActor) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      failures.push(`completeMatch call at line ${position.line + 1} must include actor`);
    }
  }

  ts.forEachChild(node, visit);
};

visit(sourceFile);

let tapReferencesParticipants = false;
if (tap) {
  const inspectTap = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "query" &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === "matchParticipants",
      )
    ) {
      tapReferencesParticipants = true;
    }
    ts.forEachChild(node, inspectTap);
  };
  inspectTap(tap);
}

if (!tapReferencesParticipants) {
  failures.push("tap must query matchParticipants");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Copy surface check failed: ${failure}`);
  }
  process.exitCode = 1;
}
