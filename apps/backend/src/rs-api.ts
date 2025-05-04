import axios from "axios";
import { load } from 'cheerio';
import { URLSearchParams } from 'url'; // Needed for form data encoding

export const getTaxInfo = async (companyID: string) => {
    const taxInfo = await axios({
        method: "post",
        url: "https://www.rs.ge/RsGe.Module/TaxpayersRegistry/GrdSearchTaxPayers",
        data: {
            tin: companyID,
        },
    });

    return taxInfo.data;
};

export const getPublicInfo = async (companyID: string) => {
    const publicInfo = await axios.get(`https://xdata.rs.ge/TaxPayer/PublicInfo`, {
        data: {
            IdentCode: companyID,
        },
    });

    return publicInfo.data;
};

export const getCompanyFullInfo = async (companyID: string) => {
    try {
        console.log(`[RS] Fetching Tax Info for ${companyID}...`);
        const taxInfoPromise = axios({
            method: "post",
            url: "https://www.rs.ge/RsGe.Module/TaxpayersRegistry/GrdSearchTaxPayers",
            data: {
                tin: companyID,
            },
            // Add timeout and potentially retry logic if needed
            timeout: 10000, // Example: 10 second timeout
        });

        console.log(`[RS] Fetching Public Info for ${companyID}...`);
        const publicInfoPromise = axios.get(`https://xdata.rs.ge/TaxPayer/PublicInfo`, {
            params: {
                IdentCode: companyID,
            },
            timeout: 10000, // Example: 10 second timeout
        });

        // Use Promise.allSettled to get results even if one fails
        const [taxInfoResult, publicInfoResult] = await Promise.allSettled([taxInfoPromise, publicInfoPromise]);

        let taxInfoData: any = null;
        if (taxInfoResult.status === 'fulfilled') {
            console.log(`[RS] Tax Info Response for ${companyID}: Status ${taxInfoResult.value.status}`);
            // Basic check if data structure looks valid
            if (taxInfoResult.value.data?.Data?.Rows?.[0]) {
                taxInfoData = taxInfoResult.value.data.Data.Rows[0];
            } else {
                console.warn(`[RS] Tax Info for ${companyID} returned unexpected structure:`, JSON.stringify(taxInfoResult.value.data));
            }
        } else {
            console.error(`[RS] Tax Info request failed for ${companyID}:`, taxInfoResult.reason);
        }

        let publicInfoData: any = null;
        if (publicInfoResult.status === 'fulfilled') {
            console.log(`[RS] Public Info Response for ${companyID}: Status ${publicInfoResult.value.status}`);
            // Check for the specific system error or successful data
            if (publicInfoResult.value.data?.Status === -100) {
                console.warn(`[RS] Public Info request for ${companyID} returned system error:`, publicInfoResult.value.data.Message);
            } else if (publicInfoResult.value.data) {
                publicInfoData = publicInfoResult.value.data;
            } else {
                console.warn(`[RS] Public Info for ${companyID} returned unexpected structure:`, JSON.stringify(publicInfoResult.value.data));
            }
        } else {
            console.error(`[RS] Public Info request failed for ${companyID}:`, publicInfoResult.reason);
        }

        if (!taxInfoData && !publicInfoData) {
            console.warn(`[RS] No usable data found for ${companyID} in either Tax or Public Info.`);
            return null;
        }

        // Construct the result using safe navigation
        return {
            id: publicInfoData?.id || taxInfoData?.[4] || "",
            name: taxInfoData?.[2] || publicInfoData?.name || "",
            entity_type: publicInfoData?.legal_form || taxInfoData?.[1] || "",
            status: taxInfoData?.[0] || publicInfoData?.status || "",
            create_date: publicInfoData?.id_date || "",
            registration_number: taxInfoData?.[5] || "", // Often the state registration number
            registration_date: taxInfoData?.[7] || "", // Often the last update date
            address: publicInfoData?.address || "",
            directors: publicInfoData?.Directors?.map(
                (director: { name?: string; id?: string; type?: string }) => ({
                    full_name: director?.name || "",
                    personal_id: director?.id || "",
                    role: director?.type || ""
                })
            ) || [],
            founders: publicInfoData?.Founders?.map(
                (founder: { name?: string; id?: string; percent?: number }) => ({
                    full_name: founder?.name || "",
                    personal_id: founder?.id || "",
                    ownership_percentage: founder?.percent === undefined || founder?.percent === null ? null : founder.percent // Handle potential null/undefined
                })
            ) || []
        };
    } catch (error) {
        console.error(`[RS] Unexpected error in getCompanyFullInfo for ${companyID}:`, error);
        return null; // Return null on unexpected error
    }
}

