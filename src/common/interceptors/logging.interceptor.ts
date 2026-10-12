import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

type AuthenticatedRequest = Request & {
  requestId?: string;
  user?: { id?: string };
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response.statusCode, startedAt),
        error: (error: { status?: number }) =>
          this.log(request, error?.status ?? 500, startedAt),
      }),
    );
  }

  private log(
    request: AuthenticatedRequest,
    status: number,
    startedAt: number,
  ): void {
    const duration = Date.now() - startedAt;
    const userId = request.user?.id ?? 'anonymous';
    // Ne journalise que le chemin, jamais les paramètres de requête qui peuvent
    // contenir des jetons, adresses e-mail ou autres données sensibles.
    const line = `[${request.requestId ?? '-'}] ${request.method} ${request.path} ${status} ${duration}ms user=${userId}`;

    if (status >= 500) {
      this.logger.error(line);
    } else if (status >= 400) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
