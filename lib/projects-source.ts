import { BIN } from "@/lib/config";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
interface GitHubRepo {
    name: string;
    description: string | null;
    html_url: string;
    updated_at: string;
    language: string | null;
    private: boolean;
}
interface PRItem {
    number: number;
    title: string;
    state: string;
    url: string;
}
interface RunItem {
    status: string;
    conclusion: string | null;
    name: string;
    url: string;
}
export interface OpenPR {
    number: number;
    title: string;
    url: string;
}
export interface LatestRun {
    status: string;
    conclusion: string | null;
    name: string;
    url: string;
}
export interface Repo {
    name: string;
    description: string | null;
    url: string;
    updatedAt: string;
    primaryLanguage: {
        name: string;
    } | null;
    isPrivate: boolean;
    openPRs: OpenPR[];
    latestRun: LatestRun | null;
}
const PINNED_PROJECTS: Record<string, string> = {
    shipyard: "API marketplace for autonomous AI agents",
    "mission-control": "Personal AI command center",
    "superteam-miami": "Solana community hub for Miami",
    arken: "Real-time financial news terminal + prediction markets",
};
async function fetchPRs(repoName: string): Promise<OpenPR[]> {
    try {
        const { stdout } = await execFileAsync(BIN.gh, ["pr", "list", "--repo", `BiscayneDev/${repoName}`, "--json", "number,title,state,url", "--limit", "3"], { timeout: 8000 });
        const items: PRItem[] = JSON.parse(stdout || "[]");
        return items
            .filter((p) => p.state === "OPEN")
            .map((p) => ({ number: p.number, title: p.title, url: p.url }));
    }
    catch {
        return [];
    }
}
async function fetchLatestRun(repoName: string): Promise<LatestRun | null> {
    try {
        const { stdout } = await execFileAsync(BIN.gh, ["run", "list", "--repo", `BiscayneDev/${repoName}`, "--limit", "1", "--json", "status,conclusion,name,url"], { timeout: 8000 });
        const items: RunItem[] = JSON.parse(stdout || "[]");
        if (items.length === 0)
            return null;
        const r = items[0];
        return { status: r.status, conclusion: r.conclusion ?? null, name: r.name, url: r.url };
    }
    catch {
        return null;
    }
}
export async function fetchProjects(): Promise<Repo[]> {
    try {
        const headers: Record<string, string> = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };
        if (process.env.GITHUB_TOKEN) {
            headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        const endpoint = process.env.GITHUB_TOKEN
            ? "https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner"
            : "https://api.github.com/users/BiscayneDev/repos?sort=updated&per_page=30";
        const res = await fetch(endpoint, { headers, next: { revalidate: 300 } });
        if (!res.ok)
            throw new Error(`GitHub API ${res.status}`);
        const data: GitHubRepo[] = await res.json();
        const pinnedNames = Object.keys(PINNED_PROJECTS);
        const pinnedInData = data.filter((r) => pinnedNames.includes(r.name));
        const prCiResults = await Promise.all(pinnedInData.map(async (r) => {
            const [prs, run] = await Promise.all([fetchPRs(r.name), fetchLatestRun(r.name)]);
            return { name: r.name, prs, run };
        }));
        const prCiMap = new Map(prCiResults.map((x) => [x.name, x]));
        const mapRepo = (r: GitHubRepo): Repo => {
            const extra = prCiMap.get(r.name);
            return {
                name: r.name,
                description: r.description || PINNED_PROJECTS[r.name] || null,
                url: r.html_url,
                updatedAt: r.updated_at,
                primaryLanguage: r.language ? { name: r.language } : null,
                isPrivate: r.private,
                openPRs: extra?.prs ?? [],
                latestRun: extra?.run ?? null,
            };
        };
        const pinned = pinnedNames
            .map((name) => data.find((r) => r.name === name))
            .filter((r): r is GitHubRepo => r !== undefined)
            .map(mapRepo);
        const rest = data
            .filter((r) => !pinnedNames.includes(r.name))
            .map(mapRepo);
        return [...pinned, ...rest];
    }
    catch {
        return [];
    }
}