// Helper function to fetch and parse details for a single application
const fetchAndParseAppDetails = async (appId: string, headers: any, ENREG_URL: string): Promise<any> => {
    console.log(`[ENREG App] Fetching details for app_id ${appId}...`);
    try {
        const response = await axios.get(ENREG_URL, {
            params: {
                c: 'app',
                m: 'show_app',
                app_id: appId,
                parent: 'personPage', // As observed in the request
                personID: ''         // As observed
            },
            headers: { // Use subset of headers, Referer might be important
                'User-Agent': headers['User-Agent'],
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': `${ENREG_URL}?c=app&m=show_legal_person` // Referer from the company page
            },
            timeout: 15000
        });

        if (response.status !== 200) {
            console.error(`[ENREG App] Details request failed for app_id ${appId} with status ${response.status}`);
            return { error: `Failed to fetch details, status: ${response.status}` };
        }

        const $app = load(response.data);
        const appDetails: any = { prepared_documents: [], status_history: [], scanned_documents: [], payments: [], metadata: {} };

        // --- Parse Prepared Documents ---
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
                    type: linkElement.find('img').attr('alt') || null // SIGNED/HTML etc.
                });
            }
        });

        // --- Parse Status/Decision History ---
        $app('table.status_list:has(caption:contains("სტატუსი/გადაწყვეტილება")) tbody tr').each((i, row) => {
            const columns = $app(row).find('td');
            if (columns.length >= 3) {
                const linkElement = $app(columns[0]).find('a');
                const idElement = $app(columns[1]).find('span.maintxt').first();
                const dateElement = $app(columns[1]).find('span.smalltxt').first();
                const statusElement = $app(columns[2]).find('span').first(); // Find first span for status text
                const decisionElement = $app(columns[2]).find('p'); // Decision might be in a <p>

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

        // --- Parse Scanned Documents ---
        $app('table.status_list:has(caption:contains("სკანირებული დოკუმენტები")) tbody tr').each((i, row) => {
            const columns = $app(row).find('td');
            if (columns.length >= 3) {
                const linkElement = $app(columns[0]).find('a'); // Link on image
                const dateElement = $app(columns[1]).find('span.maintxt').first();
                const nameLinkElement = $app(columns[2]).find('a'); // Link on name

                appDetails.scanned_documents.push({
                    name: nameLinkElement.text().trim(),
                    date: dateElement.text().trim(),
                    link: nameLinkElement.attr('href') || linkElement.attr('href') || null // Prefer link on name
                });
            }
        });

        // --- Parse Application Details Table ---
        const getAppDetailValue = (headerText: string): string => {
            // Find the header td, go to its parent tr, then find the next td in that row
            return $app(`td:contains("${headerText}")`).next('td').text().trim() || "";
        };
        // Find table by caption containing the app ID
        const metadataTable = $app(`table.status_list:has(caption:contains("განცხადება # ${appId}"))`);

        appDetails.metadata.registration_number = metadataTable.find(`td:contains("რეგისტრაციის ნომერი")`).next('td').text().trim();
        appDetails.metadata.service_type = metadataTable.find(`td:contains("მომსახურების სახე")`).next('td').text().trim();
        appDetails.metadata.service_cost_description = metadataTable.find(`td:contains("მომსახურების ღირებულება")`).next('td').text().trim();
        appDetails.metadata.payable_amount_balance = metadataTable.find(`td:contains("გადასახდელი თანხა/ბალანსი")`).next('td').text().trim();

        // --- Parse Payments Sub-Table ---
        metadataTable.find('table.pList tbody tr').each((i, row) => {
            const cols = $app(row).find('td');
            // Skip header-like rows if any, check for expected number of columns
            if (cols.length === 5 && !$app(row).find('th').length) {
                const paymentStatus = $app(cols[0]).text().trim();
                // Avoid adding the 'დავალიანება' (Debt) summary row as a payment
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


        // --- Parse Applicant/Representative section ---
        // Need to find the correct table - might be the last one before scripts?
        // Or look for specific headers like 'განმცხადებელი'
        const applicantTable = $app('div#application_tab table').first(); // Adjust selector if needed
        if (applicantTable.length) {
            appDetails.metadata.applicant_name_id = applicantTable.find(`td:contains("განმცხადებელი")`).next('td').contents().first().text().trim();
            appDetails.metadata.applicant_address = applicantTable.find(`td:contains("განმცხადებელი")`).next('td').find('span').text().trim();
            appDetails.metadata.representative_name_id = applicantTable.find(`td:contains("წარმომადგენელი")`).next('td').contents().first().text().trim();
            appDetails.metadata.representative_address = applicantTable.find(`td:contains("წარმომადგენელი")`).next('td').find('span').text().trim();

            // Attached Documents
            appDetails.metadata.attached_documents = [];
            applicantTable.find('td:contains("თანდართული დოკუმენტაცია")').next('td').find('li').each((i, li) => {
                appDetails.metadata.attached_documents.push($app(li).text().trim());
            });
            // Additionally Submitted Docs (may need adjustment based on actual structure)
            applicantTable.find('td:contains("დამატებით წარმოდგენილი")').next('td').find('li').each((i, li) => {
                // Might be empty or structured differently
                appDetails.metadata.attached_documents.push($app(li).text().trim() + " (Additionally Submitted)");
            });
            appDetails.metadata.note = applicantTable.find('td:contains("შენიშვნა")').next('td').text().trim();

        } else {
            console.warn(`[ENREG App ${appId}] Could not find applicant details table.`);
        }

        console.log(`[ENREG App] Successfully parsed details for app_id ${appId}`);
        return appDetails;

    } catch (error: any) {
        console.error(`[ENREG App] Error processing app_id ${appId}:`, error.message);
        if (axios.isAxiosError(error)) {
            console.error(`[ENREG App ${appId}] Axios error details: Status ${error.response?.status}`);
        }
        return { error: 'Failed to process application details' };
    }
};

export const getCompanyENREGInfo = async (companyID: string) => {
    const ENREG_URL = 'https://enreg.reestri.gov.ge/_dea/main.php';
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; CompanyInfoFetcher/1.0)',
        'Accept': '*/*',
        'Origin': 'https://enreg.reestri.gov.ge',
        'Referer': 'https://enreg.reestri.gov.ge/_dea/main.php?m=new_index'
    };

    try {
        // Step 1: Search for the company to get legal_code_id
        console.log(`[ENREG] Searching for company ${companyID}...`);
        const searchParams = new URLSearchParams();
        searchParams.append('c', 'search');
        searchParams.append('m', 'find_legal_persons');
        searchParams.append('s_legal_person_idnumber', companyID);
        searchParams.append('s_legal_person_name', '');
        searchParams.append('s_legal_person_form', '0');
        searchParams.append('s_legal_person_email', '');

        const searchResponse = await axios.post(ENREG_URL, searchParams.toString(), {
            headers: headers,
            timeout: 15000
        });

        if (searchResponse.status !== 200) {
            console.error(`[ENREG] Search request failed with status ${searchResponse.status} for ${companyID}`);
            return null;
        }

        const $search = load(searchResponse.data);
        let legalCodeId: string | null = null;

        // Find the table row containing the company ID and extract the onclick attribute
        // This selector might need adjustment if the HTML structure changes
        const onclickAttr = $search(`td:contains("${companyID}")`).closest('tr').find('a[onclick^="show_legal_person"]').attr('onclick');

        if (onclickAttr) {
            const match = onclickAttr.match(/show_legal_person\((\d+)\)/);
            if (match && match[1]) {
                legalCodeId = match[1];
                console.log(`[ENREG] Found legal_code_id: ${legalCodeId} for company ${companyID}`);
            } else {
                console.warn(`[ENREG] Could not parse legal_code_id from onclick attribute: ${onclickAttr} for ${companyID}`);
            }
        } else {
            console.warn(`[ENREG] No result or no 'show_legal_person' link found for company ${companyID} in search results.`);
            // Check if the table exists but has no matching rows
            if ($search('table.main_tbl tbody tr').length > 0) {
                console.log(`[ENREG] Search table found, but no exact match or link for ID ${companyID}.`);
            } else {
                console.log(`[ENREG] Search results page structure might have changed or no results table found.`);
            }
            return { // Return specific structure indicating not found
                company_id: companyID,
                status: 'Not Found in ENREG Search',
                details: null,
                applications: []
            };
        }

        if (!legalCodeId) {
            console.error(`[ENREG] Failed to extract legal_code_id for company ${companyID}.`);
            return null;
        }

        // Step 2: Fetch the details page
        console.log(`[ENREG] Fetching details for legal_code_id ${legalCodeId}...`);
        const detailsResponse = await axios.get(ENREG_URL, {
            params: { c: 'app', m: 'show_legal_person', legal_code_id: legalCodeId, enteredCaptcha: '1' },
            headers: { /* ... necessary headers ... */ },
            timeout: 15000
        });

        if (detailsResponse.status !== 200) {
            console.error(`[ENREG] Details request failed with status ${detailsResponse.status} for legal_code_id ${legalCodeId}`);
            return null;
        }

        const $details = load(detailsResponse.data);

        // Step 3: Parse the main details page
        const companyDetails: any = {};
        const applicationsBaseInfo: any[] = []; // Store base info + app_id

        // Helper function to get text from cell next to a header cell
        const getDetailValue = (headerText: string): string => {
            return $details(`td:contains("${headerText}")`).next('td').text().trim() || "";
        };

        companyDetails.identification_code = getDetailValue('საიდენტიფიკაციო კოდი');
        companyDetails.name = getDetailValue('დასახელება');
        companyDetails.legal_form = getDetailValue('სამართლებრივი ფორმა');
        companyDetails.registration_date = getDetailValue('რეგისტრაციის თარიღი');
        companyDetails.status_text = $details(`td:contains("სტატუსი")`).next('td').find('div').text().trim() || "";
        // ... parse other details ...
        companyDetails.documents = {}; // Initialize documents object
        $details('td:contains("კონსოლიდირებული სადამფუძნებლო შეთანხმება / წესდება")').next('td').find('a').each((i: number, el: cheerio.Element) => {
            const linkText = $details(el).text().trim();
            const linkHref = $details(el).attr('href');
            if (linkText && linkHref) {
                if (linkText.includes('სადამფუძნებლო შეთანხმება')) companyDetails.documents.founding_agreement_link = linkHref;
                if (linkText.includes('კონსოლიდირებული წესდება')) companyDetails.documents.consolidated_charter_link = linkHref;
            }
        });
        companyDetails.reporting_link = $details('a[href*="reportal.ge/Forms.aspx"]').attr('href') || "";


        // Step 3b: Extract application base info and app_id
        console.log(`[ENREG] Extracting application list for legal_code_id ${legalCodeId}...`);
        $details('#tabs-1 table tbody tr').each((i: number, row: cheerio.Element) => {
            const columns = $details(row).find('td');
            if (columns.length === 5) {
                const onclickAttrApp = $details(columns[0]).find('a').attr('onclick');
                let appId: string | null = null;
                if (onclickAttrApp) {
                    const match = onclickAttrApp.match(/show_app\((\d+)/);
                    if (match && match[1]) {
                        appId = match[1];
                    }
                }

                if (appId) { // Only add if we have an app ID
                    applicationsBaseInfo.push({
                        app_id: appId,
                        registration_number: $details(columns[1]).text().trim(),
                        service_type: $details(columns[2]).text().trim(),
                        status: $details(columns[3]).text().trim(),
                        date: $details(columns[4]).text().trim(),
                    });
                } else {
                    console.warn(`[ENREG] Could not extract app_id for application in row ${i + 1} for legal_code_id ${legalCodeId}`);
                }
            }
        });

        // Step 4 & 5: Fetch and parse details for each application
        console.log(`[ENREG] Fetching details for ${applicationsBaseInfo.length} applications...`);
        const applicationDetailPromises = applicationsBaseInfo.map(appInfo =>
            fetchAndParseAppDetails(appInfo.app_id, headers, ENREG_URL)
        );
        const applicationDetailResults = await Promise.allSettled(applicationDetailPromises);

        // Step 6: Combine results
        const detailedApplications = applicationsBaseInfo.map((baseInfo, index) => {
            const detailResult = applicationDetailResults[index];

            // Check if the result exists for the index
            if (!detailResult) {
                console.error(`[ENREG] Mismatch in application results array for index ${index}, app_id ${baseInfo.app_id}.`);
                return {
                    ...baseInfo,
                    details: { error: 'Internal processing error: Result mismatch' }
                };
            }

            // Type guard to check if the promise was fulfilled or rejected
            if (detailResult.status === 'fulfilled') {
                return {
                    ...baseInfo,
                    details: detailResult.value // Access value safely
                };
            } else {
                // Promise was rejected
                console.error(`[ENREG] Failed to fetch/parse details for app_id ${baseInfo.app_id}:`, detailResult.reason);
                return {
                    ...baseInfo,
                    details: { error: 'Failed to fetch/parse details', reason: detailResult.reason }
                };
            }
        });

        console.log(`[ENREG] Successfully processed company ${companyID}`);

        return {
            company_id: companyID,
            status: 'Found',
            enreg_internal_id: legalCodeId,
            details: companyDetails,
            applications: detailedApplications // Now includes detailed info
        };

    } catch (error: any) {
        console.error(`[ENREG] Top-level error processing company ${companyID}:`, error.message);
        if (axios.isAxiosError(error)) {
            console.error(`[ENREG] Axios error details: Status ${error.response?.status}, Data: ${JSON.stringify(error.response?.data)}`);
        }
        return null;
    }
};

