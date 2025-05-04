import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolResult,
    TextContent,
    ListToolsRequestSchema,
    CallToolRequestSchema, // Import schema for call handler
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import axios from 'axios';
import { load } from 'cheerio';
import { URLSearchParams } from 'url';
import express, { Request, Response } from 'express'; // Ensure Request/Response types are imported
import cors from 'cors';
// http import is removed as app.listen is used directly

// --- Configuration ---
const MCP_PORT = process.env.MCP_PORT || 8083;

// --- Zod Schemas for Validation ---
const CompanyIdSchema = z.object({
    companyID: z.string().min(1).describe("The company ID (Tax ID / Identification Code)"),
});

// --- JSON Schema for MCP Tool Definition ---
const CompanyIdJsonSchema = {
    type: "object",
    properties: {
        companyID: { type: "string", description: "The company ID (Tax ID / Identification Code)" }
    },
    required: ["companyID"]
};

// Define Tool type (as it might not be exported)
interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

// --- Tool Definitions ---
const GET_COMPANY_FULL_INFO_TOOL: Tool = {
    name: "get_company_full_info",
    description: "Retrieves comprehensive company information (Tax and Public) directly from RS.ge.",
    inputSchema: CompanyIdJsonSchema,
};

const GET_COMPANY_ENREG_INFO_TOOL: Tool = {
    name: "get_company_enreg_info",
    description: "Retrieves company ENREG registration details directly from enreg.reestri.gov.ge.",
    inputSchema: CompanyIdJsonSchema,
};

const ALL_TOOLS = [
    GET_COMPANY_FULL_INFO_TOOL,
    GET_COMPANY_ENREG_INFO_TOOL,
] as const;

