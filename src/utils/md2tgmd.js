/* eslint-disable no-useless-escape*/
const escapeChars = /([\_\*\[\]\(\)\\\~\`\>\#\+\-\=\|\{\}\.\!])/g;

/**
 * 分割代码块文本 适配嵌套代码块
 * @param {string} text
 * @returns {string} text
 */
export function escape(text) {
    const lines = text.split('\n');
    const stack = [];
    const result = [];
    let linetrim = '';
    for (const [i, line] of lines.entries()) {
        linetrim = line.trim();
        let startIndex;
        if (/^```.+/.test(linetrim)) {
            stack.push(i);
        } else if (linetrim === '```') {
            if (stack.length) {
                startIndex = stack.pop();
                if (!stack.length) {
                    const content = lines.slice(startIndex, i + 1).join('\n');
                    result.push(handleEscape(content, 'code'));
                    continue;
                }
            } else {
                stack.push(i);
            }
        }

        if (!stack.length) {
            result.push(handleEscape(line));
        }
    }
    if (stack.length) {
        const last = `${lines.slice(stack[0]).join('\n')}\n\`\`\``;
        result.push(handleEscape(last, 'code'));
    }
    return result.join('\n');
}

/**
 * 处理转义
 * @param {string} text
 * @param {string} type
 * @returns {string} text
 */
function handleEscape(text, type = 'text') {
    if (!text.trim()) {
        return text;
    }
    if (type === 'text') {
        // 直接对整个字符串全部replace可能存在的范围重叠问题 待优化
        text = text
            .replace(escapeChars, '\\$1')
            // force all characters that need to be escaped to be escaped once.
            .replace(/([^\\]|)\\`([^\s].*?[^\\]|[^\\]|(\\\\)*)\\`/g, '$1`$2`') // inline code
            .replace(/([^\\]|)\\\*\\\*([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\\*\\\*/g, '$1*$2*') // bold
            .replace(/([^\\]|)\\_\\_([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\_\\_/g, '$1__$2__') // underline
            .replace(/([^\\]|)\\_([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\_/g, '$1_$2_') // italic
            .replace(/([^\\]|)\\~\\~([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\~\\~/g, '$1~$2~') // strikethrough
            .replace(/([^\\]|)\\\|\\\|([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\\|\\\|/g, '$1||$2||') // spoiler
            .replace(/\\\[([^\]]+?)\\\]\\\((.+?)\\\)/g, '[$1]($2)') // url
            .replace(/\\\\\\([_*[]\(\)\\~`>#\+-=\|\{\}\.!])/g, '\\$1') // restore duplicate escapes
            .replace(/^(\s*)\\(>.+\s*)$/, '$1$2') // >
            .replace(/^(\s*)\\-\s*(.+)$/, '$1• $2') // -
            .replace(/^((\\#){1,3}\s)(.+)/, '$1*$3*'); // number sign
    } else {
        const codeBlank = text.length - text.trimStart().length;
        if (codeBlank > 0) {
            const blankReg = new RegExp(`^\\s{${codeBlank}}`, 'gm');
            text = text.replace(blankReg, '');
        }
        text = text
            .trimEnd()
            .replace(/([\\`])/g, '\\$1')
            .replace(/^\\`\\`\\`([\s\S]+)\\`\\`\\`$/g, '```$1```'); // code block
    }
    return text;
}
