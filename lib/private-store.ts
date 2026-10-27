import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, unlink, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

// Local credentials must never be written below the source/deployment tree.
// This is permission-protected local storage, not encryption or a host sandbox.
export async function privateStorePath(cwd = process.cwd(), home = homedir()): Promise<string> {
  const root = await realpath(cwd)
  const dir = path.resolve(home, ".config", "dock", "private")
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const resolved = await realpath(dir)
  const relative = path.relative(root, resolved)
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Dock private storage must be outside the application tree")
  }
  const directory = await lstat(dir)
  if (directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid())) throw new Error("Unsafe Dock private storage directory")
  await chmod(dir, 0o700)
  return path.join(resolved, "paybox.json")
}

export async function readPrivateStore(file: string): Promise<unknown | null> {
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe Dock private store")
    await handle.chmod(0o600)
    return JSON.parse(await handle.readFile("utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  } finally { await handle?.close() }
}

export async function writePrivateStore(file: string, value: unknown): Promise<void> {
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe Dock private store")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const temp = `${file}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(JSON.stringify(value), "utf8")
    await handle.sync()
    await handle.close(); handle = undefined
    await rename(temp, file)
  } finally {
    await handle?.close()
    await unlink(temp).catch(() => {})
  }
}
