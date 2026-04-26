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

  const tableText = rows
    .slice(0, 300)
    .map(row => row.map(c => String(c ?? '').trim()).join('\t'))
    .join('\n');

  const prompt = `You are a financial analyst parsing a closing balance sheet (sheet: "${sheetName}").

COLUMN STRUCTURE (typical for these files):
- Col A: Account Type (e.g. "Asset - Bank", "Liability - Account Payable")
- Col B: Account Name (short name)
- Col C: Trial Balance amount
- Col D: Check (ignore)
- Col E: Assumed amount (the amount actually assumed at closing — USE THIS for WC, not trial balance)
- Col F: Not Assumed amount
- Col G: (sometimes empty)
- Col H: "Include in Tangible Working Capital" (Yes/No — may be blank)

CRITICAL RULES:
1. Always use the ASSUMED column value (Col E), not the trial balance. If Assumed is blank/zero for a row, that item is NOT assumed — exclude it from WC.
2. If the "Include in WC" column (Col H) has Yes/No values — follow them exactly.
3. If the "Include in WC" column is BLANK for all rows — use this judgment:
   WC ASSETS (include): Accounts Receivable, Prepaid Expenses, Other Current Assets
   WC ASSETS (exclude): Bank/Cash, Goodwill, Intangibles, Fixed Assets, Intercompany, Non-Current Assets
   WC LIABILITIES (include): Accounts Payable, Accrued Expenses, Other Current Liabilities
   WC LIABILITIES (exclude): Deferred Revenue, Non-Current Liabilities, Long-term debt
4. For Deferred Revenue: classify "Licences", "CSP", "Subscription", "Support" as software; "Expert Services", "Professional Services", "Implementation" as services. If only one DR row exists, put full amount in software.
5. Skip header rows, total rows, equity rows, P&L rows (Revenue, COGS, Expenses).

Return ONLY valid JSON — no explanation, no markdown:
{
  "sections": [
    {
      "title": "Assets",
      "rows": [
        { "name": "Accounts Receivable", "trialBalance": 2085853, "assumed": 2085853, "includeWC": true }
      ]
    },
    { "title": "Liabilities", "rows": [...] },
    { "title": "Equity & Reserves", "rows": [...] }
  ],
  "wcAssets": <sum of assumed amounts for WC asset rows>,
  "wcLiabilities": <sum of assumed amounts for WC liability rows, as positive number>,
  "workingCapital": <wcAssets minus wcLiabilities>,
  "deferredRevenue": {
    "software": <assumed amount of software/licence DR>,
    "services": <assumed amount of services DR>,
    "total": <total assumed DR>
  }
}

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
