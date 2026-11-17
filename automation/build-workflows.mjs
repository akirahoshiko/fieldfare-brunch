// Generates the n8n workflow files for Fieldfare. Run: node automation/build-workflows.mjs
// Then import them in n8n (Workflows → Import from file), choose your credentials,
// set the Telegram chat id and the Google Sheet, and Publish.
//
// Optional: create automation/local.json (ignored by git) to fill in your own values:
//   { "telegramChatId": "123", "sheetId": "abc", "credentials": { "gmail": {"id":"..","name":".."}, ... } }
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const local = existsSync(new URL("./local.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./local.json", import.meta.url), "utf8")) : {};
const SITE = "https://fieldfare-brunch.peaceomachunyiejiga.workers.dev";
const CHAT = local.telegramChatId || "YOUR_TELEGRAM_CHAT_ID";
const SHEET = local.sheetId || "YOUR_GOOGLE_SHEET_ID";
const C = local.credentials || {};
const OUT = local.outDir ? new URL(local.outDir, import.meta.url) : new URL("./", import.meta.url);
const IDS = { messages: "FfOrderMessages1", summary: "FfEndOfDaySumm01", errors: "FfErrorAlerts001", setup: "FfSheetSetup0001" };

const cred = (type, key, fallbackName) => ({ [type]: C[key] ? { id: C[key].id, name: C[key].name } : { id: "", name: fallbackName } });
const api = { authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth" };
const apiCred = cred("httpHeaderAuth", "api", "Fieldfare API");
let n = 0;
const node = (name, type, typeVersion, parameters, position, credentials) => ({ id: `ff-${++n}`, name, type, typeVersion, position, parameters, ...(credentials ? { credentials } : {}) });
const note = (name, content, position, width = 520, height = 240) => node(name, "n8n-nodes-base.stickyNote", 1, { content, width, height }, position);
const to = (...names) => names.map((nm) => ({ node: nm, type: "main", index: 0 }));
const settings = (extra = {}) => ({ executionOrder: "v1", timezone: "Europe/London", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner", errorWorkflow: IDS.errors, ...extra });
const ifNode = (name, expr, position) => node(name, "n8n-nodes-base.if", 2.2, {
  conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 }, combinator: "and",
    conditions: [{ id: `c${n}`, leftValue: expr, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }] },
  looseTypeValidation: true, options: {},
}, position);
const telegram = (name, textExpr, position) => node(name, "n8n-nodes-base.telegram", 1.2, { chatId: CHAT, text: textExpr, additionalFields: { appendAttribution: false } }, position, cred("telegramApi", "telegram", "Telegram account"));
const sheetAppend = (name, tabExpr, position) => node(name, "n8n-nodes-base.googleSheets", 4.5, {
  operation: "append",
  documentId: { __rl: true, mode: "id", value: SHEET },
  sheetName: { __rl: true, mode: "name", value: tabExpr },
  columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] },
  options: {},
}, position, cred("googleSheetsOAuth2Api", "sheets", "Google Sheets account"));
const rowFrom = (name, expr, position) => node(name, "n8n-nodes-base.set", 3.4, { mode: "raw", jsonOutput: expr, options: {} }, position);
const write = (file, wf) => writeFileSync(new URL(file, OUT), JSON.stringify(wf, null, 2) + "\n");

