import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState = "idle" | "checking" | "downloading" | "ready" | "none" | "error";

/** Ask GitHub for a newer release, install it, and start again. */
export async function runUpdate(
  onState: (state: UpdateState, version?: string) => void = () => undefined,
) {
  onState("checking");
  try {
    const update = await check();
    if (!update) {
      onState("none");
      return false;
    }
    onState("downloading", update.version);
    await update.downloadAndInstall();
    onState("ready", update.version);
    await relaunch();
    return true;
  } catch (error) {
    console.error("update check failed", error);
    onState("error");
    return false;
  }
}
