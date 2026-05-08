// Mock admin API for local UI demos. Run with: node scripts/mock-admin-api.mjs
import { createServer } from "node:http";

const PORT = 3001;

let financeState = {
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

const server = createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  if (req.method === "GET" && req.url === "/finance") {
    return send(res, 200, financeState);
  }

  const putHouse = req.method === "PUT" && /^\/finance\/(hillmarton|morrison)$/.exec(req.url ?? "");
  if (putHouse) {
    const body = await readJson(req);
    financeState[putHouse[1]] = body;
    return send(res, 200, { data: body });
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

  const parseHouse = req.method === "POST" &&
    /^\/finance\/(hillmarton|morrison)\/parse-statement$/.exec(req.url ?? "");
  if (parseHouse) {
    const body = await readJson(req);
    const house = parseHouse[1];
    // Simulate OpenRouter latency briefly
    await new Promise((r) => setTimeout(r, 1500));
    const fakeLines = [
      {
        id: `parsed-${Date.now()}-1`,
        dateUtc: "2026-04-25T00:00:00.000Z",
        type: "expenditure",
        description: "British Gas — utilities Apr 2026",
        netAmount: 84.16,
        vat: 16.83,
        grossAmount: 100.99,
        currency: "GBP",
        sourceAssetKey: body.key,
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
        sourceAssetKey: body.key,
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
        sourceAssetKey: body.key,
      },
    ];
    const next = {
      ...financeState[house],
      lines: [...financeState[house].lines, ...fakeLines],
    };
    financeState[house] = next;
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