/* ---------- 1. Order messages: every minute ---------- */
{
  const EV = "$('Split out events').item.json";
  const nodes = [
    note("About", "## Fieldfare: order messages\nEvery minute, collects new events from the website's outbox and, for each one:\n1. emails the guest (confirmation or \"your order is ready\"), when they gave an email\n2. alerts you on Telegram about big or late orders\n3. logs orders and mailing-list sign-ups in Google Sheets\n4. tells the website it's done\n\nThe website writes all the wording. If a step fails, the event is not marked done and is tried again next minute. Nothing is lost while this PC is off.", [-40, -300]),
    node("Every minute", "n8n-nodes-base.scheduleTrigger", 1.2, { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, [0, 0]),
    node("Get new events", "n8n-nodes-base.httpRequest", 4.2, { url: `${SITE}/api/outbox`, ...api, options: { timeout: 20000 } }, [220, 0], apiCred),
    node("Split out events", "n8n-nodes-base.splitOut", 1, { fieldToSplitOut: "events", options: {} }, [440, 0]),
    ifNode("Email to send?", `={{ !!${EV}.email }}`, [660, 0]),
    node("Email the guest", "n8n-nodes-base.gmail", 2.1, { sendTo: `={{ ${EV}.email.to }}`, subject: `={{ ${EV}.email.subject }}`, emailType: "html", message: `={{ ${EV}.email.html }}`, options: { appendAttribution: false, senderName: "Fieldfare" } }, [880, -100], cred("gmailOAuth2", "gmail", "Gmail account")),
    ifNode("Telegram alert?", `={{ !!${EV}.telegram }}`, [1100, 0]),
    telegram("Alert the owner", `={{ ${EV}.telegram }}`, [1320, -100]),
    ifNode("Sheet row?", `={{ !!${EV}.sheet }}`, [1540, 0]),
    rowFrom("Sheet row", `={{ JSON.stringify(${EV}.sheet.row) }}`, [1760, -100]),
    sheetAppend("Log to Google Sheets", `={{ ${EV}.sheet.tab }}`, [1980, -100]),
    node("Mark as done", "n8n-nodes-base.httpRequest", 4.2, { method: "POST", url: `${SITE}/api/outbox/ack`, ...api, sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify({ ids: [${EV}.id] }) }}`, options: {} }, [2200, 0], apiCred),
  ];
  const connections = {
    "Every minute": { main: [to("Get new events")] },
    "Get new events": { main: [to("Split out events")] },
    "Split out events": { main: [to("Email to send?")] },
    "Email to send?": { main: [to("Email the guest"), to("Telegram alert?")] },
    "Email the guest": { main: [to("Telegram alert?")] },
    "Telegram alert?": { main: [to("Alert the owner"), to("Sheet row?")] },
    "Alert the owner": { main: [to("Sheet row?")] },
    "Sheet row?": { main: [to("Sheet row"), to("Mark as done")] },
    "Sheet row": { main: [to("Log to Google Sheets")] },
    "Log to Google Sheets": { main: [to("Mark as done")] },
  };
  write("fieldfare-order-messages.json", { id: IDS.messages, name: "Fieldfare · Order messages", nodes, connections, settings: settings(), pinData: {}, active: false });
}

/* ---------- 2. End-of-day summary: daily at 3:30pm London ---------- */
{
  const S = "$('Get today\\'s summary').item.json";
  const nodes = [
    note("About", "## Fieldfare: end-of-day summary\nEvery day at 3:30pm London time (after closing), gets the day's orders, takings and best sellers from the website, sends you a Telegram summary and adds a row to the Daily summary sheet. On closed days with no orders it stays quiet.", [-40, -260], 480, 200),
    node("Every day at 3:30pm", "n8n-nodes-base.scheduleTrigger", 1.2, { rule: { interval: [{ field: "days", triggerAtHour: 15, triggerAtMinute: 30 }] } }, [0, 0]),
    node("Get today's summary", "n8n-nodes-base.httpRequest", 4.2, { url: `${SITE}/api/summary`, ...api, options: { timeout: 20000 } }, [220, 0], apiCred),
    ifNode("Anything to send?", `={{ !!${S}.telegram }}`, [440, 0]),
    telegram("Telegram the summary", `={{ ${S}.telegram }}`, [660, -100]),
    ifNode("Log the day?", `={{ !!${S}.sheet }}`, [880, 0]),
    rowFrom("Summary row", `={{ JSON.stringify(${S}.sheet.row) }}`, [1100, -100]),
    sheetAppend("Add to Daily summary", "Daily summary", [1320, -100]),
  ];
  const connections = {
    "Every day at 3:30pm": { main: [to("Get today's summary")] },
    "Get today's summary": { main: [to("Anything to send?")] },
    "Anything to send?": { main: [to("Telegram the summary"), to("Log the day?")] },
    "Telegram the summary": { main: [to("Log the day?")] },
    "Log the day?": { main: [to("Summary row"), []] },
    "Summary row": { main: [to("Add to Daily summary")] },
  };
  write("fieldfare-end-of-day.json", { id: IDS.summary, name: "Fieldfare · End-of-day summary", nodes, connections, settings: settings(), pinData: {}, active: false });
}

/* ---------- 3. Error alerts ---------- */
{
  const nodes = [
    node("When a Fieldfare workflow fails", "n8n-nodes-base.errorTrigger", 1, {}, [0, 0]),
    telegram("Telegram the owner", "={{ `Fieldfare automation problem\\nWorkflow: ${$json.workflow.name}\\nStep: ${$json.execution.lastNodeExecuted || 'unknown'}\\nError: ${($json.execution.error && $json.execution.error.message) || 'unknown'}\\nIt will try again on the next run.` }}", [240, 0]),
  ];
  write("fieldfare-error-alerts.json", { id: IDS.errors, name: "Fieldfare · Error alerts", nodes, connections: { "When a Fieldfare workflow fails": { main: [to("Telegram the owner")] } }, settings: { executionOrder: "v1" }, pinData: {}, active: false });
}

/* ---------- 4. One-time setup: creates the Google Sheet with its three tabs and headers ---------- */
{
  const nodes = [
    note("About", "## Fieldfare: one-time sheet setup\nRun once. Creates a Google Sheet called \"Fieldfare\" with three tabs (Orders, Daily summary, Mailing list) and their header rows. Copy the new sheet's id into the two main workflows (or into automation/local.json and rebuild).", [-40, -240], 480, 200),
    node("Run once", "n8n-nodes-base.manualTrigger", 1, {}, [0, 0]),
    node("Create the sheet", "n8n-nodes-base.googleSheets", 4.5, {
      resource: "spreadsheet", title: "Fieldfare",
      sheetsUi: { sheetValues: [{ title: "Orders" }, { title: "Daily summary" }, { title: "Mailing list" }] },
      options: { locale: "en_GB" },
    }, [220, 0], cred("googleSheetsOAuth2Api", "sheets", "Google Sheets account")),
    node("Write header rows", "n8n-nodes-base.httpRequest", 4.2, {
      method: "POST",
      url: "={{ `https://sheets.googleapis.com/v4/spreadsheets/${$json.spreadsheetId}/values:batchUpdate` }}",
      authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api",
      sendBody: true, specifyBody: "json",
      jsonBody: JSON.stringify({ valueInputOption: "RAW", data: [
        { range: "Orders!A1:I1", values: [["placed_at", "order", "pickup", "name", "phone", "email", "items", "total_gbp", "notes"]] },
        { range: "'Daily summary'!A1:H1", values: [["day", "orders", "items", "takings_gbp", "expected_gbp", "not_collected", "cancelled", "best_sellers"]] },
        { range: "'Mailing list'!A1:B1", values: [["signed_up", "email"]] },
      ] }),
      options: {},
    }, [440, 0], cred("googleSheetsOAuth2Api", "sheets", "Google Sheets account")),
  ];
  write("fieldfare-sheet-setup.json", { id: IDS.setup, name: "Fieldfare · One-time sheet setup", nodes, connections: { "Run once": { main: [to("Create the sheet")] }, "Create the sheet": { main: [to("Write header rows")] } }, settings: { executionOrder: "v1", timezone: "Europe/London" }, pinData: {}, active: false });
}
console.log("Wrote 4 workflow files to", OUT.pathname);
