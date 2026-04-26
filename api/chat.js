export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, dealState, mode } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'No messages provided' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const sym = dealState?.currency === 'GBP' ? '£' : dealState?.currency === 'EUR' ? '€' : '$';
  const evArr = dealState?.validatedARR ? (dealState.basePP / dealState.validatedARR).toFixed(2) : null;

  // Mode: 'insight' = structured deal intelligence box, 'chat' = conversational
  const isInsightMode = mode === 'insight';

  const systemPrompt = isInsightMode
    ? `You are a senior M&A analyst producing a structured deal intelligence brief. Return ONLY a valid JSON object — no markdown, no explanation.

DEAL DATA:
- Target: ${dealState?.dealName || 'Unknown'} | Buyer: ${dealState?.buyerName || 'Unknown'}
- Currency: ${dealState?.currency || 'USD'} (${sym})
- Base Purchase Price: ${sym}${((dealState?.basePP||0)/1e6).toFixed(3)}M
- Validated ARR: ${dealState?.validatedARR ? sym+(dealState.validatedARR/1e6).toFixed(2)+'M' : 'Not provided'}
- EV/ARR Multiple: ${evArr ? evArr+'x' : 'N/A'}
- Tangible WC: ${dealState?.wcNetAR ? sym+((dealState.tangibleWC||0)/1e6).toFixed(3)+'M' : 'Not populated'}
- WC Adjustment: ${dealState?.wcAdj ? sym+((dealState.wcAdj||0)/1e6).toFixed(3)+'M (capped at '+dealState.wcCapPct+'% ARR)' : 'Not populated'}
- Software DR: ${dealState?.softDR ? sym+((dealState.softDR||0)/1e6).toFixed(3)+'M' : 'Not populated'}
- Non-SW DR: ${dealState?.nonSoftDR ? sym+((dealState.nonSoftDR||0)/1e6).toFixed(3)+'M' : 'Not populated'}
- DR Adjustment: ${dealState?.drAdj ? sym+((dealState.drAdj||0)/1e6).toFixed(3)+'M' : 'Not populated'}
- Net Purchase Price: ${sym}${((dealState?.netPP||0)/1e6).toFixed(3)}M

Return this exact JSON structure:
{
  "metrics": [
    {"label": "EV/ARR", "value": "X.Xx", "benchmark": "SaaS median 4-6x", "status": "low|fair|high"},
    {"label": "WC Impact", "value": "${sym}XM", "benchmark": "brief context", "status": "positive|negative|neutral"},
    {"label": "DR Exposure", "value": "X% of ARR", "benchmark": "brief context", "status": "low|elevated|high"}
  ],
  "sections": [
    {
      "label": "Valuation Assessment",
      "items": [
        {"dot": "blue|green|amber|red", "text": "Bold label: concise insight specific to this deal's numbers."}
      ]
    },
    {
      "label": "Risk Factors",
      "items": [...]
    },
    {
      "label": "Negotiation Positioning",
      "items": [...]
    },
    {
      "label": "Recommended Actions",
      "items": [...]
    }
  ]
}

Rules:
- Every insight must reference actual numbers from the deal data above
- Use ${sym} for all amounts
- SaaS EV/ARR context: <2x distressed/declining, 2-4x value/turnaround, 4-6x healthy growth, 6-10x premium growth
- WC context: negative tangible WC is common in SaaS (deferred revenue funded), but large negative signals billing quality issues
- DR context: >60% of ARR in DR suggests heavy upfront billing; the threshold adjustment protects buyer
- Be specific, not generic — mention the actual multiple, the actual DR %, the actual WC number
- Maximum 4 items per section, minimum 2`

    : `You are a senior M&A analyst embedded in a Purchase Price Adjustment calculator for Trilogy Acquisitions.

CURRENT DEAL STATE:
- Deal: ${dealState?.dealName || 'Unnamed'} | Buyer: ${dealState?.buyerName || 'Unknown'}
- Currency: ${dealState?.currency || 'USD'} (${sym})
- Base PP: ${sym}${((dealState?.basePP||0)/1e6).toFixed(3)}M | ARR: ${dealState?.validatedARR ? sym+(dealState.validatedARR/1e6).toFixed(2)+'M' : 'not entered'}
- EV/ARR: ${evArr ? evArr+'x' : 'N/A'} | Net PP: ${sym}${((dealState?.netPP||0)/1e6).toFixed(3)}M
- WC: Tangible ${sym}${((dealState?.tangibleWC||0)/1000).toFixed(0)}K → Adj ${sym}${((dealState?.wcAdj||0)/1000).toFixed(0)}K
- DR: SW ${sym}${((dealState?.softDR||0)/1000).toFixed(0)}K, Non-SW ${sym}${((dealState?.nonSoftDR||0)/1000).toFixed(0)}K → Adj ${sym}${((dealState?.drAdj||0)/1000).toFixed(0)}K

YOUR ROLE: Senior M&A analyst. Direct, numbers-first. Max 4-5 sentences unless deep analysis requested.

CRITICAL: Never show reasoning. Start directly with the answer. No preamble.

For SET_FIELD actions: <action>{"type":"SET_FIELD","field":"FIELD_ID","value":NUMBER}</action>
Valid fields: basePP, validatedARR, wcNetAR, wcEmpTerm, wcLease, wcOther, wcCapPct, softDR, nonSoftDR, drThreshPct
For PDF: <action>{"type":"EXPORT_PDF"}</action>`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: isInsightMode ? 2048 : 1024,
        system: systemPrompt,
        messages: messages.slice(-12),
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const text = (data.content?.[0]?.text || '').trim();

    if (isInsightMode) {
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return res.status(200).json({ insight: parsed });
      } catch {
        return res.status(500).json({ error: 'Could not parse insight JSON', raw: text });
      }
    }

    const actionMatch = text.match(/<action>(.*?)<\/action>/s);
    const action = actionMatch ? JSON.parse(actionMatch[1]) : null;
    const cleanText = text.replace(/<action>.*?<\/action>/s, '').trim();
    return res.status(200).json({ text: cleanText, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