// --- Helper: fetchAndParseAppDetails --- (Keep the implementation as before)
const fetchAndParseAppDetails = async (appId: string, headers: any, ENREG_URL: string): Promise<any> => {
    console.error(`[MCP ENREG App] Fetching details for app_id ${appId}...`);
    try {
        const response = await axios.get(ENREG_URL, {
            params: { c: 'app', m: 'show_app', app_id: appId, parent: 'personPage', personID: '' },
            headers: {
                'User-Agent': headers['User-Agent'],
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': `${ENREG_URL}?c=app&m=show_legal_person`
            },
            timeout: 15000
        });
        if (response.status !== 200) {
            console.error(`[MCP ENREG App] Details request failed: ${response.status}`);
            return { error: `Failed to fetch details, status: ${response.status}` };
        }
        const $app = load(response.data);
        const appDetails: any = { prepared_documents: [], status_history: [], scanned_documents: [], payments: [], metadata: {} };
        // --- Parsing logic (Assume it's correct as copied before) ---
        $app('table.status_list:has(caption:contains("მომზადებული დოკუმენტები")) tbody tr').each((i, row) => {
            const columns = $app(row).find('td');
            if (columns.length >= 2) {
                const linkElement = $app(columns[0]).find('a');
                const docNameElement = $app(columns[1]).find('span.maintxt').first();
                const dateElement = $app(columns[1]).find('span.maintxt').last();
                appDetails.prepared_documents.push({
                    name: docNameElement.text().trim(),
                    date: dateElement.text().trim(),
                    link: linkElement.attr('href') || null,
                    type: linkElement.find('img').attr('alt') || null
                });
            }
        });
        $app('table.status_list:has(caption:contains("სტატუსი/გადაწყვეტილება")) tbody tr').each((i, row) => {
            const columns = $app(row).find('td');
            if (columns.length >= 3) {
                const linkElement = $app(columns[0]).find('a');
                const idElement = $app(columns[1]).find('span.maintxt').first();
                const dateElement = $app(columns[1]).find('span.smalltxt').first();
                const statusElement = $app(columns[2]).find('span').first();
                const decisionElement = $app(columns[2]).find('p');
                appDetails.status_history.push({
                    id: idElement.text().trim(),
                    date: dateElement.text().trim(),
                    status_text: statusElement.text().trim(),
                    decision: decisionElement.text().trim() || null,
                    link: linkElement.attr('href') || null,
                    type: linkElement.find('img').attr('alt') || null
                });
            }
        });
        $app('table.status_list:has(caption:contains("სკანირებული დოკუმენტები")) tbody tr').each((i, row) => {
            const columns = $app(row).find('td');
            if (columns.length >= 3) {
                const linkElement = $app(columns[0]).find('a');
                const dateElement = $app(columns[1]).find('span.maintxt').first();
                const nameLinkElement = $app(columns[2]).find('a');
                appDetails.scanned_documents.push({
                    name: nameLinkElement.text().trim(),
                    date: dateElement.text().trim(),
                    link: nameLinkElement.attr('href') || linkElement.attr('href') || null
                });
            }
        });
        const metadataTable = $app(`table.status_list:has(caption:contains("განცხადება # ${appId}"))`);
        appDetails.metadata.registration_number = metadataTable.find(`td:contains("რეგისტრაციის ნომერი")`).next('td').text().trim();
        appDetails.metadata.service_type = metadataTable.find(`td:contains("მომსახურების სახე")`).next('td').text().trim();
        appDetails.metadata.service_cost_description = metadataTable.find(`td:contains("მომსახურების ღირებულება")`).next('td').text().trim();
        appDetails.metadata.payable_amount_balance = metadataTable.find(`td:contains("გადასახდელი თანხა/ბალანსი")`).next('td').text().trim();
        metadataTable.find('table.pList tbody tr').each((i, row) => {
            const cols = $app(row).find('td');
            if (cols.length === 5 && !$app(row).find('th').length) {
                const paymentStatus = $app(cols[0]).text().trim();
                if (paymentStatus && !paymentStatus.includes('დავალიანება')) {
                    appDetails.payments.push({
                        status: paymentStatus,
                        amount: $app(cols[1]).text().trim(),
                        bank: $app(cols[2]).text().trim(),
                        receipt_number: $app(cols[3]).text().trim(),
                        date: $app(cols[4]).text().trim()
                    });
                }
            }
        });
        const applicantTable = $app('div#application_tab table').first();
        if (applicantTable.length) {
            appDetails.metadata.applicant_name_id = applicantTable.find(`td:contains("განმცხადებელი")`).next('td').contents().first().text().trim();
            appDetails.metadata.applicant_address = applicantTable.find(`td:contains("განმცხადებელი")`).next('td').find('span').text().trim();
            appDetails.metadata.representative_name_id = applicantTable.find(`td:contains("წარმომადგენელი")`).next('td').contents().first().text().trim();
            appDetails.metadata.representative_address = applicantTable.find(`td:contains("წარმომადგენელი")`).next('td').find('span').text().trim();
            appDetails.metadata.attached_documents = [];
            applicantTable.find('td:contains("თანდართული დოკუმენტაცია")').next('td').find('li').each((i, li) => {
                appDetails.metadata.attached_documents.push($app(li).text().trim());
            });
            applicantTable.find('td:contains("დამატებით წარმოდგენილი")').next('td').find('li').each((i, li) => {
                appDetails.metadata.attached_documents.push($app(li).text().trim() + " (Additionally Submitted)");
            });
            appDetails.metadata.note = applicantTable.find('td:contains("შენიშვნა")').next('td').text().trim();
        } else {
            console.warn(`[MCP ENREG App ${appId}] Could not find applicant details table.`);
        }
        console.error(`[MCP ENREG App] Successfully parsed details for app_id ${appId}`);
        return appDetails;
    } catch (error: any) {
        console.error(`[MCP ENREG App] Error processing app_id ${appId}:`, error.message);
        if (axios.isAxiosError(error)) {
            console.error(`[MCP ENREG App ${appId}] Axios error details: Status ${error.response?.status}`);
        }
        return { error: 'Failed to process application details' };
    }
};
// --- End Helper Function ---

