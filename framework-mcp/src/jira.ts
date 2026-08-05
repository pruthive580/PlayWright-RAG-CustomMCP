/**
 * Driver-agnostic Jira fetch. Any MCP client (Claude Code, VS Code + local 8B, any frontier
 * model) calls this — it talks to Jira over REST with the user's own token, nothing cloud-LLM
 * specific. Cloud (API v3, ADF description) by default; Server/DC via JIRA_API_VERSION=2.
 */
const BASE = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL || "";
const TOKEN = process.env.JIRA_API_TOKEN || "";
const API = process.env.JIRA_API_VERSION || "3";

/** Flatten Atlassian Document Format (Jira Cloud description) to plain text. */
export function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  const kids = Array.isArray(node.content) ? node.content.map(adfToText).join("") : "";
  switch (node.type) {
    case "paragraph":
    case "heading":
      return kids + "\n";
    case "listItem":
      return "- " + kids;
    case "bulletList":
    case "orderedList":
      return kids;
    case "hardBreak":
      return "\n";
    default:
      return kids;
  }
}

export interface JiraIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  description: string;
  labels: string[];
  components: string[];
  url: string;
}

export async function getJira(id: string): Promise<JiraIssue | { error: string }> {
  if (!BASE || !EMAIL || !TOKEN) {
    return { error: "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN (a Jira API token) in the MCP server env." };
  }
  const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
  const url = `${BASE}/rest/api/${API}/issue/${encodeURIComponent(id)}?fields=summary,description,labels,components,status,issuetype`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
  } catch (e) {
    return { error: `Could not reach Jira at ${BASE}: ${(e as Error).message}` };
  }
  if (!res.ok) {
    return { error: `Jira ${id}: HTTP ${res.status} ${res.statusText}${res.status === 401 ? " (check email/token)" : res.status === 404 ? " (issue not found)" : ""}` };
  }
  const j: any = await res.json();
  const f = j.fields || {};
  const description = typeof f.description === "string" ? f.description : adfToText(f.description).trim();
  return {
    key: j.key,
    summary: f.summary || "",
    type: f.issuetype?.name || "",
    status: f.status?.name || "",
    description,
    labels: f.labels || [],
    components: (f.components || []).map((c: any) => c.name),
    url: `${BASE}/browse/${j.key}`,
  };
}
