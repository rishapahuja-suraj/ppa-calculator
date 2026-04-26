export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { rows, sheetName } = req.body || {};
  if (!rows) return res.status(400).json({ error: 'No data' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });
  const table = rows.slice(0, 200).map(r => r.map(c => String(c??'').trim()).join('\t')).join('\n');
  const prompt = `Extract ARR from this spreadsheet (sheet: "${sheetName}"). Return ONLY valid JSON:
{"validatedARR":<number in full units>,"currency":<"USD"|"GBP"|"EUR"|null>,"breakdown":[{"name":"...","amount":0}]}
Use the validated/in-force ARR figure. All amounts in full units (not millions).
DATA:\n${table}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 512, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.error?.message });
    const raw = (d.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    try { return res.status(200).json(JSON.parse(raw)); }
    catch { return res.status(500).json({ error: 'Parse failed', raw }); }
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
