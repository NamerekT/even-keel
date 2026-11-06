/**
 * Tags that carry Markdown meaning. Clipboard HTML with one of them (Huly, GitHub, Word, a web page) is converted; HTML that
 * only colours text, as a code editor's copy, is pasted as its plain text, which is the Markdown itself.
 */
const MEANING = /<(p|h[1-6]|ul|ol|li|strong|b|em|i|a|table|pre|code|blockquote|del|s|strike)[\s>/]/i

export const meaningfulHtml = (html: string): boolean => MEANING.test(html)

/** The clipboard holds a picture: a file of one, or one inside its HTML. Pictures go into a task with attachments, later. */
export const pastedPicture = (fileTypes: readonly string[], html: string): boolean =>
  fileTypes.some((type) => type.startsWith('image/')) || /<img[\s>/]/i.test(html)
