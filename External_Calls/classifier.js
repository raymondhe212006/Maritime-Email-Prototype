import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


const FIRST_PASS_TEXT = 'Classify this maritime email. Return ONLY valid JSON: {"type":"MARITIME"}  or {"type":"UNKNOWN"}. No markdown, no explanation.'

const SECOND_PASS_TEXT = ''

function stripMarkdown(str) {
    // Remove ```json ... ``` or ``` ... ``` fences the model sometimes adds
    return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function First_Pass_Classifier(subject, bodyText) {
    const preview = (bodyText || '').slice(0, 100);
    const userContent = `Subject: ${subject}\n\nBody preview: ${preview}`;

    let raw;
    try {
        const msg = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 20,
            temperature: 0,
            system: FIRST_PASS_TEXT,
            messages: [{ role: 'user', content: userContent }],
        });
        raw = msg.content[0].text.trim();
        const parsed = JSON.parse(stripMarkdown(raw));
        const type = parsed.type;
        return type;
    } catch (err) {
        console.error('[classifier] Pass 1 parse failure:', raw || err.message);
        return 'UNKNOWN';
    }
}

export async function Second_Pass_Classifier(email) {

}