import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Loads a public Schedule of Classes response: hands over the cached copy right away if there
 * is one, then the fresh one.
 */
export async function socLoad(key: string, path: string, apply: (body: string) => void): Promise<void> {
  const hit = await invoke<string | null>("cache_get", { key });
  if (hit !== null) apply(hit);
  apply(await invoke<string>("soc_get", { key, path }));
}

/** Like socLoad, for many paths at once. The body is a JSON object of name → response body. */
export async function socLoadMany(
  key: string,
  paths: Record<string, string>,
  apply: (bodies: Record<string, string>) => void,
): Promise<void> {
  const hit = await invoke<string | null>("cache_get", { key });
  if (hit !== null) apply(JSON.parse(hit));
  apply(JSON.parse(await invoke<string>("soc_get_many", { key, paths })));
}

/** A MyUCLA page as HTML. Throws "unauthorized" when signed out. */
export function myuclaGet(path: string): Promise<string> {
  return invoke<string>("myucla_get", { path });
}

export function myuclaPost(path: string, body: string, contentType: string): Promise<string> {
  return invoke<string>("myucla_post", { path, body, contentType });
}

/** Takes over Firefox's MyUCLA session. Throws "unauthorized" if Firefox has none. */
export function firefoxSession(): Promise<void> {
  return invoke("firefox_session");
}

/** Opens the SSO window and resolves once the user is signed in. */
export async function login(): Promise<void> {
  let done!: () => void;
  const loggedIn = new Promise<void>((r) => (done = r));
  const unlisten = await listen("logged-in", () => done());
  await invoke("login");
  await loggedIn;
  unlisten();
}
