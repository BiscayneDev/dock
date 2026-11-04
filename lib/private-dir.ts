/** Shared permission-protected private directory (~/.config/dock/private). */
import { homedir } from "node:os"
import path from "node:path"
import { chmod, lstat, mkdir, realpath } from "node:fs/promises"

export async function dockPrivateDir(home: string = homedir()): Promise<string> {
  const dir = path.resolve(home, ".config", "dock", "private")
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const resolved = await realpath(dir)
  const stat = await lstat(dir)
  if (stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error("Unsafe Dock private storage directory")
  }
  await chmod(dir, 0o700)
  return resolved
}