// --- Tool Logic Handlers --- (Keep implementations as before)
async function handleGetCompanyFullInfo(args: unknown): Promise<CallToolResult> {
    const validationResult = CompanyIdSchema.safeParse(args);
    if (!validationResult.success) {
        return { isError: true, content: [{ type: "text", text: `Invalid input: ${validationResult.error.message}` } as TextContent] };
    }
    const { companyID } = validationResult.data;
    try {
        console.error(`[MCP RS] Fetching Tax/Public Info for ${companyID}...`);
        const taxInfoPromise = axios({ method: "post", url: "https://www.rs.ge/RsGe.Module/TaxpayersRegistry/GrdSearchTaxPayers", data: { tin: companyID }, timeout: 10000 });
        const publicInfoPromise = axios.get(`https://xdata.rs.ge/TaxPayer/PublicInfo`, { params: { IdentCode: companyID }, timeout: 10000 });
        const [taxInfoResult, publicInfoResult] = await Promise.allSettled([taxInfoPromise, publicInfoPromise]);
        let taxInfoData: any = null;
        if (taxInfoResult.status === 'fulfilled' && taxInfoResult.value.data?.Data?.Rows?.[0]) {
            taxInfoData = taxInfoResult.value.data.Data.Rows[0];
        } else if (taxInfoResult.status === 'rejected') {
            console.error(`[MCP RS] Tax Info request failed:`, taxInfoResult.reason);
        }
        let publicInfoData: any = null;
        if (publicInfoResult.status === 'fulfilled' && publicInfoResult.value.data && publicInfoResult.value.data.Status !== -100) {
            publicInfoData = publicInfoResult.value.data;
        } else if (publicInfoResult.status === 'rejected') {
            console.error(`[MCP RS] Public Info request failed:`, publicInfoResult.reason);
        }
        if (!taxInfoData && !publicInfoData) {
            return { isError: true, content: [{ type: "text", text: "No usable data found from RS sources." } as TextContent] };
        }
        const combinedResult = {
            id: publicInfoData?.id || taxInfoData?.[4] || "",
            name: taxInfoData?.[2] || publicInfoData?.name || "",
            entity_type: publicInfoData?.legal_form || taxInfoData?.[1] || "",
            status: taxInfoData?.[0] || publicInfoData?.status || "",
            create_date: publicInfoData?.id_date || "",
            registration_number: taxInfoData?.[5] || "",
            registration_date: taxInfoData?.[7] || "",
            address: publicInfoData?.address || "",
            directors: publicInfoData?.Directors?.map((d: any) => ({ full_name: d?.name || "", personal_id: d?.id || "", role: d?.type || "" })) || [],
            founders: publicInfoData?.Founders?.map((f: any) => ({ full_name: f?.name || "", personal_id: f?.id || "", ownership_percentage: f?.percent === undefined || f?.percent === null ? null : f.percent })) || []
        };
        return { content: [{ type: "text", text: JSON.stringify(combinedResult, null, 2) } as TextContent] };
    } catch (error: any) {
        console.error(`[MCP Tool Error - get_company_full_info for ${companyID}]:`, error);
        return { isError: true, content: [{ type: "text", text: `Error fetching full info: ${error.message || 'Unknown error'}` } as TextContent] };
    }
}

