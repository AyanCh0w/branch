export type Id<T extends string> = string & { readonly __table?: T };
export type Doc<T extends string> = any;
