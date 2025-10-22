namespace ch {
    export const magenta = (str: string | number) => `\x1b[35m${str}\x1b[0m`;
    export const red = (str: string | number) => `\x1b[31m${str}\x1b[0m`;
    export const blue = (str: string | number) => `\x1b[34m${str}\x1b[0m`;
    export const green = (str: string | number) => `\x1b[32m${str}\x1b[0m`;
    export const yellow = (str: string | number) => `\x1b[33m${str}\x1b[0m`;
    export const cyan = (str: string | number) => `\x1b[36m${str}\x1b[0m`;
}

export default ch;
