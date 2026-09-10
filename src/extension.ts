// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getStackRecommendation } from './geminiClient';
import { renderMarkdown } from './markdown';
import { getProjectContext, getProjectSummaryLabel } from './projectContext';

// The key name SecretStorage stores the API key under (not the API key itself)
const API_KEY_SECRET = 'stackAdvisor.geminiApiKey';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "stack-advisor" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('stack-advisor.openPanel', () => {
		// Create a new editor tab that is actually a sandboxed web page we control
		const panel = vscode.window.createWebviewPanel(
			'stackAdvisor', // internal id VS Code uses to identify this kind of panel
			'Stack Advisor', // title shown on the editor tab
			vscode.ViewColumn.One, // open it in the first editor group
			{ enableScripts: true } // allow the form's JS to run inside the webview
		);

		// Set the HTML content that gets rendered inside the panel
		panel.webview.html = getWebviewContent();

		// Listen for messages sent from the webview's JS via postMessage
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'requestApiKeyStatus') {
				const hasKey = !!(await context.secrets.get(API_KEY_SECRET));
				panel.webview.postMessage({ command: 'apiKeyStatus', hasKey });
				return;
			}

			if (message.command === 'requestProjectSummary') {
				const label = await getProjectSummaryLabel();
				panel.webview.postMessage({ command: 'projectSummary', label });
				return;
			}

			if (message.command === 'openSetApiKey') {
				// Reuses the existing command instead of duplicating its logic
				await vscode.commands.executeCommand('stack-advisor.setApiKey');
				const hasKey = !!(await context.secrets.get(API_KEY_SECRET));
				panel.webview.postMessage({ command: 'apiKeyStatus', hasKey });
				return;
			}

			if (message.command !== 'submitAnswers') {
				return;
			}

			// Show the loading state inside the panel right away
			panel.webview.postMessage({ command: 'showLoading' });

			const apiKey = await context.secrets.get(API_KEY_SECRET);
			if (!apiKey) {
				panel.webview.postMessage({
					command: 'showError',
					text: 'No API key found. Click "Set API Key" above first.'
				});
				return;
			}

			try {
				const projectContext = await getProjectContext();
				const recommendation = await getStackRecommendation(message.answers, apiKey, projectContext);
				panel.webview.postMessage({ command: 'showResult', html: renderMarkdown(recommendation) });
			} catch (err) {
				const friendlyMessage = err instanceof Error ? err.message : 'Something went wrong calling Gemini.';
				panel.webview.postMessage({ command: 'showError', text: friendlyMessage });
			}
		});
	});

	// Prompts for the API key and saves it in SecretStorage (OS-level, encrypted)
	const setApiKey = vscode.commands.registerCommand('stack-advisor.setApiKey', async () => {
		const key = await vscode.window.showInputBox({
			prompt: 'Enter your Gemini API key',
			password: true, // masks the characters as you type
			ignoreFocusOut: true // don't cancel the box if focus moves elsewhere
		});

		if (!key) {
			return; // user pressed Escape or submitted an empty value
		}

		await context.secrets.store(API_KEY_SECRET, key);
		vscode.window.showInformationMessage('API key saved.');
	});

	// Reads the key back from SecretStorage without ever displaying it in full
	const checkApiKey = vscode.commands.registerCommand('stack-advisor.checkApiKey', async () => {
		const key = await context.secrets.get(API_KEY_SECRET);

		if (!key) {
			vscode.window.showInformationMessage('No API key is currently stored.');
			return;
		}

		vscode.window.showInformationMessage(`API key is stored (ends in ...${key.slice(-4)}).`);
	});

	context.subscriptions.push(disposable, setApiKey, checkApiKey);
}

