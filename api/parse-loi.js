export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });
  const prompt = `Extract key deal terms from this Letter of Intent. Return ONLY valid JSON, no markdown.

{
  "basePP": <number in full units e.g. 33000000, null if not found>,
  "currency": <"USD"|"GBP"|"EUR"|"AUD"|"CAD", detect from symbols or text>,
  "validatedARR": <number, null if not found>,
  "wcCapPct": <number e.g. 5, null if not found>,
  "drThreshPct": <number e.g. 50, null if not found>,
  "targetName": <string, null if not found>,
  "buyerName": <string, null if not found>,
  "indiaPct": <number if India reserve clause exists, null otherwise>,
  "hasHoldback": <true if holdback/escrow mentioned, false otherwise>,
  "additionalAdjustments": [{"name": "...", "description": "..."}]
}

LOI TEXT:
${text.slice(0, 12000)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.error?.message });
    const raw = (d.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    try { return res.status(200).json(JSON.parse(raw)); }
    catch { return res.status(500).json({ error: 'Parse failed', raw }); }
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
