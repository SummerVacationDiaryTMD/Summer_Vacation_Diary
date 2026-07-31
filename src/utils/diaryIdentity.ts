function fallbackHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Identifies the input revision that can spend a new AI inspection chance.
 * Date, title, weather and background are deliberately excluded because they
 * are not sent to the analysis or drawing providers.
 */
export async function createDiaryRevisionKey(
  photoDataUrl: string,
  content: string,
): Promise<string> {
  const signature = JSON.stringify([photoDataUrl, content]);

  if (typeof crypto !== "undefined" && crypto.subtle !== undefined) {
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(signature),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } catch {
      // Plain HTTP development can expose crypto without allowing digest().
    }
  }

  return [
    "fallback",
    fallbackHash(signature, 0x811c9dc5),
    fallbackHash(signature, 0x9e3779b9),
    fallbackHash(signature, 0x85ebca6b),
    fallbackHash(signature, 0xc2b2ae35),
  ].join("-");
}
