import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { JSONValue } from "convex/values";
import { documentsChecksum, type TableStats } from "./snapshot.js";

/**
 * Convex snapshot ZIPs (`npx convex export`, `npx convex import`) as plain
 * data, for operators moving an app between Convex and this adapter. A
 * snapshot holds `_tables/documents.jsonl` (each user table's name and
 * number) and `<table>/documents.jsonl` (one document per line). Only user
 * tables move: file storage, components and special-typed values (Int64,
 * Bytes, special floats) are refused, in both directions, rather than
 * silently dropped or re-typed, and system tables such as
 * `_scheduled_functions` are reported but never imported. Errors name
 * tables and ZIP entries, never document content.
 */
export interface ConvexSnapshot {
  /** User table name to Convex table number (the number inside every `_id`). */
  readonly tables: Readonly<Record<string, number>>;
  /** User table name to its documents, as they appear in `documents.jsonl`. */
  readonly documents: Readonly<Record<string, readonly JSONValue[]>>;
  /** System tables present in the ZIP (`_scheduled_functions`, ...), not imported. */
  readonly systemTables: readonly string[];
}

export class SnapshotFormatError extends Error {
  override readonly name = "SnapshotFormatError";
}

const DOCUMENTS = /^([^/]+)\/documents\.jsonl$/;
const SCHEMA = /^([^/]+)\/generated_schema\.jsonl$/;
// Convex writes `"uniform"` when every value in a table is its own JSON.
// Anything else records values plain JSON cannot carry (Int64, Bytes, special
// floats), whose documents.jsonl text is not the value, so it is refused.
const UNIFORM = "uniform";
/** Convex's table-name rule; anything else is refused unnamed. */
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** `convexToJson`'s encodings for values JSON lacks: Int64, Bytes, special floats. */
const ENCODINGS = new Set(["$integer", "$bytes", "$float"]);

/** A ZIP entry name for an error message, or a placeholder for an odd one. */
function shownEntry(entry: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/.test(entry) ? entry : "(an oddly named entry)";
}

/**
 * The first value in `rows` that a Convex import of plain-JSON documents
 * would not restore exactly, described without its content: an encoded
 * Int64, Bytes or special float (`{"$integer": ...}`; Convex field names
 * never start with `$`), any other `$` field, a non-finite number, or -0.
 */
function specialValue(rows: readonly JSONValue[]): string | null {
  const pending: unknown[] = [...rows];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "a non-finite number";
      if (Object.is(value, -0)) return "negative zero";
    } else if (Array.isArray(value)) {
      pending.push(...value);
    } else if (value !== null && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key.startsWith("$"))
          return ENCODINGS.has(key) ? `an encoded ${key} value` : "a reserved $ field";
        pending.push(inner);
      }
    }
  }
  return null;
}

function refuseSpecialValues(table: string, rows: readonly JSONValue[]) {
  const found = specialValue(rows);
  if (found !== null) {
    throw new SnapshotFormatError(
      `${table} holds ${found}, which plain JSON cannot carry (Int64, Bytes or special floats need Convex's generated schema); this tool does not convert it`,
    );
  }
}

function jsonl(bytes: Uint8Array, entry: string): JSONValue[] {
  const values: JSONValue[] = [];
  const lines = strFromU8(bytes).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    try {
      values.push(JSON.parse(line) as JSONValue);
    } catch {
      throw new SnapshotFormatError(`${shownEntry(entry)} line ${index + 1} is not JSON`);
    }
  }
  return values;
}

