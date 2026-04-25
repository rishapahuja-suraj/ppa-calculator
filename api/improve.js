export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { request, currentCode, targetFile } = req.body || {};
  if (!request || !currentCode) return res.status(400).json({ error: 'Missing request or code' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const prompt = `You are an expert frontend/fullstack developer. You are improving a Purchase Price Adjustment calculator app used by Trilogy Acquisitions (a private equity firm).

FILE: ${targetFile || 'index.html'}

IMPROVEMENT REQUEST:
${request}

CURRENT CODE:
${currentCode}

Instructions:
1. Make ONLY the changes needed to fulfill the request — do not rewrite unrelated parts
2. Return the COMPLETE modified file — every line, including unchanged parts
3. Do not add markdown, explanations, or code fences — return raw code only
4. Preserve all existing functionality
5. Keep the same code style and conventions as the existing code`;

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
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const modifiedCode = (data.content?.[0]?.text || '').trim();
    return res.status(200).json({ modifiedCode, targetFile });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
