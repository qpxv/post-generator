import { spawn } from 'node:child_process';

// Same signature as complete() in claude.ts so a caller can swap between the
// local CLI (dev tooling, billed to the subscription) and the API (CI) freely.
// The CLI is a full agent, so it runs with no tools and no permission prompts:
// it can only return text and never touches the repo. --strict-mcp-config with
// no --mcp-config loads zero MCP servers, otherwise the model sees the user's
// connectors and comments on them in the output. Not --bare: that forces
// ANTHROPIC_API_KEY auth and would bill the API instead of the subscription.
export async function completeViaCli(systemPrompt: string, userPrompt: string): Promise<string> {
  const args = [
    '-p', '--tools', '', '--permission-prompts', 'none', '--strict-mcp-config',
    '--no-session-persistence', '--system-prompt', systemPrompt,
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`claude cli exited with code ${code}: ${err.trim() || out.trim()}`));
    });
    // Prompt goes through stdin: it is far too large for a single argv entry
    child.stdin.end(userPrompt);
  });

  return stripCodeFence(stdout.trim());
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : text;
}
