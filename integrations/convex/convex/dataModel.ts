import type {
  DocumentByName,
  TableNamesInDataModel,
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import schema from "./schema.js";

export type ParlorDataModel = DataModelFromSchemaDefinition<typeof schema>;
export type ParlorDoc<TableName extends TableNamesInDataModel<ParlorDataModel>> = DocumentByName<
  ParlorDataModel,
  TableName
>;

// Select database operations, not whole database interfaces, so applications can
// extend the schema without making game-owned tables part of Parlor's contract.
export type ParlorQueryCtx = {
  readonly auth: GenericQueryCtx<ParlorDataModel>["auth"];
  readonly db: Pick<GenericQueryCtx<ParlorDataModel>["db"], "get" | "query">;
};
export type ParlorMutationCtx = {
  readonly auth: GenericMutationCtx<ParlorDataModel>["auth"];
  readonly db: Pick<
    GenericMutationCtx<ParlorDataModel>["db"],
    "get" | "query" | "insert" | "patch" | "replace" | "delete"
  >;
};
export type ParlorCtx = ParlorQueryCtx | ParlorMutationCtx;
