import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ChatOpenAI } from "@langchain/openai";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Tool } from "@langchain/core/tools";
import { prompt } from "./prompt";

// Initialize the model
const model = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0, apiKey: process.env.OPENAI_API_KEY });

// Define server configurations
const serverConfigs = {
    rs: {
        url: "http://localhost:8083/sse",
        name: "mcp-rs-client",
        version: "1.0.0",
        required: true // Maps server is required
    }
};

export const initializeAndRunAgent = async () => {
    try {
        // Create transports and clients for each server
        const clients = new Map<string, { transport: SSEClientTransport, client: any }>();

        // Initialize each client
        for (const [service, config] of Object.entries(serverConfigs)) {
            try {
                const transport = new SSEClientTransport(new URL(config.url));
                const client = new Client({
                    name: config.name,
                    version: config.version,
                });

                // Connect to the transport with timeout
                const connectPromise = client.connect(transport);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Connection timeout for ${service} server`)), 5000);
                });

                await Promise.race([connectPromise, timeoutPromise]);
                clients.set(service, { transport, client });
                console.log(`Successfully connected to ${service} server`);
            } catch (error) {
                console.error(`Failed to connect to ${service} server:`, error);
                if (config.required) {
                    throw new Error(`Failed to connect to required ${service} server`);
                }
            }
        }

        // Load tools from each server
        const allTools: Tool[] = [];

        const rsClient = clients.get("rs")?.client;
        if (rsClient) {
            try {
                const rsTools = await loadMcpTools("rs", rsClient, {
                    throwOnLoadError: true,
                    prefixToolNameWithServerName: true,
                    additionalToolNamePrefix: "rs_",
                });
                allTools.push(...(rsTools as Tool[]));
                console.log('Successfully loaded RS tools');
            } catch (error) {
                console.error('Failed to load RS tools:', error);
            }
        }

        if (allTools.length === 0) {
            throw new Error('No tools were loaded successfully');
        }

        // Create the agent with combined tools
        const agent = createReactAgent({ llm: model, tools: allTools, prompt: prompt });
        console.log(`Agent created successfully with ${allTools.length} tools`);

        return agent;

    } catch (e) {
        console.error('LLM Agent initialization error:', e);
        throw new Error('Failed to initialize LLM agent');
    }
}
