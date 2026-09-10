// A small, purpose-built Markdown-to-HTML converter — not a general parser.
// It only handles the patterns our prompt actually asks Gemini to produce:
// headings, bold text, simple bullet lists, plain paragraphs, and a
// "Bottom line:" summary line. Anything else renders as a plain paragraph.

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

// Converts **bold** and *italic* within an already-escaped line into
// <strong>/<em> tags. Bold is converted first so its ** pairs are gone
// before the italic pass looks for leftover single asterisks.
function inlineFormat(line: string): string {
	const withBold = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	return withBold.replace(/\*(.+?)\*/g, '<em>$1</em>');
}

export function renderMarkdown(markdown: string): string {
	const lines = escapeHtml(markdown).split('\n');
	const html: string[] = [];
	let inList = false;

	const closeListIfOpen = () => {
		if (inList) {
			html.push('</ul>');
			inList = false;
		}
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();

		if (line.length === 0) {
			closeListIfOpen();
			continue;
		}

		if (line.startsWith('- ') || line.startsWith('* ')) {
			if (!inList) {
				html.push('<ul>');
				inList = true;
			}
			html.push(`<li>${inlineFormat(line.slice(2))}</li>`);
			continue;
		}

		closeListIfOpen();

		if (/^\*{0,2}bottom line/i.test(line)) {
			html.push(`<p class="bottom-line">${inlineFormat(line)}</p>`);
		} else if (line.startsWith('### ')) {
			html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
		} else if (line.startsWith('## ')) {
			html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
		} else {
			html.push(`<p>${inlineFormat(line)}</p>`);
		}
	}

	closeListIfOpen();
	return html.join('\n');
}
