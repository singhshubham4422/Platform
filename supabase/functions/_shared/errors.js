export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const badRequest=(message='Invalid request')=>new HttpError(400,'BAD_REQUEST',message);
export const unauthorized=(message='Authentication required')=>new HttpError(401,'UNAUTHORIZED',message);
export const forbidden=(message='Not authorized')=>new HttpError(403,'FORBIDDEN',message);
export const notFound=(message='Not found')=>new HttpError(404,'NOT_FOUND',message);
export const conflict=(code='CONFLICT',message='Request conflicts with existing state')=>new HttpError(409,code,message);
export const tooLarge=(message='Request body is too large')=>new HttpError(413,'PAYLOAD_TOO_LARGE',message);
export const unavailable=(code='SERVICE_UNAVAILABLE',message='Service is unavailable')=>new HttpError(503,code,message);
export const notImplemented=(code,message)=>new HttpError(501,code,message);