// Returns the HTML (layout + styling + form + inline script) shown in the panel
function getWebviewContent(): string {
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<title>Stack Advisor</title>
		<style>
			body {
				font-family: var(--vscode-font-family, sans-serif);
				color: var(--vscode-foreground);
				padding: 1.25rem 1.5rem 2rem;
				max-width: 640px;
			}

			.app-header { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 1rem; }
			.title-row { display: flex; align-items: center; gap: 0.5rem; }
			.app-icon { font-size: 1.6rem; }
			.title-row h1 { margin: 0; font-size: 1.35rem; }
			.tagline { margin: 0; color: var(--vscode-descriptionForeground); font-size: 0.92rem; }

			.callout {
				background: var(--vscode-textBlockQuote-background);
				border-left: 3px solid var(--vscode-textLink-foreground);
				padding: 0.7rem 0.9rem;
				border-radius: 4px;
				font-size: 0.92rem;
				line-height: 1.5;
			}

			.intro-card { margin-bottom: 1.25rem; }

			.project-summary-line {
				color: var(--vscode-descriptionForeground);
				font-size: 0.85rem;
				margin: 0 0 1rem;
			}

			.api-key-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.75rem;
				padding: 0.55rem 0.85rem;
				background: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-widget-border);
				border-radius: 4px;
				margin-bottom: 1.5rem;
				font-size: 0.88rem;
			}
			.key-status { font-weight: 500; }
			.key-status.set { color: var(--vscode-terminal-ansiGreen, #4caf50); }
			.key-status.not-set { color: var(--vscode-errorForeground); }

			button {
				font-family: inherit;
				cursor: pointer;
				border-radius: 4px;
				border: none;
				padding: 0.45rem 0.9rem;
				font-size: 0.88rem;
			}
			.primary-button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-top: 0.5rem; }
			.primary-button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
			.primary-button:disabled { opacity: 0.6; cursor: default; }
			.secondary-button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); white-space: nowrap; }
			.secondary-button:hover { background: var(--vscode-button-secondaryHoverBackground); }

			.question-form { display: flex; flex-direction: column; gap: 1rem; }
			.question { display: flex; flex-direction: column; gap: 0.3rem; }
			.question label { font-weight: 500; font-size: 0.92rem; }
			.question select {
				padding: 0.4rem 0.5rem;
				background: var(--vscode-dropdown-background);
				color: var(--vscode-dropdown-foreground);
				border: 1px solid var(--vscode-dropdown-border);
				border-radius: 4px;
				font-family: inherit;
				font-size: 0.9rem;
				max-width: 320px;
			}

			#result { margin-top: 1.75rem; }
			#result h2 { font-size: 1.15rem; margin: 1.1rem 0 0.4rem; }
			#result h3 { font-size: 1.02rem; margin: 0.9rem 0 0.3rem; }
			#result p { margin: 0.5rem 0; line-height: 1.55; }
			#result ul { margin: 0.4rem 0 0.8rem; padding-left: 1.4rem; }
			#result li { margin: 0.25rem 0; }
			#result .status { font-style: italic; color: var(--vscode-descriptionForeground); }
			#result .error { color: var(--vscode-errorForeground); font-weight: 600; }
			#result .bottom-line {
				font-weight: 600;
				margin-top: 1.25rem;
				padding: 0.6rem 0.85rem;
				background: var(--vscode-textBlockQuote-background);
				border-left: 3px solid var(--vscode-textLink-foreground);
				border-radius: 4px;
			}
		</style>
	</head>
	<body>
		<div class="app-header">
			<div class="title-row">
				<span class="app-icon">🧭</span>
				<h1>Stack Advisor</h1>
			</div>
			<p class="tagline">Pick a tech stack you actually understand — not just one you were told to use.</p>
		</div>

		<div class="callout intro-card">
			Answer a few quick questions below and Stack Advisor will recommend a tech stack
			using <strong>your own Gemini API key</strong> — with the reasoning and trade-offs
			explained, so you learn enough to push back on it.
		</div>

		<p id="projectSummary" class="project-summary-line">📁 Checking your project…</p>

		<div class="api-key-row">
			<span id="apiKeyStatus" class="key-status">Checking API key…</span>
			<button id="setApiKeyButton" class="secondary-button">Set API Key</button>
		</div>

		<div class="question-form">
			<div class="question">
				<label for="whatBuilding">What are you building?</label>
				<select id="whatBuilding">
					<option value="web">Web app</option>
					<option value="mobile">Mobile app</option>
					<option value="extension-or-api">Browser extension or API-only backend</option>
					<option value="unsure">Not sure yet</option>
				</select>
			</div>

			<div class="question">
				<label for="userCount">Roughly how many users do you expect at first?</label>
				<select id="userCount">
					<option value="handful">A handful</option>
					<option value="hundreds">Hundreds</option>
					<option value="thousands">Thousands+</option>
				</select>
			</div>

			<div class="question">
				<label for="timeline">How soon do you want a working version?</label>
				<select id="timeline">
					<option value="days">Days</option>
					<option value="weeks">Weeks</option>
					<option value="months">Months</option>
				</select>
			</div>

			<div class="question">
				<label for="budget">What's your budget for hosting and tools?</label>
				<select id="budget">
					<option value="free">Free-tier only</option>
					<option value="small">A little</option>
					<option value="none">No real constraint</option>
				</select>
			</div>

			<div class="question">
				<label for="serverComfort">How comfortable are you managing servers/infrastructure yourself?</label>
				<select id="serverComfort">
					<option value="avoid">Avoid it entirely</option>
					<option value="some">Somewhat comfortable</option>
					<option value="very">Very comfortable</option>
				</select>
			</div>

			<div class="question">
				<label for="techComfort">What are you already comfortable with?</label>
				<select id="techComfort">
					<option value="js">Mostly JavaScript / web technologies</option>
					<option value="python">Mostly Python</option>
					<option value="several">A little of several languages</option>
					<option value="new">I'm new to coding — I rely on AI</option>
					<option value="other">Other / prefer not to say</option>
				</select>
			</div>

			<button id="submit" class="primary-button">Get My Recommendation</button>
		</div>

		<div id="result"></div>

		<script>
			// acquireVsCodeApi() gives this page the one and only object it can use
			// to send messages back to the extension
			const vscodeApi = acquireVsCodeApi();
			const submitButton = document.getElementById('submit');
			const resultDiv = document.getElementById('result');
			const apiKeyStatusEl = document.getElementById('apiKeyStatus');
			const setApiKeyButton = document.getElementById('setApiKeyButton');
			const projectSummaryEl = document.getElementById('projectSummary');

			// Ask the extension whether a key is already stored, as soon as we load
			vscodeApi.postMessage({ command: 'requestApiKeyStatus' });

			// Ask the extension what it detected about the open workspace, if any
			vscodeApi.postMessage({ command: 'requestProjectSummary' });

			setApiKeyButton.addEventListener('click', () => {
				vscodeApi.postMessage({ command: 'openSetApiKey' });
			});

			submitButton.addEventListener('click', () => {
				// Disable immediately so a second click can't send a second
				// message while the first request is still in flight
				submitButton.disabled = true;

				const answers = {
					whatBuilding: document.getElementById('whatBuilding').value,
					userCount: document.getElementById('userCount').value,
					timeline: document.getElementById('timeline').value,
					budget: document.getElementById('budget').value,
					serverComfort: document.getElementById('serverComfort').value,
					techComfort: document.getElementById('techComfort').value
				};
				vscodeApi.postMessage({ command: 'submitAnswers', answers });
			});

			// React to status updates the extension sends back
			window.addEventListener('message', (event) => {
				const message = event.data;

				if (message.command === 'apiKeyStatus') {
					apiKeyStatusEl.textContent = message.hasKey ? 'API key: set ✓' : 'API key: not set';
					apiKeyStatusEl.className = 'key-status ' + (message.hasKey ? 'set' : 'not-set');
				} else if (message.command === 'projectSummary') {
					projectSummaryEl.textContent = message.label
						? '📁 Detected: ' + message.label
						: '📁 No project detected — recommendations will be based on your answers only.';
				} else if (message.command === 'showLoading') {
					resultDiv.innerHTML = '<p class="status">Thinking…</p>';
				} else if (message.command === 'showResult') {
					resultDiv.innerHTML = message.html;
					submitButton.disabled = false;
				} else if (message.command === 'showError') {
					resultDiv.innerHTML = '';
					const errorParagraph = document.createElement('p');
					errorParagraph.className = 'error';
					errorParagraph.textContent = message.text; // textContent auto-escapes, safe for untrusted text
					resultDiv.appendChild(errorParagraph);
					submitButton.disabled = false;
				}
			});
		</script>
	</body>
	</html>`;
}

// This method is called when your extension is deactivated
export function deactivate() {}
