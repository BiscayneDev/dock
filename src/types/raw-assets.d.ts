// Raw string imports of Python assets (browser-use bootstrap). The ?raw
// suffix works natively in vitest/Vite; next.config.ts maps *.py?raw to
// webpack asset/source.
declare module '*.py?raw' {
  const content: string
  export default content
}
