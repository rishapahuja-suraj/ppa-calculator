export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { request, currentCode } = req.body || {};
  if (!request || !currentCode) return res.status(400).json({ error: 'Missing request or code' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5', max_tokens: 8192,
        messages: [{ role: 'user', content: `You are improving a PPA calculator app for Trilogy Acquisitions.\nRequest: ${request}\nReturn ONLY the complete modified HTML file, no explanation.\nCURRENT CODE:\n${currentCode}` }],
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.error?.message });
    return res.status(200).json({ modifiedCode: (d.content?.[0]?.text||'').trim() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
