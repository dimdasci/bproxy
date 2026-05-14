async function main(): Promise<void> {
	const cmd = process.argv[2] ?? "help";
	if (cmd !== "start" && cmd !== "stop" && cmd !== "status" && cmd !== "daemonize") {
		process.stdout.write("usage: bproxy-service <start|stop|status>\n");
		process.exit(cmd === "help" ? 0 : 2);
	}
	process.stdout.write(`bproxy-service ${cmd}: not yet implemented\n`);
	process.exit(0);
}

void main();
