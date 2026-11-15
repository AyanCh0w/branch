export class SessionError extends Error {
 constructor(readonly status: 401 | 503, message: string){super(message);}
}
