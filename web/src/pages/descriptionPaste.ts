/**
 * Tags that carry Markdown meaning. Clipboard HTML with one of them (Huly, GitHub, Word, a web page) is converted; HTML that
 * only colours text, as a code editor's copy, is pasted as its plain text, which is the Markdown itself.
 */
const MEANING = /<(p|h[1-6]|ul|ol|li|strong|b|em|i|a|table|pre|code|blockquote|del|s|strike)[\s>/]/i

export const meaningfulHtml = (html: string): boolean => MEANING.test(html)
