import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.BACKEND_PORT || 3010;

app.use(cors()); // Allow requests from other origins (like the MCP app)


app.listen(port, () => {
    console.log(`Backend API server listening on http://localhost:${port}`);
});



