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

  const prompt = `You are a financial analyst parsing a balance sheet spreadsheet (sheet: "${sheetName}").

The spreadsheet may have these columns (not always in this exact order):
- Account Type (e.g. "Asset - Bank", "Liability - Account Payable")  
- Account Name (short name like "Bank", "Accounts Receivable")
- Trial Balance amount (the raw balance)
- Check column (ignore this)
- Assumed amount (the amount ACTUALLY assumed at closing — use this for WC calculations, NOT the trial balance)
- Not Assumed amount
- Include in Tangible Working Capital? (Yes/No)

CRITICAL RULES:
1. Use the "Assumed" column value for WC calculations — NOT the trial balance
2. Only include rows where "Include in Tangible Working Capital" = Yes for WC totals
3. For deferred revenue: classify "Licences", "CSP", "Subscription", "Support" as software; "Expert Services", "Professional Services", "Implementation", "Services" as non-software
4. Ignore rows with zero assumed amounts
5. Skip header rows, total rows, check rows

Return ONLY a valid JSON object — no explanation, no markdown:
{
  "sections": [
    {
      "title": "Assets",
      "rows": [
        { "name": "Accounts Receivable", "trialBalance": 4747682, "assumed": 4747682, "includeWC": true }
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
  "wcAssets": <number — sum of assumed amounts where includeWC=true AND in Assets section>,
  "wcLiabilities": <number — sum of assumed amounts where includeWC=true AND in Liabilities section, as positive number>,
  "workingCapital": <number — wcAssets minus wcLiabilities>,
  "deferredRevenue": {
    "software": <number — assumed amount of software/licence deferred revenue>,
    "services": <number — assumed amount of services deferred revenue>,
    "total": <number — total assumed deferred revenue>
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