async function handleGetCompanyEnregInfo(args: unknown): Promise<CallToolResult> {
    const validationResult = CompanyIdSchema.safeParse(args);
    if (!validationResult.success) {
        return { isError: true, content: [{ type: "text", text: `Invalid input: ${validationResult.error.message}` } as TextContent] };
    }
    const { companyID } = validationResult.data;
    try {
        console.error(`[MCP ENREG] Processing ENREG for ${companyID}...`);
        const ENREG_URL = 'https://enreg.reestri.gov.ge/_dea/main.php';
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (compatible; MCPCompanyInfoFetcher/1.0)',
            'Accept': '*/*',
            'Origin': 'https://enreg.reestri.gov.ge',
            'Referer': 'https://enreg.reestri.gov.ge/_dea/main.php?m=new_index'
        };
        const searchParams = new URLSearchParams();
        searchParams.append('c', 'search');
        searchParams.append('m', 'find_legal_persons');
        searchParams.append('s_legal_person_idnumber', companyID);
        searchParams.append('s_legal_person_name', '');
        searchParams.append('s_legal_person_form', '0');
        searchParams.append('s_legal_person_email', '');

        const searchResponse = await axios.post(ENREG_URL, searchParams.toString(), { headers: headers, timeout: 15000 });
        if (searchResponse.status !== 200) throw new Error(`ENREG search failed: ${searchResponse.status}`);

        const $search = load(searchResponse.data);
        let legalCodeId: string | null = null;
        const onclickAttr = $search(`td:contains("${companyID}")`).closest('tr').find('a[onclick^="show_legal_person"]').attr('onclick');
        if (onclickAttr) {
            const match = onclickAttr.match(/show_legal_person\((\d+)\)/);
            if (match && match[1]) legalCodeId = match[1];
        }
        if (!legalCodeId) return { isError: false, content: [{ type: "text", text: JSON.stringify({ status: 'Not Found in ENREG' }, null, 2) } as TextContent] };

        const detailsResponse = await axios.get(ENREG_URL, {
            params: { c: 'app', m: 'show_legal_person', legal_code_id: legalCodeId, enteredCaptcha: '1' },
            headers: { 'User-Agent': headers['User-Agent'], 'Referer': `${ENREG_URL}?c=search&m=find_legal_persons` },
            timeout: 15000
        });
        if (detailsResponse.status !== 200) throw new Error(`ENREG details fetch failed: ${detailsResponse.status}`);

        const $details = load(detailsResponse.data);
        const companyDetails: any = {};
        const applicationsBaseInfo: any[] = [];
        const getDetailValue = (headerText: string): string => $details(`td:contains("${headerText}")`).next('td').text().trim() || "";
        companyDetails.identification_code = getDetailValue('საიდენტიფიკაციო კოდი');
        companyDetails.name = getDetailValue('დასახელება');
        companyDetails.legal_form = getDetailValue('სამართლებრივი ფორმა');
        companyDetails.registration_date = getDetailValue('რეგისტრაციის თარიღი');
        companyDetails.status_text = $details(`td:contains("სტატუსი")`).next('td').find('div').text().trim() || "";
        companyDetails.documents = {};
        $details('td:contains("კონსოლიდირებული სადამფუძნებლო შეთანხმება / წესდება")').next('td').find('a').each((i: number, el: any) => {
            const linkText = $details(el).text().trim();
            const linkHref = $details(el).attr('href');
            if (linkText && linkHref) {
                if (linkText.includes('სადამფუძნებლო შეთანხმება')) companyDetails.documents.founding_agreement_link = linkHref;
                if (linkText.includes('კონსოლიდირებული წესდება')) companyDetails.documents.consolidated_charter_link = linkHref;
            }
        });
        companyDetails.reporting_link = $details('a[href*="reportal.ge/Forms.aspx"]').attr('href') || "";

        $details('#tabs-1 table tbody tr').each((i: number, row: any) => {
            const columns = $details(row).find('td');
            if (columns.length === 5) {
                const onclickAttrApp = $details(columns[0]).find('a').attr('onclick');
                let appId: string | null = null;
                if (onclickAttrApp) {
                    const match = onclickAttrApp.match(/show_app\((\d+)/);
                    if (match && match[1]) appId = match[1];
                }
                if (appId) {
                    applicationsBaseInfo.push({
                        app_id: appId,
                        registration_number: $details(columns[1]).text().trim(),
                        service_type: $details(columns[2]).text().trim(),
                        status: $details(columns[3]).text().trim(),
                        date: $details(columns[4]).text().trim(),
                    });
                }
            }
        });

        const applicationDetailPromises = applicationsBaseInfo.map(appInfo =>
            fetchAndParseAppDetails(appInfo.app_id, headers, ENREG_URL)
        );
        const applicationDetailResults = await Promise.allSettled(applicationDetailPromises);

        const detailedApplications = applicationDetailResults.map((detailResult, index) => {
            const baseInfo = applicationsBaseInfo[index];
            if (detailResult.status === 'fulfilled') {
                return { ...baseInfo, details: detailResult.value };
            }
            console.error(`[MCP ENREG] Failed to fetch/parse details for app_id ${baseInfo.app_id}:`, detailResult.reason);
            return { ...baseInfo, details: { error: 'Failed to fetch/parse details', reason: detailResult.reason } };
        });

        const finalResult = {
            company_id: companyID,
            status: 'Found',
            enreg_internal_id: legalCodeId,
            details: companyDetails,
            applications: detailedApplications
        };
        return { content: [{ type: "text", text: JSON.stringify(finalResult, null, 2) } as TextContent] };
    } catch (error: any) {
        console.error(`[MCP Tool Error - get_company_enreg_info for ${companyID}]:`, error);
        let errorMessage = `Error fetching ENREG info: ${error.message || 'Unknown error'}`;
        if (axios.isAxiosError(error)) errorMessage += ` (Axios Error: Status ${error.response?.status})`;
        return { isError: true, content: [{ type: "text", text: errorMessage } as TextContent] };
    }
}

