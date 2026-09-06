import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import schema from "./schema.js";

export type ParlorDataModel = DataModelFromSchemaDefinition<typeof schema>;
export type ParlorQueryCtx = GenericQueryCtx<ParlorDataModel>;
export type ParlorMutationCtx = GenericMutationCtx<ParlorDataModel>;
export type ParlorCtx = ParlorQueryCtx | ParlorMutationCtx;
