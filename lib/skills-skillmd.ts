// SKILL.md loader: naive YAML frontmatter parsing + keyword scoring.
// Pure logic, no imports (tests load this file directly).

export interface ParsedSkill {
  name: string;
  description: string;
  tags: string[];
  body: string;
  sourcePath: string;
}

export function parseSkillMd(text: string, sourcePath: string): ParsedSkill {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${sourcePath}: missing frontmatter (must start with ---)`);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error(`${sourcePath}: unterminated frontmatter (no closing ---)`);
  }
  const front = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n');

  let name: string | undefined;
  let description: string | undefined;
  const tags: string[] = [];
  let inTagList = false;

  for (const line of front) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = line.match(/^(\s*)([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (m) {
      const [, indent, key, value] = m;
      inTagList = key === 'tags' && value.trim() === '';
      if (key === 'tags') {
        if (!inTagList) {
          tags.push(...splitTags(value));
        }
        continue;
      }
      inTagList = false;
      if (key === 'name' && name === undefined) name = value.trim();
      if (key === 'description' && description === undefined) description = value.trim();
      continue;
    }
    const listM = line.match(/^\s*-\s+(.+)$/);
    if (listM && inTagList) {
      tags.push(listM[1].trim());
    }
  }

  if (!name) throw new Error(`${sourcePath}: frontmatter missing required "name" field`);
  if (!description) {
    throw new Error(`${sourcePath}: frontmatter missing required "description" field`);
  }

  return { name, description, tags, body, sourcePath };
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export function matchesQuery(skill: ParsedSkill, query: string): number {
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0) return 0;
  const fields: Array<{ text: string; weight: number }> = [
    { text: skill.name, weight: 3 },
    { text: skill.description, weight: 2 },
    { text: skill.tags.join(' '), weight: 1 },
  ];
  let score = 0;
  for (const term of qTerms) {
    for (const f of fields) {
      const fTerms = tokenize(f.text);
      if (fTerms.includes(term)) score += f.weight;
    }
  }
  const max = qTerms.length * (3 + 2 + 1);
  return max > 0 ? Math.min(1, score / max) : 0;
}

// Given directory entry names, return candidate SKILL.md paths relative to the
// directory: "SKILL.md" itself if present, plus "<entry>/SKILL.md" for each entry.
export function findSkillMdPaths(entries: string[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry === 'SKILL.md') paths.push(entry);
  }
  for (const entry of entries) {
    if (entry === 'SKILL.md' || entry.startsWith('.')) continue;
    paths.push(`${entry}/SKILL.md`);
  }
  return paths;
}

export function topSkills(skills: ParsedSkill[], query: string, n: number): ParsedSkill[] {
  return [...skills]
    .map((skill) => ({ skill, score: matchesQuery(skill, query) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.skill.name.localeCompare(b.skill.name)))
    .slice(0, Math.max(0, n))
    .map((e) => e.skill);
}
