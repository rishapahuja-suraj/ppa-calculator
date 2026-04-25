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

  const sym = dealState?.currency === 'GBP' ? '£' : dealState?.currency === 'EUR' ? '€' : '$';
  const arr = dealState?.validatedARR || 0;
  const basePP = dealState?.basePP || 0;
  const evArr = arr > 0 ? (basePP / arr).toFixed(2) : null;

  const isAutoAnalysis = messages.length === 1 && messages[0].content.includes('Auto-analysis on file upload') === false && messages[0].content.includes('All financial data has been uploaded');

  const systemPrompt = `You are a Managing Director-level M&A analyst. Your background spans 20+ years across JPMorgan M&A, BlackRock Private Equity, and KKR. You are embedded in a Purchase Price Adjustment tool for Trilogy Acquisitions — a PE firm acquiring software companies.

CURRENT DEAL STATE:
- Deal: ${dealState?.dealName || 'Unnamed'} | Buyer: ${dealState?.buyerName || '—'}
- Currency: ${dealState?.currency || 'USD'} (${sym})
- Base Purchase Price: ${sym}${basePP.toLocaleString()}
- Validated ARR: ${arr > 0 ? sym + arr.toLocaleString() : 'Not provided'}
- EV/ARR Multiple: ${evArr ? evArr + 'x' : 'N/A'}
- WC: Net Assets ${sym}${(dealState?.wcNetAR||0).toLocaleString()} | Liabilities ${sym}${((dealState?.wcEmpTerm||0)+(dealState?.wcLease||0)+(dealState?.wcOther||0)).toLocaleString()} | Tangible WC: ${sym}${(dealState?.tangibleWC||0).toLocaleString()} | WC Adj: ${sym}${(dealState?.wcAdj||0).toLocaleString()} (cap: ${sym}${(dealState?.wcCap||0).toLocaleString()})
- Deferred Revenue: SW ${sym}${(dealState?.softDR||0).toLocaleString()} | Non-SW ${sym}${(dealState?.nonSoftDR||0).toLocaleString()} | DR Adj: ${sym}${(dealState?.drAdj||0).toLocaleString()}
- Net Purchase Price: ${sym}${(dealState?.netPP||0).toLocaleString()} (${sym}${Math.round((dealState?.delta||0)/1000)}K vs base)
- Missing: ${[!dealState?.basePP&&'Base PP',!dealState?.validatedARR&&'ARR',!dealState?.wcNetAR&&'WC assets',!dealState?.wcOther&&'WC liabilities',!dealState?.softDR&&'Deferred revenue'].filter(Boolean).join(', ')||'None'}

${isAutoAnalysis ? `
FOR THIS AUTO-ANALYSIS, structure your response as exactly 6 bullet points. Each bullet must start on a new line with a dash (-). No headers, no markdown bold, no asterisks. Plain text only. Cover in this order:
1. EV/ARR assessment vs SaaS benchmarks (typical ranges: distressed 1-3x, stable 4-6x, growth 7-12x). State whether this deal is cheap, fair, or rich and why.
2. Working capital risk — is the WC adjustment favourable or a red flag? Is the cap binding?
3. Deferred revenue exposure — is the DR level high relative to ARR? What does that signal about the customer base?
4. Key financial red flags specific to this deal's numbers
5. Negotiation leverage — where should the buyer push harder?
6. Recommended next step before signing

Be specific to the actual numbers. Never say "I don't have data" — work with what's available and flag what's missing.
` : ''}

RULES FOR ALL RESPONSES:
- Never show reasoning, internal thoughts, or "I should..." statements
- Start directly with the answer
- Use ${sym} for all currency amounts
- Be specific to the deal numbers — no generic advice
- Maximum 5-6 sentences for conversational replies
- For SET_FIELD actions: <action>{"type":"SET_FIELD","field":"FIELD_ID","value":NUMBER}</action>
- For PDF export: <action>{"type":"EXPORT_PDF"}</action>
- Valid field IDs: basePP, validatedARR, wcNetAR, wcEmpTerm, wcLease, wcOther, wcCapPct, softDR, nonSoftDR, drThreshPct`;

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
        messages: messages.slice(-12),
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const text = data.content?.[0]?.text || '';
    const actionMatch = text.match(/<action>(.*?)<\/action>/s);
    const action = actionMatch ? JSON.parse(actionMatch[1]) : null;
    const cleanText = text.replace(/<action>.*?<\/action>/s, '').trim();

    return res.status(200).json({ text: cleanText, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
