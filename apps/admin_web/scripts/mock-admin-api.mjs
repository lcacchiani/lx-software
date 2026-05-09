// Mock admin API for local UI demos. Run with: node scripts/mock-admin-api.mjs
import { createServer } from "node:http";

const PORT = 3001;

let financeState = {
  incomeRecords: [
    {
      id: "sample-income-1",
      category: "Salary",
      description: "Sample pay (mock API)",
      amount: 12000,
      currency: "HKD",
    },
  ],
  hillmarton: {
    defaultCurrency: "GBP",
    float: { amount: 500, currency: "GBP" },
    lines: [
      {
        id: "manual-1",
        dateUtc: "2026-04-20T09:00:00.000Z",
        type: "income",
        description: "Tenant rent (manual entry)",
        netAmount: 1500,
        vat: 0,
        currency: "GBP",
        grossAmount: 1500,
      },
    ],
  },
  morrison: {
    defaultCurrency: "HKD",
    float: { amount: 0, currency: "HKD" },
    lines: [],
  },
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    ...extra,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

// Sanitise a value for inclusion in a console log line so that any CR/LF
// or other control characters from a malicious request body cannot forge
// fake log entries (CWE-117 / log injection).
function safeForLog(value) {
  return String(value).replace(/[^\x20-\x7E]/g, "?").slice(0, 200);
}

// Whitelist of supported house keys. Routing always picks one of these
// constants explicitly — request data is never used as a property name —
// to avoid any prototype-pollution / remote-property-injection class of
// bug (CWE-915).
const HOUSE_HILLMARTON = "hillmarton";
const HOUSE_MORRISON = "morrison";

function setHouseFinance(house, value) {
  if (house === HOUSE_HILLMARTON) {
    financeState.hillmarton = value;
  } else if (house === HOUSE_MORRISON) {
    financeState.morrison = value;
  }
}

function getHouseFinance(house) {
  if (house === HOUSE_HILLMARTON) return financeState.hillmarton;
  if (house === HOUSE_MORRISON) return financeState.morrison;
  return null;
}

function fakeParsedLines(sourceKey) {
  return [
    {
      id: `parsed-${Date.now()}-1`,
      dateUtc: "2026-04-25T00:00:00.000Z",
      type: "expenditure",
      description: "British Gas — utilities Apr 2026",
      netAmount: 84.16,
      vat: 16.83,
      grossAmount: 100.99,
      currency: "GBP",
      sourceAssetKey: sourceKey,
    },
    {
      id: `parsed-${Date.now()}-2`,
      dateUtc: "2026-04-26T00:00:00.000Z",
      type: "expenditure",
      description: "Thames Water Direct Debit",
      netAmount: 32.5,
      vat: 0,
      grossAmount: 32.5,
      currency: "GBP",
      sourceAssetKey: sourceKey,
    },
    {
      id: `parsed-${Date.now()}-3`,
      dateUtc: "2026-04-28T00:00:00.000Z",
      type: "income",
      description: "Council tax refund",
      netAmount: 45,
      vat: 0,
      grossAmount: 45,
      currency: "GBP",
      sourceAssetKey: sourceKey,
    },
  ];
}

const server = createServer(async (req, res) => {
  console.log(`${safeForLog(req.method)} ${safeForLog(req.url)}`);
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  if (req.method === "GET" && req.url === "/finance") {
    return send(res, 200, financeState);
  }

  if (req.method === "PUT" && req.url === `/finance/${HOUSE_HILLMARTON}`) {
    const body = await readJson(req);
    setHouseFinance(HOUSE_HILLMARTON, body);
    return send(res, 200, { data: body });
  }
  if (req.method === "PUT" && req.url === `/finance/${HOUSE_MORRISON}`) {
    const body = await readJson(req);
    setHouseFinance(HOUSE_MORRISON, body);
    return send(res, 200, { data: body });
  }

  if (req.method === "PUT" && req.url === "/finance/income") {
    const body = await readJson(req);
    const next = Array.isArray(body.incomeRecords) ? body.incomeRecords : [];
    financeState = { ...financeState, incomeRecords: next };
    return send(res, 200, { incomeRecords: next });
  }

  if (req.method === "POST" && req.url === "/assets/upload-url") {
    const body = await readJson(req);
    const key = `uploads/fake-sub/${Date.now()}/${body.filename}`;
    return send(res, 200, {
      upload: {
        url: `http://localhost:${PORT}/__mock_s3_upload`,
        fields: { key, "Content-Type": body.contentType },
      },
      key,
    });
  }

  if (req.method === "POST" && req.url === "/__mock_s3_upload") {
    return send(res, 204, "");
  }

  if (req.method === "POST" && req.url === "/assets/confirm") {
    const body = await readJson(req);
    return send(res, 201, {
      item: {
        pk: `ASSET#${body.key}`,
        sk: "META",
        size: body.size ?? 0,
        clientSha256: body.sha256 ?? null,
      },
    });
  }

  let parseHouse = null;
  if (
    req.method === "POST" &&
    req.url === `/finance/${HOUSE_HILLMARTON}/parse-statement`
  ) {
    parseHouse = HOUSE_HILLMARTON;
  } else if (
    req.method === "POST" &&
    req.url === `/finance/${HOUSE_MORRISON}/parse-statement`
  ) {
    parseHouse = HOUSE_MORRISON;
  }
  if (parseHouse) {
    const body = await readJson(req);
    // Simulate OpenRouter latency briefly so the loading state is visible.
    await new Promise((r) => setTimeout(r, 1500));
    const fakeLines = fakeParsedLines(body.key);
    const current = getHouseFinance(parseHouse);
    const next = {
      ...current,
      lines: [...current.lines, ...fakeLines],
    };
    setHouseFinance(parseHouse, next);
    return send(res, 200, {
      data: next,
      addedLines: fakeLines.length,
      sourceAssetKey: body.key,
    });
  }

  send(res, 404, { message: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mock-admin-api listening on http://localhost:${PORT}`);
});