// --- MCP Server Setup ---

const server = new Server(
    {
        name: "rs-api-direct-mcp-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: { listChanged: false }, // Explicitly empty tools capability object
        },
    },
);

// Register request handlers using the example pattern
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments;

    console.error(`[MCP Server] Received tool call: ${toolName}`);

    try {
        switch (toolName) {
            case GET_COMPANY_FULL_INFO_TOOL.name:
                return await handleGetCompanyFullInfo(args);
            case GET_COMPANY_ENREG_INFO_TOOL.name:
                return await handleGetCompanyEnregInfo(args);
            default:
                console.error(`[MCP Server] Unknown tool called: ${toolName}`);
                return {
                    isError: true,
                    content: [{ type: "text", text: `Unknown tool: ${toolName}` } as TextContent]
                };
        }
    } catch (error: any) {
        console.error(`[MCP Server] Error executing tool ${toolName}:`, error);
        return {
            isError: true,
            content: [{ type: "text", text: `Internal server error during ${toolName} execution: ${error.message || 'Unknown error'}` } as TextContent]
        };
    }
});

// --- Server Execution (Express + SSE, following Google Maps example) ---

async function main() {
    const app = express();

    app.use(cors({
        origin: "*", // Adjust for production
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"],
        credentials: true,
    }));
    // No express.json() middleware needed here if handlePostMessage takes raw req

    // Single global transport - !! CAVEAT: Only supports one client connection !!
    let transport: SSEServerTransport;

    // SSE endpoint (GET)
    app.get('/sse', async (req: Request, res: Response) => {
        console.error('[MCP Server] SSE connection requested from', req.ip);
        try {
            transport = new SSEServerTransport("/messages", res); // Matches example
            await server.connect(transport); // Connect server logic to this transport
            console.error('[MCP Server] MCP Server connected to new SSE transport for', req.ip);

            // Example doesn't show close handling here, assuming transport manages it
            req.on('close', () => {
                console.error('[MCP Server] SSE connection closed by client', req.ip);
                transport?.close(); // Attempt to close transport if method exists
                // Cannot reliably reset the global transport variable here for multi-client
            });

        } catch (e) {
            console.error("Error setting up SSE transport:", e);
            if (!res.headersSent) {
                res.status(500).end();
            }
        }
    });

    // Message endpoint (POST)
    app.post('/messages', async (req: Request, res: Response) => {
        console.error('[MCP Server] POST /messages received');
        if (transport) { // Use the single global transport
            try {
                await transport.handlePostMessage(req, res); // Pass raw req and res
            } catch (error) {
                console.error('[MCP Server] Error in handlePostMessage:', error);
                if (!res.headersSent) {
                    res.status(500).send('Error processing message');
                }
            }
        } else {
            console.error('[MCP Server] Received POST message but no active transport');
            res.status(503).send('MCP Server transport unavailable');
        }
    });

    // Health check
    app.get('/health', (req: Request, res: Response) => {
        res.status(200).send('MCP Server is running');
    });

    app.listen(MCP_PORT, () => {
        console.log(`MCP SSE Server (following example pattern) is running on port ${MCP_PORT}`);
        console.log(`SSE Endpoint: http://localhost:${MCP_PORT}/sse`);
        console.log(`Message Endpoint: http://localhost:${MCP_PORT}/messages`);
    });
}

main().catch((error) => {
    console.error("Fatal MCP server error:", error);
    process.exit(1);
});



