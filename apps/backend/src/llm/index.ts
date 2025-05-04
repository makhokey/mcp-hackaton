import express, { Request, RequestHandler, Router } from 'express';
import { initializeAndRunAgent } from './mcp-client';

const router: Router = Router();

// Define message types for our storage
interface ChatMessage {
    role: 'user' | 'assistant' | string;
    content: string;
}

// Simple in-memory storage for conversations
const conversationHistory = new Map<string, ChatMessage[]>();

// Generate a default session ID if none provided
const getSessionId = (req: Request): string => {
    return req.body.sessionId || 'default-session';
};

const chatHandler: RequestHandler = async (req, res): Promise<void> => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            res.status(400).json({ error: 'Prompt is required' });
            return;
        }

        const sessionId = getSessionId(req);

        // Get or initialize conversation history
        if (!conversationHistory.has(sessionId)) {
            conversationHistory.set(sessionId, []);
        }
        const history = conversationHistory.get(sessionId)!;

        // Add user message to history
        const userMessage: ChatMessage = { role: 'user', content: prompt };
        history.push(userMessage);

        // Initialize agent
        const agent = await initializeAndRunAgent();

        // Convert our message format to what the agent expects
        // The agent.invoke method expects an array of { role, content } objects
        const response = await agent.invoke({
            messages: history.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        });

        // Extract the content from the last message
        const lastMessage = response.messages[response.messages.length - 1];
        if (!lastMessage) {
            res.status(500).json({ error: 'LLM agent did not return a message' });
            return;
        }

        const responseContent = typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Add assistant response to history
        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: responseContent
        };
        history.push(assistantMessage);

        // Limit history length to prevent memory issues (optional)
        if (history.length > 20) {
            // Keep last 20 messages
            conversationHistory.set(sessionId, history.slice(-20));
        }

        // Return response with session ID
        res.json({
            response: responseContent,
            sessionId
        });
        return;
    } catch (error) {
        console.error('LLM route error:', error);
        res.status(500).json({ error: 'Failed to process LLM request' });
        return;
    }
};

router.post('/chat', chatHandler);

export default router; 