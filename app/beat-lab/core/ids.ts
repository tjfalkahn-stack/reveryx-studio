export function createId(prefix = "id"): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor((Date.now() + index * 997) % 256);
    }
  }
  return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function padId(bank: "A" | "B" | "C" | "D", index: number): string {
  return `${bank}-${String(index + 1).padStart(2, "0")}`;
}
