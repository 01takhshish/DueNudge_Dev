import type { Metric, PlanId } from '@duenudge/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const unprocessable = (message: string, code = 'UNPROCESSABLE') =>
  new AppError(422, code, message);

/** Thrown when a server-side plan limit is hit. The web app turns this into an upgrade prompt. */
export class PlanLimitError extends AppError {
  constructor(
    public readonly metric: Metric,
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: PlanId,
  ) {
    super(
      402,
      'PLAN_LIMIT_REACHED',
      `Your ${plan} plan allows ${limit} ${metric.replace('_', ' ')}. Upgrade to continue.`,
    );
    this.name = 'PlanLimitError';
  }
}
