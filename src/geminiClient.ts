// Everything Gemini-specific lives in this one file. To swap providers later,
// write a new file with the same getStackRecommendation signature and change
// the one import in extension.ts — nothing else needs to know.

const MODEL = 'gemini-3.5-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export interface StackAnswers {
	whatBuilding: string;
	userCount: string;
	timeline: string;
	budget: string;
	serverComfort: string;
	techComfort: string;
}

// Maps the short codes the form sends into readable phrases for the prompt
const WHAT_BUILDING_TEXT: Record<string, string> = {
	web: 'a web app',
	mobile: 'a mobile app',
	'extension-or-api': 'a browser extension or an API-only backend',
	unsure: 'not sure yet what kind of app'
};

const USER_COUNT_TEXT: Record<string, string> = {
	handful: 'a handful of users at first',
	hundreds: 'hundreds of users at first',
	thousands: 'thousands of users or more at first'
};

const TIMELINE_TEXT: Record<string, string> = {
	days: 'a working version within days',
	weeks: 'a working version within weeks',
	months: 'a working version within months'
};

const BUDGET_TEXT: Record<string, string> = {
	free: 'free-tier tools and hosting only',
	small: 'a small budget for hosting and tools',
	none: 'no real budget constraint'
};

const SERVER_COMFORT_TEXT: Record<string, string> = {
	avoid: 'wants to avoid managing servers entirely',
	some: 'is somewhat comfortable managing servers',
	very: 'is very comfortable managing servers'
};

const TECH_COMFORT_TEXT: Record<string, string> = {
	js: 'is mostly comfortable with JavaScript / web technologies',
	python: 'is mostly comfortable with Python',
	several: 'has a little familiarity with several languages',
	new: 'is new to coding and relies on AI to write the code',
	other: 'has other or unspecified technical comfort (prefers not to say)'
};

function buildPrompt(answers: StackAnswers, projectContext: string | null): string {
	const projectContextSection = projectContext
		? `\n\nThey also have a project already open in their editor. Here is what can be\nseen about it — take it into account (e.g. build on what's already there\nrather than suggesting something redundant), but still say so if their\nanswers suggest a different direction would actually serve them better:\n\n${projectContext}`
		: '';

	return `You are a pragmatic software architecture advisor helping a beginner "vibe coder" —
someone who builds software by describing what they want to an AI, and wants to
understand their technical choices well enough to push back on them, not just be
handed an answer.

Based on the answers below, recommend a tech stack (frontend, backend/language,
database if relevant, and hosting/deployment approach) suited to this project.

For each part of the stack you recommend:
- State the choice clearly.
- Explain WHY it fits *these specific answers* — not a generic reason that would
  apply to any project.
- Mention at least one realistic alternative or trade-off they're giving up, so
  they understand the decision rather than just receiving it.

If any answer is vague (e.g. "not sure yet") or answers are in tension with each
other (e.g. a tiny budget but expecting thousands of users), say so honestly
instead of forcing one clean answer — name the tension or gap, and explain what
decision or piece of information would resolve it.

Factor in what they're already comfortable with technically: lean toward
technologies that match their existing experience when that fits their other
answers well, but if stepping outside their comfort zone would clearly serve
them better, recommend that instead and explain plainly why the extra learning
is worth it.

End your response with a short "Bottom line:" line summarizing the recommended
stack in one plain sentence, on top of the detailed reasoning above it.

Keep the explanation clear and light on jargon. Assume the reader is comfortable
directing an AI to write code, but is new to evaluating architecture decisions.

Their answers:
- What they're building: ${WHAT_BUILDING_TEXT[answers.whatBuilding] ?? answers.whatBuilding}
- Expected users at first: ${USER_COUNT_TEXT[answers.userCount] ?? answers.userCount}
- Timeline to a working version: ${TIMELINE_TEXT[answers.timeline] ?? answers.timeline}
- Budget for hosting and tools: ${BUDGET_TEXT[answers.budget] ?? answers.budget}
- Comfort managing servers/infrastructure themselves: ${SERVER_COMFORT_TEXT[answers.serverComfort] ?? answers.serverComfort}
- Existing technical comfort: ${TECH_COMFORT_TEXT[answers.techComfort] ?? answers.techComfort}${projectContextSection}`;
}

// One turn in the back-and-forth with Gemini. Gemini itself has no memory
// between calls — "continuing a conversation" just means resending every
// turn so far, tagged with who said it, on every request.
export interface ConversationMessage {
	role: 'user' | 'model';
	text: string;
}

export interface GeminiExchange {
	text: string; // Gemini's latest reply, for display
	history: ConversationMessage[]; // the full conversation so far, for the next follow-up
}

export async function getStackRecommendation(
	answers: StackAnswers,
	apiKey: string,
	projectContext: string | null
): Promise<GeminiExchange> {
	const history: ConversationMessage[] = [{ role: 'user', text: buildPrompt(answers, projectContext) }];
	const reply = await callGemini(history, apiKey);
	return { text: reply, history: [...history, { role: 'model', text: reply }] };
}

export async function getFollowUpAnswer(
	history: ConversationMessage[],
	question: string,
	apiKey: string
): Promise<GeminiExchange> {
	const updatedHistory: ConversationMessage[] = [...history, { role: 'user', text: question }];
	const reply = await callGemini(updatedHistory, apiKey);
	return { text: reply, history: [...updatedHistory, { role: 'model', text: reply }] };
}

async function callGemini(history: ConversationMessage[], apiKey: string): Promise<string> {
	let response: Response;

	try {
		response = await fetch(API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey
			},
			body: JSON.stringify({
				contents: history.map((message) => ({
					role: message.role,
					parts: [{ text: message.text }]
				}))
			})
		});
	} catch {
		throw new Error('Could not reach Gemini — check your internet connection and try again.');
	}

	if (response.status === 429) {
		throw new Error('Gemini rate limit reached. Wait a bit and try again.');
	}

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`Gemini returned an error (${response.status}): ${detail}`);
	}

	// Gemini's response JSON shape isn't worth a full type for one field read
	const data = await response.json() as any;
	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

	if (!text) {
		throw new Error('Gemini returned an empty response.');
	}

	return text;
}
