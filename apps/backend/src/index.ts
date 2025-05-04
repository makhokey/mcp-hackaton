import * as express from "express";
const app = express.default();

app.listen(3010, () => {
    console.log("Server is running on port 3010");
});