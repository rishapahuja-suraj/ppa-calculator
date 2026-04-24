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
    .slice(0, 200)
    .map(row => row.map(c => String(c ?? '').trim()).join('\t'))
    .join('\n');

  const prompt = `You are a financial analyst. I'm giving you raw spreadsheet data from an ARR (Annual Recurring Revenue) report (sheet: "${sheetName}").

Extract and return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Return this exact structure:
{
  "validatedARR": <number — validated in-force ARR in full units e.g. 11500000, null if not found>,
  "totalARR": <number — total ARR if different from validated, null if not found>,
  "currency": <string — 3-letter ISO currency code e.g. "USD", "GBP", null if not found>,
  "breakdown": [
    { "name": "SaaS", "amount": 5600000 },
    { "name": "Recurring Services", "amount": 2500000 }
  ]
}

Rules:
- validatedARR = the primary validated/confirmed in-force ARR figure
- If there are multiple ARR figures, pick the one labelled "validated", "in-force", or "total"
- breakdown = any sub-components of ARR (by product, type, segment) — empty array if not available
- All amounts in full units (not millions) — so $8.1m = 8100000
- currency: detect from column headers or data (£ = GBP, $ = USD, € = EUR)

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
        max_tokens: 1024,
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
