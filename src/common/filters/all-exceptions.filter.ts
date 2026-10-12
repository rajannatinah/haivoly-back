import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { MulterError } from 'multer';

import {
  codePourMessage,
  ErrorCode,
  messageUtilisateur,
} from '../errors/error-codes';
import type { ChampInvalide } from '../validation/validation-errors';

export interface ApiErrorBody {
  success: false;
  message: string;
  /** Code stable et documenté — c'est lui que le mobile doit interpréter. */
  code: string;
  /** Alias historique de `code`, conservé pour les clients déjà déployés. */
  errorCode: string;
  /** Champs fautifs indexés (erreurs de validation). */
  fields?: ChampInvalide[];
  details?: unknown;
  path: string;
  statusCode: number;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const { status, message, code, details, fields } = this.describe(exception);

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `[${request.requestId ?? '-'}] ${request.method} ${request.path} -> ${status} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${request.requestId ?? '-'}] ${request.method} ${request.path} -> ${status} ${message}`,
      );
    }

    const body: ApiErrorBody = {
      success: false,
      message,
      code,
      errorCode: code,
      ...(fields?.length ? { fields } : {}),
      ...(details ? { details } : {}),
      path: request.path,
      statusCode: status,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    message: string;
    code: string;
    details?: unknown;
    fields?: ChampInvalide[];
  } {
    if (exception instanceof MulterError) {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          message:
            'Image trop volumineuse (5 Mo maximum). Reprenez la photo : elle est compressée automatiquement avant l’envoi.',
          code: ErrorCode.PAYLOAD_TOO_LARGE,
        };
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Envoi de fichier invalide.',
        code: ErrorCode.BAD_REQUEST,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return {
          status,
          message: messageUtilisateur(res, status),
          code: codePourMessage(res, status),
        };
      }

      const payload = res as Record<string, unknown>;
      const rawMessage = payload.message;
      const message = Array.isArray(rawMessage)
        ? 'Certaines informations sont invalides.'
        : typeof rawMessage === 'string'
          ? messageUtilisateur(rawMessage, status)
          : messageUtilisateur(exception.message, status);

      const fields = Array.isArray(payload.fields)
        ? (payload.fields as ChampInvalide[])
        : undefined;

      return {
        status,
        message,
        code:
          (typeof payload.code === 'string' && payload.code) ||
          (typeof payload.errorCode === 'string' && payload.errorCode) ||
          codePourMessage(message, status),
        fields,
        details: Array.isArray(rawMessage) ? { errors: rawMessage } : undefined,
      };
    }

    if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as
        { code?: string } | undefined;
      const code = driverError?.code;

      if (code === '23505') {
        const detail = JSON.stringify(
          (exception.driverError as { detail?: string } | undefined)?.detail ??
            '',
        );
        const surEmail = detail.includes('email');
        return {
          status: HttpStatus.CONFLICT,
          message: surEmail
            ? 'Cette adresse email est déjà utilisée.'
            : 'Cette ressource existe déjà.',
          code: surEmail
            ? ErrorCode.USER_EMAIL_ALREADY_EXISTS
            : ErrorCode.RESOURCE_ALREADY_EXISTS,
        };
      }

      if (code === '23503') {
        return {
          status: HttpStatus.CONFLICT,
          message: 'Opération impossible : ressource liée inexistante',
          code: ErrorCode.RESOURCE_CONFLICT,
        };
      }

      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Erreur de base de données',
        code: ErrorCode.SERVER_ERROR,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Une erreur interne est survenue',
      code: ErrorCode.SERVER_ERROR,
    };
  }
}
