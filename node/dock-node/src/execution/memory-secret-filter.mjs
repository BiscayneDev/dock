// Refuse credential-shaped content, never log it. This is defense in depth,
// not a guarantee that arbitrary private text can safely be made public.
export function memoryLooksSecret(text){return /(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,}|(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret)\s*[:=]\s*\S+)/i.test(text)}
