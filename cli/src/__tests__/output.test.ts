import { describe, expect, it } from "vitest";
import { type VerboseEntry, writeDiagnostic, writeJson, writeVerbose } from "../output.js";

/** Fake writable stream that captures written data. */
function fakeStream(): NodeJS.WritableStream & { data: string } {
	const stream = {
		data: "",
		write(chunk: string | Uint8Array): boolean {
			stream.data += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		},
		end() {
			return stream;
		},
	} as unknown as NodeJS.WritableStream & { data: string };
	return stream;
}

describe("writeJson", () => {
	it("writes a single-line JSON with trailing newline", () => {
		const out = fakeStream();
		writeJson({ ok: true, data: "hello" }, out);
		expect(out.data).toBe('{"ok":true,"data":"hello"}\n');
	});

	it("serializes arrays", () => {
		const out = fakeStream();
		writeJson([1, 2, 3], out);
		expect(out.data).toBe("[1,2,3]\n");
	});

	it("serializes strings", () => {
		const out = fakeStream();
		writeJson("test", out);
		expect(out.data).toBe('"test"\n');
	});

	it("serializes null", () => {
		const out = fakeStream();
		writeJson(null, out);
		expect(out.data).toBe("null\n");
	});

	it("does not include extra whitespace or indentation", () => {
		const out = fakeStream();
		writeJson({ nested: { deep: true } }, out);
		expect(out.data).not.toContain("  ");
		expect(out.data).not.toContain("\t");
		// Exactly one newline at the end
		expect(out.data.split("\n")).toHaveLength(2);
		expect(out.data.endsWith("\n")).toBe(true);
	});
});

describe("writeVerbose", () => {
	it("writes structured JSON to stderr", () => {
		const err = fakeStream();
		const entry: VerboseEntry = {
			requestId: "abc-123",
			action: "navigate",
			session: "default",
			elapsed: 42,
			httpStatus: 200,
		};
		writeVerbose(entry, err);
		const parsed = JSON.parse(err.data.trim());
		expect(parsed).toEqual(entry);
	});

	it("includes error code when present", () => {
		const err = fakeStream();
		writeVerbose({ requestId: "x", errorCode: "TIMEOUT" }, err);
		const parsed = JSON.parse(err.data.trim());
		expect(parsed.errorCode).toBe("TIMEOUT");
	});

	it("omits undefined fields", () => {
		const err = fakeStream();
		writeVerbose({ requestId: "x" }, err);
		const parsed = JSON.parse(err.data.trim());
		expect(Object.keys(parsed)).toEqual(["requestId"]);
	});

	it("appends trailing newline", () => {
		const err = fakeStream();
		writeVerbose({ action: "text" }, err);
		expect(err.data.endsWith("\n")).toBe(true);
	});
});

describe("writeDiagnostic", () => {
	it("writes plain text to stderr with trailing newline", () => {
		const err = fakeStream();
		writeDiagnostic("Something went wrong", err);
		expect(err.data).toBe("Something went wrong\n");
	});

	it("does not wrap in JSON", () => {
		const err = fakeStream();
		writeDiagnostic("error message", err);
		expect(err.data).not.toContain("{");
		expect(err.data).not.toContain("}");
	});
});
