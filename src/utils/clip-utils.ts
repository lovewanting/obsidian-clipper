import Defuddle from 'defuddle/full';
import { setElementHTML } from './dom-utils';
import { preprocessCarousels } from './carousel-utils';
import { preprocessWechatMath, WechatMathFormulaMap } from './wechat-math-utils';

export interface ParseForClipResult {
	defuddle: ReturnType<InstanceType<typeof Defuddle>['parse']>;
	wechatMathFormulas: WechatMathFormulaMap;
}

// Parse document content for clipping. In reader mode, extracts from
// the article's original HTML to avoid reader UI artifacts.
export function parseForClip(doc: Document): ParseForClipResult {
	const readerArticle = doc.querySelector('.obsidian-reader-active .obsidian-reader-content article');
	if (readerArticle) {
		const readerDoc = doc.implementation.createHTMLDocument();
		const originalHtml = readerArticle.getAttribute('data-original-html');
		if (originalHtml) {
			setElementHTML(readerDoc.body, originalHtml);
		} else {
			readerDoc.body.replaceChildren(
				...Array.from(readerArticle.childNodes).map(n => readerDoc.importNode(n, true))
			);
		}
		preprocessCarousels(readerDoc);
		let wechatMathFormulas = preprocessWechatMath(readerDoc);

		// If preprocessWechatMath returned empty (DOM already preprocessed),
		// try to load the formula map stored on the article element by Reader.
		if (Object.keys(wechatMathFormulas).length === 0) {
			const stored = readerArticle.getAttribute('data-wechat-math');
			if (stored) {
				try {
					wechatMathFormulas = JSON.parse(stored);
				} catch { /* ignore parse errors */ }
			}
		}

		return {
			defuddle: new Defuddle(readerDoc, { url: '' }).parse(),
			wechatMathFormulas,
		};
	}
	preprocessCarousels(doc);
	const wechatMathFormulas = preprocessWechatMath(doc);
	return {
		defuddle: new Defuddle(doc, { url: doc.URL }).parse(),
		wechatMathFormulas,
	};
}
