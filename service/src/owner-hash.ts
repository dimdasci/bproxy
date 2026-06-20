import { createHash } from "node:crypto";

export function computeOwnerHash(salt: Uint8Array, nick: string): string {
	return createHash("sha256").update(salt).update(nick).digest("hex").slice(0, 8);
}
