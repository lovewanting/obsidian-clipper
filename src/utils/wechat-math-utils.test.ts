// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { preprocessWechatMath } from './wechat-math-utils';

/**
 * Build a minimal WeChat-style math SVG span.
 * WeChat renders formulas as server-side MathJax SVG output with:
 * - data-math-raw: LaTeX source on the parent <span>
 * - data-math-display: "true" for block, "false" for inline
 * - data-mml-node: MathML node names on SVG <g> children
 */
function buildWeChatMathSpan(latex: string, isBlock = false) {
	return `
		<span data-math-raw="${latex}" data-math-display="${isBlock}">
			<svg xmlns="http://www.w3.org/2000/svg" height="2.736ex" role="img"
				viewBox="0 -864.2 2999.2 1209.2" aria-hidden="true"
				style="vertical-align: -0.781ex; display: initial; width: 6.785ex;"
				aria-label="插图">
				<g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)">
					<g data-mml-node="math">
						<g data-mml-node="mi"><path data-c="78" d="M52 0..."></path></g>
						<g data-mml-node="mo" transform="translate(1000,0)"><path data-c="3D" d="M56 0..."></path></g>
						<g data-mml-node="mn" transform="translate(2000,0)"><path data-c="31" d="M56 0..."></path></g>
					</g>
				</g>
			</svg>
		</span>
	`;
}

function buildWeChatFracSpan(latex: string, isBlock = false) {
	return `
		<span data-math-raw="${latex}" data-math-display="${isBlock}">
			<svg xmlns="http://www.w3.org/2000/svg" height="3.5ex" role="img"
				viewBox="0 -1000 2000 2000" aria-hidden="true"
				style="vertical-align: -1ex; display: initial; width: 4ex;">
				<g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)">
					<g data-mml-node="math">
						<g data-mml-node="mfrac">
							<g data-mml-node="mn"><path data-c="31"></path></g>
							<g data-mml-node="mn" transform="translate(0,-500)"><path data-c="32"></path></g>
						</g>
					</g>
				</g>
			</svg>
		</span>
	`;
}

describe('preprocessWechatMath', () => {
	test('converts inline WeChat math SVG to <math> element', () => {
		document.body.innerHTML = `
			<p>Some text ${buildWeChatMathSpan('$x=1$', false)} more text</p>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		expect(mathEl?.getAttribute('display')).toBe('inline');
		expect(mathEl?.getAttribute('data-latex')).toBe('$x=1$');
		// Original span should be gone
		expect(document.querySelector('span[data-math-raw]')).toBeNull();
	});

	test('converts block WeChat math SVG to <math> element with display=block', () => {
		document.body.innerHTML = `
			<p>${buildWeChatMathSpan('$$E=mc^2$$', true)}</p>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		expect(mathEl?.getAttribute('display')).toBe('block');
		expect(mathEl?.getAttribute('data-latex')).toBe('$$E=mc^2$$');
	});

	test('reconstructs MathML structure from data-mml-node attributes', () => {
		document.body.innerHTML = `
			<p>${buildWeChatMathSpan('$x=1$', false)}</p>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		// Should have mi, mo, mn children from the data-mml-node reconstruction
		expect(mathEl?.querySelector('mi')).not.toBeNull();
		expect(mathEl?.querySelector('mo')).not.toBeNull();
		expect(mathEl?.querySelector('mn')).not.toBeNull();
	});

	test('handles mfrac (fraction) structure', () => {
		document.body.innerHTML = `
			<p>${buildWeChatFracSpan('$\\frac{1}{2}$', false)}</p>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		expect(mathEl?.querySelector('mfrac')).not.toBeNull();
	});

	test('converts multiple math formulas in one document', () => {
		document.body.innerHTML = `
			<p>First: ${buildWeChatMathSpan('$a=1$', false)}</p>
			<p>Second: ${buildWeChatMathSpan('$b=2$', false)}</p>
			<p>${buildWeChatMathSpan('$$c=3$$', true)}</p>
		`;

		preprocessWechatMath(document);

		const mathEls = document.querySelectorAll('math');
		expect(mathEls.length).toBe(3);
		expect(mathEls[0].getAttribute('data-latex')).toBe('$a=1$');
		expect(mathEls[1].getAttribute('data-latex')).toBe('$b=2$');
		expect(mathEls[2].getAttribute('data-latex')).toBe('$$c=3$$');
	});

	test('does nothing when no WeChat math elements are present', () => {
		document.body.innerHTML = `
			<p>Normal article text with no math formulas.</p>
			<svg width="16" height="16"><path d="M0 0"/></svg>
		`;

		preprocessWechatMath(document);

		// The non-math SVG should remain untouched
		expect(document.querySelector('svg')).not.toBeNull();
		expect(document.querySelector('math')).toBeNull();
	});

	test('converts block-level <section data-math-raw> to <math display="block">', () => {
		document.body.innerHTML = `
			<section data-math-raw="$$E=mc^2$$" data-math-display="true">
				<svg xmlns="http://www.w3.org/2000/svg" height="3.5ex" role="img"
					viewBox="0 -1000 3000 2000" aria-hidden="true">
					<g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)">
						<g data-mml-node="math">
							<g data-mml-node="mi"><path data-c="45"></path></g>
							<g data-mml-node="mo"><path data-c="3D"></path></g>
							<g data-mml-node="mi"><path data-c="6D"></path></g>
						</g>
					</g>
				</svg>
			</section>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		expect(mathEl?.getAttribute('display')).toBe('block');
		expect(mathEl?.getAttribute('data-latex')).toBe('$$E=mc^2$$');
		// Original section should be gone
		expect(document.querySelector('section[data-math-raw]')).toBeNull();
	});

	test('handles mixed inline <span> and block <section> formulas', () => {
		document.body.innerHTML = `
			<p>Inline: ${buildWeChatMathSpan('$x=1$', false)}</p>
			<section data-math-raw="$$y=2$$" data-math-display="true">
				<svg xmlns="http://www.w3.org/2000/svg" height="3ex">
					<g><g data-mml-node="math">
						<g data-mml-node="mi"><path></path></g>
					</g></g>
				</svg>
			</section>
		`;

		preprocessWechatMath(document);

		const mathEls = document.querySelectorAll('math');
		expect(mathEls.length).toBe(2);
		expect(mathEls[0].getAttribute('display')).toBe('inline');
		expect(mathEls[1].getAttribute('display')).toBe('block');
	});

	test('falls back to LaTeX annotation when SVG has no data-mml-node', () => {
		document.body.innerHTML = `
			<span data-math-raw="$\\alpha + \\beta$" data-math-display="false">
				<svg xmlns="http://www.w3.org/2000/svg" height="2ex">
					<g><path d="M0 0"/></g>
				</svg>
			</span>
		`;

		preprocessWechatMath(document);

		const mathEl = document.querySelector('math');
		expect(mathEl).not.toBeNull();
		expect(mathEl?.getAttribute('data-latex')).toBe('$\\alpha + \\beta$');
		// Should have annotation fallback
		const annotation = mathEl?.querySelector('annotation[encoding="application/x-tex"]');
		expect(annotation).not.toBeNull();
		expect(annotation?.textContent).toBe('$\\alpha + \\beta$');
	});
});
