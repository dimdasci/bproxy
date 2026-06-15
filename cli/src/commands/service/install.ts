import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { executeExitPlan, exitSuccess, exitUsageError } from "../../exit.js";
import { globalArgs } from "../../globals.js";
import { resolveStateDir } from "../../paths.js";
import { resolveServiceBinary } from "../../service-binary.js";

// ─── Platform service generation ───────────────────────────────────────

function xmlEscape(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function systemdEscape(value: string): string {
	return value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function systemdQuote(value: string): string {
	return `"${systemdEscape(value)}"`;
}

function generateLaunchdPlist(serviceBin: string, stateDir: string, logsDir: string): string {
	const nodePath = xmlEscape(process.execPath);
	const servicePath = xmlEscape(serviceBin);
	const homePath = xmlEscape(stateDir);
	const outLog = xmlEscape(`${logsDir}/launchd-out.log`);
	const errLog = xmlEscape(`${logsDir}/launchd-err.log`);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		"\t<key>Label</key>",
		"\t<string>com.bproxy.daemon</string>",
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		`\t\t<string>${nodePath}</string>`,
		`\t\t<string>${servicePath}</string>`,
		"\t\t<string>start</string>",
		"\t</array>",
		"\t<key>EnvironmentVariables</key>",
		"\t<dict>",
		"\t\t<key>BPROXY_HOME</key>",
		`\t\t<string>${homePath}</string>`,
		"\t</dict>",
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		"\t<key>KeepAlive</key>",
		"\t<false/>",
		"\t<key>StandardOutPath</key>",
		`\t<string>${outLog}</string>`,
		"\t<key>StandardErrorPath</key>",
		`\t<string>${errLog}</string>`,
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

function generateSystemdUnit(serviceBin: string, stateDir: string): string {
	const nodePath = systemdQuote(process.execPath);
	const servicePath = systemdQuote(serviceBin);
	const homeValue = systemdEscape(stateDir);
	return [
		"[Unit]",
		"Description=bproxy daemon",
		"After=network.target",
		"",
		"[Service]",
		"Type=simple",
		`ExecStart=${nodePath} ${servicePath} start`,
		`Environment="BPROXY_HOME=${homeValue}"`,
		"Restart=no",
		"",
		"[Install]",
		"WantedBy=default.target",
		"",
	].join("\n");
}

// ─── Launchd helpers ───────────────────────────────────────────────────

function launchdPlistPath(): string {
	return resolve(homedir(), "Library/LaunchAgents/com.bproxy.daemon.plist");
}

function launchdLoad(plistPath: string): string | null {
	try {
		execFileSync("launchctl", ["load", plistPath], { stdio: "pipe" });
		return null;
	} catch {
		try {
			const uid = process.getuid?.() ?? 501;
			execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { stdio: "pipe" });
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}
}

function launchdUnload(plistPath: string): void {
	try {
		execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
	} catch {
		try {
			const uid = process.getuid?.() ?? 501;
			execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "pipe" });
		} catch {
			// Already unloaded
		}
	}
}

// ─── Systemd helpers ───────────────────────────────────────────────────

function systemdUnitPath(): string {
	return resolve(homedir(), ".config/systemd/user/bproxy.service");
}

function systemdEnable(): string | null {
	try {
		execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
		execFileSync("systemctl", ["--user", "enable", "bproxy"], { stdio: "pipe" });
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

function systemdDisable(): void {
	try {
		execFileSync("systemctl", ["--user", "disable", "bproxy"], { stdio: "pipe" });
	} catch {
		// May already be disabled
	}
	try {
		execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
	} catch {
		// Best effort
	}
}

// ─── Install command ───────────────────────────────────────────────────

export const installCommand = defineCommand({
	meta: { description: "Register daemon as a login service (launchd/systemd)" },
	args: { ...globalArgs },
	async run({ args }) {
		const home = typeof args.home === "string" ? args.home : undefined;
		const stateDir = resolveStateDir(home, process.env);

		const serviceBin = resolveServiceBinary({ env: process.env });
		if (!serviceBin) {
			executeExitPlan(
				exitUsageError(
					"Cannot find service binary. Ensure bproxy is installed globally or set BPROXY_SERVICE_BIN.",
				),
			);
			return;
		}

		const logsDir = resolve(stateDir, "logs");
		mkdirSync(logsDir, { recursive: true, mode: 0o700 });

		const platform = process.platform;

		if (platform === "darwin") {
			installLaunchd(serviceBin, stateDir, logsDir);
		} else if (platform === "linux") {
			installSystemd(serviceBin, stateDir);
		} else {
			executeExitPlan(
				exitUsageError(`Platform '${platform}' is not supported. Use macOS or Linux.`),
			);
		}
	},
});

function installLaunchd(serviceBin: string, stateDir: string, logsDir: string): void {
	const plistPath = launchdPlistPath();
	mkdirSync(resolve(homedir(), "Library/LaunchAgents"), { recursive: true });

	if (existsSync(plistPath)) {
		executeExitPlan(
			exitUsageError(`Already installed at ${plistPath}. Run 'bproxy service uninstall' first.`),
		);
		return;
	}

	const plist = generateLaunchdPlist(serviceBin, stateDir, logsDir);
	writeFileSync(plistPath, plist, { mode: 0o644 });

	const loadError = launchdLoad(plistPath);
	if (loadError) {
		unlinkSync(plistPath);
		executeExitPlan(exitUsageError(`Failed to load launchd service: ${loadError}`));
		return;
	}

	executeExitPlan(exitSuccess({ installed: true, plist: plistPath, status: "loaded" }));
}

function installSystemd(serviceBin: string, stateDir: string): void {
	const unitPath = systemdUnitPath();
	mkdirSync(resolve(homedir(), ".config/systemd/user"), { recursive: true });

	if (existsSync(unitPath)) {
		executeExitPlan(
			exitUsageError(`Already installed at ${unitPath}. Run 'bproxy service uninstall' first.`),
		);
		return;
	}

	const unit = generateSystemdUnit(serviceBin, stateDir);
	writeFileSync(unitPath, unit, { mode: 0o644 });

	const enableError = systemdEnable();
	if (enableError) {
		unlinkSync(unitPath);
		executeExitPlan(exitUsageError(`Failed to enable systemd service: ${enableError}`));
		return;
	}

	executeExitPlan(exitSuccess({ installed: true, unit: unitPath, status: "enabled" }));
}

// ─── Uninstall command ─────────────────────────────────────────────────

export const uninstallCommand = defineCommand({
	meta: { description: "Remove daemon login service registration" },
	args: { ...globalArgs },
	async run({ args: _args }) {
		const platform = process.platform;

		if (platform === "darwin") {
			uninstallLaunchd();
		} else if (platform === "linux") {
			uninstallSystemd();
		} else {
			executeExitPlan(
				exitUsageError(`Platform '${platform}' is not supported. Use macOS or Linux.`),
			);
		}
	},
});

function uninstallLaunchd(): void {
	const plistPath = launchdPlistPath();
	if (!existsSync(plistPath)) {
		executeExitPlan(exitUsageError("Service is not installed (no plist found)."));
		return;
	}
	launchdUnload(plistPath);
	unlinkSync(plistPath);
	executeExitPlan(exitSuccess({ uninstalled: true }));
}

function uninstallSystemd(): void {
	const unitPath = systemdUnitPath();
	if (!existsSync(unitPath)) {
		executeExitPlan(exitUsageError("Service is not installed (no unit file found)."));
		return;
	}
	systemdDisable();
	unlinkSync(unitPath);
	executeExitPlan(exitSuccess({ uninstalled: true }));
}
