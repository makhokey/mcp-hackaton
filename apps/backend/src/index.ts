import express from "express";
import { Request, Response, Application } from "express";
import cors from "cors";
const app: Application = express();
import { getCompanyFullInfo, getCompanyENREGInfo } from "./rs-api";

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));

app.listen(3010, () => {
    console.log("Server is running on port 3010");
});

app.get("/rs/company-info", async (req: Request, res: Response): Promise<void> => {
    const companyInfo = await getCompanyFullInfo(req.query.companyID as string);
    res.json(companyInfo);
});

app.get("/company/full-details", async (req: Request, res: Response): Promise<void> => {
    let companyID: string | undefined = undefined;
    try {
        companyID = req.query.companyID as string;
        console.log(`[Endpoint] Received request for /company/full-details with Company ID: ${companyID}`);

        if (!companyID) {
            console.warn("[Endpoint] Company ID is missing.");
            res.status(400).json({ error: "Company ID is required" });
            return;
        }

        console.log(`[Endpoint] Fetching data from RS and ENREG for ${companyID}...`);
        // Get information from both systems in parallel
        const [rsInfo, enregInfo] = await Promise.all([
            getCompanyFullInfo(companyID),
            getCompanyENREGInfo(companyID)
        ]);

        console.log(`[Endpoint] RS Info received for ${companyID}:`, JSON.stringify(rsInfo, null, 2));
        console.log(`[Endpoint] ENREG Info received for ${companyID}:`, JSON.stringify(enregInfo, null, 2));

        if (!rsInfo && !enregInfo) {
            console.warn(`[Endpoint] No data returned from either RS or ENREG for ${companyID}.`);
            res.status(404).json({ message: "No information found for this company ID in any source." });
            return;
        }

        // Combine the information into a single response
        const combinedInfo = {
            company_id: companyID,
            revenue_service_info: rsInfo || null,
            entrepreneurial_registry_info: enregInfo || null,
            last_updated: new Date().toISOString()
        };

        console.log(`[Endpoint] Sending combined response for ${companyID}.`);
        res.json(combinedInfo);
    } catch (error) {
        console.error(`[Endpoint] Error in /company/full-details for Company ID '${companyID || 'unknown'}':`, error);
        res.status(500).json({
            error: "Failed to fetch company details",
            message: error instanceof Error ? error.message : "Unknown error"
        });
    }
});



