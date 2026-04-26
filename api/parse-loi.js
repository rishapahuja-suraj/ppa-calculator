export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables' });

  const prompt = `You are a financial analyst parsing a Letter of Intent (LOI) for an acquisition.

Extract the following fields from the LOI text below. Return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Fields to extract:
{
  "basePP": <number — base purchase price in full units e.g. 9000000, null if not found>,
  "currency": <string — 3-letter ISO currency code e.g. "USD", "GBP", "EUR", null if not found>,
  "validatedARR": <number — validated in-force ARR in full units e.g. 11500000, null if not found>,
  "wcCapPct": <number — working capital increase cap as a percentage e.g. 5, null if not found>,
  "drThreshPct": <number — software deferred revenue threshold as % of ARR e.g. 50, null if not found>,
  "targetName": <string — full legal name of the company being acquired, null if not found>,
  "buyerName": <string — full legal name of the acquiring company, null if not found>,
  "indiaPct": <number — percentage deduction on India reserve and surplus balance, null if not found>,
  "hasHoldback": <boolean — true if LOI contains any holdback, escrow, or severance escrow clause>,
  "additionalAdjustments": <array of {name: string, description: string} for non-standard price adjustments only>
}

Rules:
- basePP and validatedARR must be full numbers (GBP 33,000,000 → 33000000; $8.1m → 8100000)
- targetName = the company being acquired (not the buyer)
- buyerName = the company making the offer
- Use null for fields not present, never 0 or empty string
- additionalAdjustments: only truly non-standard items (e.g. DIP loan, prepaid content deduction)

LOI TEXT:
${text.slice(0, 12000)}`;

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

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    }

    const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Could not parse Claude response', raw });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
