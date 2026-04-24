export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const prompt = `You are a financial analyst parsing a Letter of Intent (LOI) for an acquisition.

Extract the following fields from the LOI text below. Return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Fields to extract:
{
  "basePP": <number — base purchase price in full units e.g. 9000000, null if not found>,
  "currency": <string — 3-letter ISO currency code e.g. "USD", "GBP", "EUR", null if not found>,
  "validatedARR": <number — validated in-force ARR in full units e.g. 11500000, null if not found>,
  "wcCapPct": <number — working capital increase cap as a percentage e.g. 5, null if not found>,
  "drThreshPct": <number — software deferred revenue threshold as % of ARR e.g. 50, null if not found>,
  "targetName": <string — name of the company being acquired (the target), null if not found>,
  "buyerName": <string — name of the acquiring company (the buyer), null if not found>,
  "indiaPct": <number — percentage deduction applied to India reserve and surplus balance, null if not found>,
  "hasHoldback": <boolean — true if the LOI contains any holdback, escrow, or severance escrow clause>,
  "additionalAdjustments": <array of {name: string, description: string} for any other purchase price adjustments found that don't fit the above categories, e.g. prepaid content deductions, cash additions, DIP loans, etc.>
}

Rules:
- basePP and validatedARR must be full numbers (e.g. GBP 33,000,000 → 33000000, not 33)
- If ARR is written as "$8.1m" extract 8100000
- targetName should be the full legal name of the company being acquired
- buyerName should be the full legal name of the acquiring entity
- For fields not present in the LOI, use null (not 0, not "")
- additionalAdjustments should only include non-standard items not covered by the other fields

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

    const raw = data.content?.[0]?.text || '';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse Claude response', raw });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