/** Parse a Convex snapshot ZIP; refuses anything this adapter cannot import exactly. */
export function readConvexSnapshot(zip: Uint8Array): ConvexSnapshot {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new SnapshotFormatError("Not a ZIP archive that can be read");
  }
  const tablesEntry = entries["_tables/documents.jsonl"];
  if (tablesEntry === undefined) {
    throw new SnapshotFormatError("Not a Convex snapshot: _tables/documents.jsonl is missing");
  }
  const tables: Record<string, number> = {};
  const systemTables: string[] = [];
  for (const row of jsonl(tablesEntry, "_tables/documents.jsonl")) {
    const { name, id } = (row ?? {}) as { name?: unknown; id?: unknown };
    if (typeof name !== "string" || !Number.isSafeInteger(id)) {
      throw new SnapshotFormatError("_tables/documents.jsonl has a row without name and id");
    }
    if (!TABLE_NAME.test(name))
      throw new SnapshotFormatError("_tables/documents.jsonl lists a name Convex does not allow");
    if (name.startsWith("_")) systemTables.push(name);
    else if (name in tables) throw new SnapshotFormatError(`Table ${name} is listed twice`);
    else tables[name] = id as number;
  }
  const documents: Record<string, JSONValue[]> = Object.fromEntries(
    Object.keys(tables).map((name) => [name, [] as JSONValue[]]),
  );
  const unsupported: string[] = [];
  for (const [entry, bytes] of Object.entries(entries)) {
    if (entry.endsWith("/") || entry === "README.md" || entry === "_tables/documents.jsonl")
      continue;
    if (entry.startsWith("_components/")) {
      unsupported.push(entry);
      continue;
    }
    const schema = SCHEMA.exec(entry);
    if (schema !== null) {
      const shape = jsonl(bytes, entry);
      if (!(shape.length === 0 || (shape.length === 1 && shape[0] === UNIFORM))) {
        throw new SnapshotFormatError(
          `${shownEntry(schema[1]!)} has values that are not plain JSON (Int64, Bytes or special floats), which this tool does not convert`,
        );
      }
      continue;
    }
    const match = DOCUMENTS.exec(entry);
    const table = match?.[1];
    if (table === undefined) {
      unsupported.push(entry);
      continue;
    }
    if (table.startsWith("_")) {
      if (table === "_storage" && jsonl(bytes, entry).length > 0) unsupported.push(entry);
      else if (!systemTables.includes(table)) systemTables.push(table);
      continue;
    }
    const target = documents[table];
    if (target === undefined) {
      throw new SnapshotFormatError(`${shownEntry(entry)} belongs to a table missing from _tables`);
    }
    target.push(...jsonl(bytes, entry));
  }
  if (unsupported.length > 0) {
    throw new SnapshotFormatError(
      `Snapshot holds data this adapter does not import (file storage, components or unknown files): ${unsupported.sort().map(shownEntry).join(", ")}`,
    );
  }
  // A table without generated-schema metadata (or with crafted text) could
  // still hold encoded Int64/Bytes/special floats; Convex would not restore
  // them as plain JSON, so neither direction of this tool accepts them.
  for (const [table, rows] of Object.entries(documents)) refuseSpecialValues(table, rows);
  return { tables, documents, systemTables: systemTables.sort() };
}

/**
 * Write user tables as a ZIP that `npx convex import --replace-all` accepts.
 * It holds plain JSON only, so a table with an Int64, Bytes or special-float
 * value is refused before any bytes are produced.
 */
export function writeConvexSnapshot(
  snapshot: Pick<ConvexSnapshot, "tables" | "documents">,
): Uint8Array {
  const names = Object.keys(snapshot.tables).sort(
    (a, b) => snapshot.tables[a]! - snapshot.tables[b]!,
  );
  for (const name of names) {
    if (!TABLE_NAME.test(name))
      throw new SnapshotFormatError("Refusing to write a table name Convex does not allow");
    if (name.startsWith("_"))
      throw new SnapshotFormatError(`Refusing to write system table ${name}`);
    refuseSpecialValues(name, snapshot.documents[name] ?? []);
  }
  for (const name of Object.keys(snapshot.documents)) {
    if (!(name in snapshot.tables))
      throw new SnapshotFormatError(`Documents for ${shownEntry(name)} have no table number`);
  }
  const files: Zippable = {};
  files["_tables/documents.jsonl"] = strToU8(
    names.map((name) => `${JSON.stringify({ name, id: snapshot.tables[name] })}\n`).join(""),
  );
  for (const name of names) {
    const rows = snapshot.documents[name] ?? [];
    files[`${name}/documents.jsonl`] = strToU8(
      rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
    );
  }
  return zipSync(files, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}

/** Per-table number, count and canonical checksum, as `GET /admin/stats` reports them. */
export async function snapshotStats(
  snapshot: Pick<ConvexSnapshot, "tables" | "documents">,
): Promise<Record<string, TableStats>> {
  const stats: Record<string, TableStats> = {};
  for (const name of Object.keys(snapshot.tables).sort()) {
    const rows = snapshot.documents[name] ?? [];
    stats[name] = {
      number: snapshot.tables[name]!,
      count: rows.length,
      sha256: await documentsChecksum(rows),
    };
  }
  return stats;
}

export interface StatsDifference {
  readonly table: string;
  readonly left: TableStats | null;
  readonly right: TableStats | null;
}

/**
 * Tables whose number, count or checksum differ. A table that exists on only
 * one side counts as a difference unless it is empty there: an empty table and
 * an absent one hold the same data, but its number still has to agree when
 * both sides list it.
 */
export function compareStats(
  left: Readonly<Record<string, TableStats>>,
  right: Readonly<Record<string, TableStats>>,
): StatsDifference[] {
  const differences: StatsDifference[] = [];
  for (const table of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    const a = left[table] ?? null;
    const b = right[table] ?? null;
    if (a === null || b === null) {
      if ((a ?? b)!.count > 0) differences.push({ table, left: a, right: b });
      continue;
    }
    if (a.number !== b.number || a.count !== b.count || a.sha256 !== b.sha256) {
      differences.push({ table, left: a, right: b });
    }
  }
  return differences;
}
