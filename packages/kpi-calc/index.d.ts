export interface ActivityEvent {eventId?:string;seq:number;eventType:string;clientTs:string;userId:string;organizationId?:string|null;deviceId?:string;packId?:string;questionId?:string|null;assessmentId?:string|null;attemptId?:string|null;language?:string;schemaVersion?:number;metadata?:Record<string,unknown>}
export function roundHalfAway(value:number,places?:number):number;
export function normaliseEvents(events:ActivityEvent[]):ActivityEvent[];
export function computeStudentDaily(events:ActivityEvent[],options?:{computedAt?:string}):Record<string,unknown>[];
export function computeStudentTopic(events:ActivityEvent[],questionMeta:Map<string,{topics:string[];points:number}>,options?:{computedAt?:string}):{rows:Record<string,unknown>[];skippedQuestions:number};
export function computeAssessment(events:ActivityEvent[],assessments:Map<string,{organizationId:string;questionIds:string[]}>,questionMeta:Map<string,{topics:string[];points:number}>,options?:{computedAt?:string}):Record<string,unknown>[];
