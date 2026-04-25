export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rows, sheetName } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({ error: 'No data provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Convert rows to readable text for Claude
  const tableText = rows
    .slice(0, 300)
    .map(row => row.map(c => String(c ?? '').trim()).join('\t'))
    .join('\n');

  const prompt = `You are a financial analyst. I'm giving you raw spreadsheet data from a balance sheet or trial balance file (sheet: "${sheetName}").

Extract and return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Return this exact structure:
{
  "sections": [
    {
      "title": "Assets",
      "rows": [
        { "name": "Accounts Receivable", "amount": 4747682 }
      ]
    },
    {
      "title": "Liabilities",
      "rows": [...]
    },
    {
      "title": "Equity & Reserves",
      "rows": [...]
    }
  ],
  "deferredRevenue": {
    "software": <number — total software/licence/subscription deferred revenue, 0 if none>,
    "services": <number — total services/professional services/implementation deferred revenue, 0 if none>,
    "total": <number — total of all deferred revenue>
  }
}

Rules:
- Consolidate individual GL accounts into meaningful summary line items (e.g. group all "Asset - Bank" accounts into one "Bank" row)
- Use positive numbers for assets, negative numbers for liabilities
- For deferredRevenue: classify "Licences", "CSP", "Support", "Subscription" as software; "Expert Services", "Professional Services", "Implementation" as services
- Exclude P&L rows (Revenue, COGS, Expenses) and intercompany balances from sections
- Only include rows with non-zero amounts
- section titles must be exactly: "Assets", "Liabilities", or "Equity & Reserves"

SPREADSHEET DATA:
${tableText}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Could not parse Claude response', raw }); }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
