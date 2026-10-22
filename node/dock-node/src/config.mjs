import { homedir } from "node:os"
import { join } from "node:path"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"

// Config lives in ~/.dock-node/config.json (mode 600). DOCK_NODE_HOME overrides the directory (tests, multiple installs).

export function configDir(env = process.env) {
  return env.DOCK_NODE_HOME || join(homedir(), ".dock-node")
}

export function configPath(env = process.env) {
  return join(configDir(env), "config.json")
}

export async function loadConfig(env = process.env) {
  try {
    const raw = await readFile(configPath(env), "utf8")
    const cfg = JSON.parse(raw)
    if (!cfg || typeof cfg.deviceToken !== "string" || typeof cfg.server !== "string") return null
    return cfg
  } catch (err) {
    if (err && err.code === "ENOENT") return null
    throw err
  }
}

export async function saveConfig(cfg, env = process.env) {
  const dir = configDir(env)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = configPath(env)
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  await chmod(file, 0o600)
  return file
}
