// Several people can reach one server as its owner, each from their own desktop. The name the person gives on
// this computer goes with every request, so bots know who wrote. It lives in this computer's browser storage,
// never on the server's shared profile.

export const PERSON_HEADER = "x-openmausbot-person";
const STORAGE_KEY = "omb.personName";
const MAX_LENGTH = 60;

export function devicePersonName(): string {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setDevicePersonName(name: string): void {
  const value = name.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  try {
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, value);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the bots fall back to the profile's name.
  }
}

/** Percent-encoded: an HTTP header cannot carry "João" as it is. */
export function personHeaderValue(): string | null {
  const name = devicePersonName();
  return name ? encodeURIComponent(name) : null;
}
