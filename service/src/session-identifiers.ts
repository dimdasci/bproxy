export const SESSION_ID_PATTERN = /^[a-z2-7]{6}$/;
export const TAB_HANDLE_PATTERN = /^t[1-9]\d*$/;

const SESSION_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function randomSessionId(random: () => number): string {
	let id = "";
	for (let index = 0; index < 6; index += 1) {
		const offset = Math.floor(random() * SESSION_ID_ALPHABET.length);
		id += SESSION_ID_ALPHABET[offset] ?? SESSION_ID_ALPHABET[0];
	}
	return id;
}
