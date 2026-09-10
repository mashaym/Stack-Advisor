// Gathers a small, safe summary of the user's currently open workspace, to
// help tailor the recommendation to what they've already got. Only names,
// counts, and a short README snippet are read — never source code.

import * as vscode from 'vscode';

const MAX_DEPENDENCIES = 20;
const MAX_FILE_TYPES = 8;
const MAX_TOP_LEVEL_ITEMS = 20;
const MAX_README_CHARS = 300;
const MAX_FILES_SCANNED = 500;
const MAX_SUMMARY_LABELS = 4;

// Known package.json dependency names mapped to a friendly display name.
// Only used for the short "Detected: ..." label — never for the prompt.
const FRAMEWORK_LABELS: Record<string, string> = {
	next: 'Next.js',
	react: 'React',
	vue: 'Vue',
	nuxt: 'Nuxt',
	svelte: 'Svelte',
	'@angular/core': 'Angular',
	express: 'Express',
	fastify: 'Fastify',
	electron: 'Electron',
	vite: 'Vite',
	tailwindcss: 'Tailwind CSS',
	typescript: 'TypeScript'
};

// Fallback when no known dependency matched — the top file extension's
// language name, for non-Node projects (Python, etc.) or unrecognized stacks.
const LANGUAGE_LABELS: Record<string, string> = {
	'.ts': 'TypeScript',
	'.tsx': 'TypeScript',
	'.js': 'JavaScript',
	'.jsx': 'JavaScript',
	'.py': 'Python',
	'.rb': 'Ruby',
	'.go': 'Go',
	'.rs': 'Rust',
	'.java': 'Java',
	'.cs': 'C#',
	'.php': 'PHP',
	'.swift': 'Swift',
	'.kt': 'Kotlin',
	'.html': 'HTML',
	'.css': 'CSS'
};

// Returns a formatted context block for the prompt, or null if no workspace
// is open (or nothing useful was found in it) — callers should treat null as
// "just use the form answers," not as an error.
export async function getProjectContext(): Promise<string | null> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return null;
	}

	const root = folders[0].uri;

	const [dependencies, fileTypes, topLevelItems, readmeExcerpt] = await Promise.all([
		readPackageJsonDependencies(root),
		getFileTypeCensus(root),
		getTopLevelItems(root),
		readReadmeExcerpt(root)
	]);

	if (!dependencies && fileTypes.length === 0 && topLevelItems.length === 0 && !readmeExcerpt) {
		return null;
	}

	const lines: string[] = [];
	if (dependencies) {
		lines.push(`- package.json dependencies: ${dependencies}`);
	}
	if (fileTypes.length > 0) {
		lines.push(`- Main file types present: ${fileTypes.join(', ')}`);
	}
	if (topLevelItems.length > 0) {
		lines.push(`- Top-level items: ${topLevelItems.join(', ')}`);
	}
	if (readmeExcerpt) {
		lines.push(`- README excerpt: "${readmeExcerpt}"`);
	}

	return lines.join('\n');
}

// Returns a short, human-readable label for display in the panel (e.g.
// "Next.js, React, TypeScript"), or null if nothing recognizable was found.
// Purely for display — never touches what gets sent to Gemini.
export async function getProjectSummaryLabel(): Promise<string | null> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return null;
	}

	const root = folders[0].uri;

	const [dependencyNames, fileTypes] = await Promise.all([
		getPackageJsonDependencyNames(root),
		getFileTypeCensus(root)
	]);

	const matchedFrameworks = dependencyNames
		.filter((name) => name in FRAMEWORK_LABELS)
		.map((name) => FRAMEWORK_LABELS[name]);

	if (matchedFrameworks.length > 0) {
		return [...new Set(matchedFrameworks)].slice(0, MAX_SUMMARY_LABELS).join(', ');
	}

	// No recognized dependencies (or no package.json) — fall back to the
	// dominant file extensions, e.g. for a Python or plain-HTML project
	const matchedLanguages = fileTypes
		.map((entry) => entry.match(/^\.[^ ]+/)?.[0]) // strip the trailing " (count)"
		.filter((ext): ext is string => !!ext && ext in LANGUAGE_LABELS)
		.map((ext) => LANGUAGE_LABELS[ext]);

	if (matchedLanguages.length > 0) {
		return [...new Set(matchedLanguages)].slice(0, MAX_SUMMARY_LABELS).join(', ');
	}

	return null;
}

async function readPackageJsonDependencies(root: vscode.Uri): Promise<string | null> {
	const names = await getPackageJsonDependencyNames(root);
	return names.length > 0 ? names.join(', ') : null;
}

// Raw dependency names (unjoined) — shared by the prompt context above and
// the short display label below, so package.json is only read once per call.
async function getPackageJsonDependencyNames(root: vscode.Uri): Promise<string[]> {
	try {
		const uri = vscode.Uri.joinPath(root, 'package.json');
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
		return [
			...Object.keys(parsed.dependencies ?? {}),
			...Object.keys(parsed.devDependencies ?? {})
		].slice(0, MAX_DEPENDENCIES);
	} catch {
		return []; // no package.json, or it wasn't valid JSON — just skip it
	}
}

async function getFileTypeCensus(root: vscode.Uri): Promise<string[]> {
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(root, '**/*'),
		'**/{node_modules,.git,dist,out,build,.vscode-test}/**',
		MAX_FILES_SCANNED
	);

	const counts = new Map<string, number>();
	for (const file of files) {
		const match = file.path.match(/\.[^./]+$/);
		if (!match) {
			continue;
		}
		const ext = match[0];
		counts.set(ext, (counts.get(ext) ?? 0) + 1);
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_FILE_TYPES)
		.map(([ext, count]) => `${ext} (${count})`);
}

async function getTopLevelItems(root: vscode.Uri): Promise<string[]> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(root);
		return entries.slice(0, MAX_TOP_LEVEL_ITEMS).map(([name]) => name);
	} catch {
		return [];
	}
}

async function readReadmeExcerpt(root: vscode.Uri): Promise<string | null> {
	for (const filename of ['README.md', 'readme.md']) {
		try {
			const uri = vscode.Uri.joinPath(root, filename);
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(bytes).toString('utf8').trim();
			if (text.length === 0) {
				continue;
			}
			return text.length > MAX_README_CHARS ? text.slice(0, MAX_README_CHARS) + '…' : text;
		} catch {
			continue; // this filename didn't exist — try the next one
		}
	}
	return null;
}
