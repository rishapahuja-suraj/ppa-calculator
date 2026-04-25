export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, dealState } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'No messages provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const systemPrompt = `You are a financial analyst assistant embedded in a Purchase Price Adjustment (PPA) calculator tool used by Trilogy Acquisitions.

CURRENT DEAL STATE:
${JSON.stringify(dealState, null, 2)}

Your role:
1. Answer questions about the calculations, numbers, and adjustments
2. Explain why numbers are what they are
3. Suggest what to enter for missing fields
4. When the user asks to CHANGE a value, respond with a JSON action block at the END of your response in this exact format:
   <action>{"type":"SET_FIELD","field":"FIELD_ID","value":NUMBER}</action>
   Valid field IDs: basePP, validatedARR, wcNetAR, wcEmpTerm, wcLease, wcOther, wcCapPct, softDR, nonSoftDR, drThreshPct
5. For PDF export requests, respond with: <action>{"type":"EXPORT_PDF"}</action>

Rules:
- Be direct and numbers-focused — this is a finance tool
- Always show your working when explaining calculations
- Use the deal's currency (${dealState?.currency || 'USD'})
- If a field is 0 or missing, point that out proactively
- Keep responses concise — max 4-5 sentences unless explaining a complex calculation`;

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
        system: systemPrompt,
        messages: messages.slice(-10), // last 10 messages for context
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const text = data.content?.[0]?.text || '';

    // Extract action if present
    const actionMatch = text.match(/<action>(.*?)<\/action>/s);
    const action = actionMatch ? JSON.parse(actionMatch[1]) : null;
    const cleanText = text.replace(/<action>.*?<\/action>/s, '').trim();

    return res.status(200).json({ text: cleanText, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
