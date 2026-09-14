/** BullMQ forbids ':' in custom job ids (it is the Redis key separator). Keep ids to [A-Za-z0-9-]. */
export const emailJobId = (emailLogId: string) => `email-${emailLogId}`;
export const reminderJobId = (reminderId: string) => `reminder-${reminderId}`;
