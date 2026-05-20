import type { BproxyForwardedRequest } from "@bproxy/shared";

export interface ClientHandle {
	id: string;
	send: (cmd: BproxyForwardedRequest) => void;
}

export interface ClientsRegistry {
	add(client: ClientHandle): void;
	remove(id: string): void;
	any(): ClientHandle | undefined;
	all(): ClientHandle[];
	size(): number;
}

export function createClients(): ClientsRegistry {
	const clients = new Map<string, ClientHandle>();
	return {
		add(c) {
			clients.set(c.id, c);
		},
		remove(id) {
			clients.delete(id);
		},
		any() {
			const first = clients.values().next();
			return first.done ? undefined : first.value;
		},
		all() {
			return [...clients.values()];
		},
		size() {
			return clients.size;
		},
	};
}
