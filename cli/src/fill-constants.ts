import type { ExecutionWorld, FillMethod } from "./types.js";

export const VALID_METHODS: FillMethod[] = ["direct", "paste", "runtime-api"];
export const VALID_WORLDS: ExecutionWorld[] = ["isolated", "main"];
