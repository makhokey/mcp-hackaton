import express from 'express';
import cors from 'cors';
import llmRouter from './llm/index';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const app = express();
const port = process.env.BACKEND_PORT || 3010;

app.use(cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));

// Add middleware to parse JSON request bodies
app.use(express.json());

// Add a health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend server is running' });
});

app.use('/llm', llmRouter);

app.listen(port, () => {
    console.log(`Backend API server listening on http://localhost:${port}`);
    console.log(`Health check endpoint: http://localhost:${port}/health`);
});



