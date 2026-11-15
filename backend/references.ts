const reference = (prefix = ''): any => new Proxy({}, {get: (_target, key) => key === Symbol.toPrimitive ? () => prefix : reference(prefix ? prefix + ':' + String(key) : String(key))});
export const api = reference();
export const internal = api;
export const components = reference('components');
export const makeFunctionReference = (name: string) => name;
