import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { validateCodetourTour } from "../../src/codetour-schema";
import { git } from "../../src/git";

export { git };

export const CLI_PATH = path.join(__dirname, "..", "..", "src", "cli.js");

export interface ToolResponse {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

export async function startServer(
  workspaceRoot: string,
  envOverrides: Record<string, string> = {}
): Promise<Client> {
  const client = new Client(
    { name: "codetour-mcp-test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, "--workspace-root", workspaceRoot],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      ),
      ...envOverrides,
    },
  });
  await client.connect(transport);
  return client;
}

export async function withServer<T>(
  root: string,
  run: (client: Client) => Promise<T>,
  envOverrides: Record<string, string> = {}
): Promise<T> {
  const client = await startServer(root, envOverrides);
  try {
    return await run(client);
  } finally {
    await stopServer(client);
  }
}

export async function callTool(
  client: Client,
  name: string,
  args: unknown
): Promise<ToolResponse> {
  const result = (await client.callTool({
    name,
    arguments: args as Record<string, unknown>,
  })) as unknown as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  const text = (result.content ?? [])
    .filter((item) => item.type === "text" && item.text !== undefined)
    .map((item) => item.text as string)
    .join("\n");
  return {
    isError: result.isError ?? false,
    text,
    structured: result.structuredContent ?? {},
  };
}

export async function stopServer(client: Client): Promise<void> {
  await client.close();
}

export function tempDir(prefix = "codetour-mcp-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(workspaceRoot: string, relativePath: string, content: string): void {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export async function initGitRepo(dir: string, branch = "main"): Promise<void> {
  await git(["init", "-b", branch], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test User"], dir);
  await git(["config", "commit.gpgsign", "false"], dir);
  await git(["config", "tag.gpgsign", "false"], dir);
}

export async function commitFile(
  dir: string,
  relativePath: string,
  content: string,
  message: string
): Promise<void> {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  await git(["add", "-A"], dir);
  await git(["commit", "-m", message], dir);
}

export async function headSha(dir: string): Promise<string> {
  const result = await git(["rev-parse", "HEAD"], dir);
  return result.stdout.trim();
}

export function readTourFile(
  workspaceRoot: string,
  relativePath: string
): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8")
  );
}

export function tourFileValidAgainstSchema(
  workspaceRoot: string,
  relativePath: string
): boolean {
  const content = readTourFile(workspaceRoot, relativePath);
  return validateCodetourTour(content) as boolean;
}

export function structuredCode(response: ToolResponse): string {
  return (response.structured.code ?? "") as string;
}

export function structuredIssues(response: ToolResponse): Array<{ path: string; message: string }> {
  return (response.structured.issues ?? []) as Array<{ path: string; message: string }>;
}

export function structuredWarnings(response: ToolResponse): Array<{ code: string; message: string }> {
  return (response.structured.warnings ?? []) as Array<{ code: string; message: string }>;
}

export function warningCodes(response: ToolResponse): string[] {
  return structuredWarnings(response).map((warning) => warning.code);
}

export function issuePaths(response: ToolResponse): string[] {
  return structuredIssues(response).map((issue) => issue.path);
}
