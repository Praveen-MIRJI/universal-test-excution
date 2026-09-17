import { pathToFileURL } from 'node:url';
import { AgentOrchestrator } from './agent/agent-orchestrator.js';
import { createStdioAgentMcpClient } from './agent/mcp-client.js';
import { OpenAICompatibleProvider } from './agent/openai-compatible-provider.js';

export async function runAgentRequest(userRequest: string): Promise<unknown> {
	const endpoint = process.env.LLM_API_URL;
	const model = process.env.LLM_MODEL;
	if (!endpoint || !model) {
		throw new Error('LLM_API_URL and LLM_MODEL must be configured for agent execution.');
	}

	const client = await createStdioAgentMcpClient();
	try {
		const agent = new AgentOrchestrator(
			client,
			new OpenAICompatibleProvider({
				endpoint,
				model,
				...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
			}),
		);
		return agent.run({ userRequest });
	} finally {
		await client.close();
	}
}

async function readUserRequest(): Promise<string> {
	const argument = process.argv.slice(2).join(' ').trim();
	if (argument) return argument;
	if (process.stdin.isTTY) {
		throw new Error('Provide a natural-language request as an argument or through stdin.');
	}
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const request = Buffer.concat(chunks).toString('utf8').trim();
	if (!request) throw new Error('The natural-language request cannot be empty.');
	return request;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	readUserRequest()
		.then(runAgentRequest)
		.then((response) => process.stdout.write(`${JSON.stringify(response, null, 2)}\n`))
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : 'Agent execution failed.';
			console.error(`Agent execution failed: ${message}`);
			process.exitCode = 1;
		});
}
