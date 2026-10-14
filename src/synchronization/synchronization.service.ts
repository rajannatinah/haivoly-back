import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Action } from '../actions/entities/action.entity';
import { CreateActionDto } from '../actions/dto/create-action.dto';
import { SyncDto } from '../actions/dto/batch-sync.dto';
import { SyncStatus } from '../common/enums/domain.enums';
import { ParcellesService } from '../parcelles/parcelles.service';
import { CulturesService } from '../cultures/cultures.service';
import { InterventionsService } from '../interventions/interventions.service';
import { ObservationsService } from '../observations/observations.service';
import { RecoltesService } from '../recoltes/recoltes.service';
import { ActionsService } from '../actions/actions.service';
import { CreateParcelleDto } from '../parcelles/dto/creation-parcelle.dto';
import { CreateCultureDto } from '../cultures/dto/creation-culture.dto';
import { CreateInterventionDto } from '../interventions/dto/intervention.dto';
import { CreateObservationDto } from '../observations/dto/observation.dto';
import { CreateRecolteDto } from '../recoltes/dto/recolte.dto';
import { parseDate } from '../common/utils/date.util';

export type SyncActionStatus =
  'SYNCED' | 'DUPLICATE' | 'FAILED' | 'INVALID' | 'CONFLICT';

export interface SyncActionResult {
  /** Identifiant renvoyé au mobile (clientId de l'action). */
  id: string;
  clientId: string;
  status: SyncActionStatus;
  entityType: string;
  actionType: string;
  /** Identifiant serveur définitif de l'entité créée/modifiée. */
  entityId?: string;
  message?: string;
  data?: unknown;
}

export interface SyncResponse {
  results: SyncActionResult[];
  syncedAt: string;
  summary: {
    total: number;
    synced: number;
    duplicates: number;
    failed: number;
  };
  /** Changements serveur depuis `lastSync` (pull). */
  changes: Record<string, unknown[]>;
}

@Injectable()
export class SynchronizationService {
  private readonly logger = new Logger(SynchronizationService.name);

  constructor(
    @InjectRepository(Action)
    private readonly actions: Repository<Action>,
    private readonly parcelles: ParcellesService,
    private readonly cultures: CulturesService,
    private readonly interventions: InterventionsService,
    private readonly observations: ObservationsService,
    private readonly recoltes: RecoltesService,
    private readonly actionsService: ActionsService,
  ) {}

  async synchronize(userId: string, dto: SyncDto): Promise<SyncResponse> {
    const results: SyncActionResult[] = [];
    const identifiantsLocaux = new Map<string, string>();

    for (const action of dto.actions ?? []) {
      const resolue = this.resoudreReferencesLocales(action, identifiantsLocaux);
      const resultat = await this.applyAction(userId, resolue, dto.deviceId);
      results.push(resultat);

      if (
        action.actionType === 'CREATE' &&
        action.entityId &&
        resultat.entityId &&
        (resultat.status === 'SYNCED' || resultat.status === 'DUPLICATE')
      ) {
        identifiantsLocaux.set(action.entityId, resultat.entityId);
      }
    }

    const synced = results.filter((r) => r.status === 'SYNCED').length;
    const duplicates = results.filter((r) => r.status === 'DUPLICATE').length;
    const failed = results.filter(
      (r) =>
        r.status === 'FAILED' ||
        r.status === 'INVALID' ||
        r.status === 'CONFLICT',
    ).length;

    return {
      results,
      syncedAt: new Date().toISOString(),
      summary: { total: results.length, synced, duplicates, failed },
      changes: await this.pullChanges(userId, dto.lastSync),
    };
  }

  private resoudreReferencesLocales(
    action: CreateActionDto,
    identifiants: Map<string, string>,
  ): CreateActionDto {
    const resoudre = (value: string | undefined): string | undefined =>
      value ? identifiants.get(value) ?? value : value;
    const payload = action.payload ? { ...action.payload } : undefined;

    if (payload) {
      for (const key of ['id', 'entityId', 'parcelleId', 'parcelle_id', 'cultureId']) {
        const value = payload[key];
        if (typeof value === 'string') payload[key] = resoudre(value);
      }
    }

    return {
      ...action,
      entityId: resoudre(action.entityId),
      ...(payload ? { payload } : {}),
    };
  }

  private async applyAction(
    userId: string,
    action: CreateActionDto,
    deviceId?: string,
  ): Promise<SyncActionResult> {
    const clientId = action.clientId ?? `anon-${Date.now()}`;

    const base = {
      id: clientId,
      clientId,
      entityType: action.entityType,
      actionType: action.actionType,
    };

    const existing = await this.actions.findOne({ where: { clientId, userId } });

    if (existing && existing.syncStatus === String(SyncStatus.SYNCED)) {
      return {
        ...base,
        status: 'DUPLICATE',
        entityId: existing.entityId ?? action.entityId,
        message: 'Action déjà synchronisée',
      };
    }

    if (existing && existing.syncStatus === String(SyncStatus.SYNCING)) {
      return {
        ...base,
        status: 'DUPLICATE',
        message: 'Action en cours de traitement',
      };
    }

    // ── 2. Réservation de la clé d'idempotence ──
    let journalEntry: Action;

    if (existing) {
      existing.syncStatus = SyncStatus.SYNCING;
      existing.retryCount += 1;
      journalEntry = await this.actions.save(existing);
    } else {
      try {
        journalEntry = await this.actions.save(
          this.actions.create({
            clientId,
            userId,
            actionType: action.actionType,
            entityType: action.entityType,
            entityId: action.entityId ?? null,
            payload: action.payload ?? null,
            metadata: action.metadata ?? null,
            deviceId: deviceId ?? action.deviceId ?? null,
            timestamp: parseDate(action.timestamp) ?? new Date(),
            syncStatus: SyncStatus.SYNCING,
            retryCount: 0,
          }),
        );
      } catch (error) {
        const erreur = error as {
          code?: unknown;
          driverError?: { code?: unknown };
        };
        const code = erreur.driverError?.code ?? erreur.code;
        if (code !== '23505') throw error;

        // Une requête concurrente peut avoir réservé cette clé entre la
        // lecture et l'insertion; ne renvoyer que la ligne du même utilisateur.
        const concurrente = await this.actions.findOne({
          where: { clientId, userId },
        });
        if (!concurrente) throw error;
        return {
          ...base,
          status: 'DUPLICATE',
          entityId: concurrente.entityId ?? undefined,
          message: 'Action déjà enregistrée',
        };
      }
    }

    // ── 3. Exécution métier ──
    try {
      const outcome = await this.dispatch(userId, action);

      journalEntry.syncStatus = SyncStatus.SYNCED;
      journalEntry.syncedAt = new Date();
      if (outcome.entityId) {
        journalEntry.entityId = outcome.entityId;
      }
      journalEntry.metadata = {
        ...(journalEntry.metadata ?? {}),
        result: outcome.summary ?? null,
      };
      await this.actions.save(journalEntry);

      // Recommandations automatiques (règles métier existantes conservées)
      void this.actionsService
        .triggerRecommendationRules({
          userId,
          actionType: `${action.actionType}_${action.entityType}`,
          payload: action.payload ?? null,
          entityType: action.entityType,
        })
        .catch((error) =>
          this.logger.warn(
            `Règles de recommandation en échec: ${String(error)}`,
          ),
        );

      // Notifie le propriétaire rattaché pour chaque action terrain.
      void this.actionsService
        .notifierActionProprietaire({
          acteurId: userId,
          actionType: action.actionType,
          entityType: action.entityType,
          entityId: outcome.entityId ?? action.entityId ?? null,
        })
        .catch((error) =>
          this.logger.warn(
            `Notification propriétaire en échec: ${String(error)}`,
          ),
        );

      return {
        ...base,
        status: 'SYNCED',
        entityId: outcome.entityId,
        data: outcome.data ?? null,
      };
    } catch (error) {
      const message = this.describeError(error);
      const httpStatus = error instanceof HttpException ? error.getStatus() : 0;
      const status: SyncActionStatus =
        httpStatus === 409
          ? 'CONFLICT'
          : [400, 401, 403, 404, 413, 415, 422].includes(httpStatus)
            ? 'INVALID'
            : 'FAILED';

      journalEntry.syncStatus =
        status === 'CONFLICT' ? 'CONFLICT' :
          status === 'INVALID' ? 'INVALID' : SyncStatus.FAILED;
      journalEntry.metadata = {
        ...(journalEntry.metadata ?? {}),
        error: message,
      };
      await this.actions.save(journalEntry);

      this.logger.warn(
        `[sync] ${status.toLowerCase()} ${action.actionType} ${action.entityType} (${clientId})`,
      );

      return { ...base, status, message };
    }
  }

  private async dispatch(
    userId: string,
    action: CreateActionDto,
  ): Promise<{ entityId?: string; data?: unknown; summary?: string }> {
    const payload = action.payload ?? {};
    const targetId = this.readString(payload.id) ?? action.entityId;

    switch (action.entityType) {
      case 'PARCELLE':
        return this.applyParcelle(userId, action.actionType, targetId, payload);

      case 'CULTURE':
        return this.applyCulture(userId, action.actionType, targetId, payload);

      case 'INTERVENTION':
        return this.applyIntervention(
          userId,
          action.actionType,
          targetId,
          payload,
        );

      case 'OBSERVATION':
        return this.applyObservation(
          userId,
          action.actionType,
          targetId,
          payload,
        );

      case 'RECOLTE':
        return this.applyRecolte(userId, action.actionType, targetId, payload);

      case 'POINT_GPS':
        return this.applyPointGps(userId, payload);

      default:
        throw new Error(
          `Type d'entité non pris en charge : ${action.entityType}`,
        );
    }
  }

  private async applyParcelle(
    userId: string,
    actionType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    if (actionType === 'CREATE') {
      const parcelle = await this.parcelles.create(
        this.toParcelleDto(payload, targetId),
        userId,
      );
      return { entityId: parcelle?.id, data: parcelle };
    }

    if (!targetId) {
      throw new Error('entityId obligatoire pour modifier une parcelle');
    }

    if (actionType === 'UPDATE') {
      const parcelle = await this.parcelles.update(
        targetId,
        this.toParcelleDto(payload),
        userId,
      );
      return { entityId: parcelle?.id, data: parcelle };
    }

    if (actionType === 'DELETE') {
      const raison =
        this.readString(payload.raison) ?? 'Suppression depuis le mobile';
      const parcelle = await this.parcelles.remove(targetId, raison, userId);
      return { entityId: parcelle?.id, data: parcelle };
    }

    throw new Error(`Action non supportée : ${actionType}`);
  }

  private async applyCulture(
    userId: string,
    actionType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const parcelleId =
      this.readString(payload.parcelleId) ??
      this.readString(payload.parcelle_id);

    if (actionType === 'CREATE') {
      if (!parcelleId) {
        throw new Error('parcelleId obligatoire pour créer une culture');
      }

      const culture = await this.cultures.create(
        parcelleId,
        this.toCultureDto(payload),
        userId,
      );
      return { entityId: culture?.id, data: culture };
    }

    if (!targetId) {
      throw new Error('entityId obligatoire pour cette action culture');
    }

    // Le service a besoin de la parcelle parente pour vérifier l'ownership.
    const resolvedParcelleId =
      parcelleId ??
      (await this.cultures.requireOwnership(targetId, userId)).parcelleId;

    if (actionType === 'UPDATE') {
      const culture = await this.cultures.update(
        resolvedParcelleId,
        targetId,
        this.toCultureDto(payload),
        userId,
      );
      return { entityId: culture?.id, data: culture };
    }

    if (actionType === 'DELETE') {
      const culture = await this.cultures.remove(
        resolvedParcelleId,
        targetId,
        userId,
        this.readString(payload.raison),
      );
      return { entityId: culture?.id, data: culture };
    }

    throw new Error(`Action non supportée : ${actionType}`);
  }

  private async applyIntervention(
    userId: string,
    actionType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const cultureId = this.readString(payload.cultureId);

    if (actionType === 'CREATE') {
      if (!cultureId) {
        throw new Error('cultureId obligatoire pour créer une intervention');
      }

      const intervention = await this.interventions.create(
        cultureId,
        this.toInterventionDto(payload),
        userId,
      );
      return { entityId: intervention?.id, data: intervention };
    }

    if (!targetId) {
      throw new Error('entityId obligatoire pour cette action intervention');
    }

    const resolvedCultureId =
      cultureId ?? (await this.interventions.findOneRaw(targetId))?.cultureId;

    if (!resolvedCultureId) {
      throw new Error('Intervention introuvable');
    }

    if (actionType === 'UPDATE') {
      const intervention = await this.interventions.update(
        resolvedCultureId,
        targetId,
        this.toInterventionDto(payload),
        userId,
      );
      return { entityId: intervention?.id, data: intervention };
    }

    if (actionType === 'DELETE') {
      await this.interventions.remove(resolvedCultureId, targetId, userId);
      return { entityId: targetId };
    }

    throw new Error(`Action non supportée : ${actionType}`);
  }

  private async applyObservation(
    userId: string,
    actionType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const cultureId = this.readString(payload.cultureId);

    if (actionType === 'CREATE') {
      if (!cultureId) {
        throw new Error('cultureId obligatoire pour créer une observation');
      }

      const observation = await this.observations.create(
        cultureId,
        this.toObservationDto(payload),
        userId,
      );
      return { entityId: observation?.id, data: observation };
    }

    if (!targetId) {
      throw new Error('entityId obligatoire pour cette action observation');
    }

    if (actionType === 'UPDATE') {
      if (!cultureId) {
        // Sans cultureId explicite, on retrouve l'observation par son
        // propriétaire avant modification.
        const owned = await this.observations.requireOwnedObservation(
          targetId,
          userId,
        );
        const observation = await this.observations.update(
          owned.cultureId,
          targetId,
          this.toObservationDto(payload),
          userId,
        );
        return { entityId: observation?.id, data: observation };
      }

      const observation = await this.observations.update(
        cultureId,
        targetId,
        this.toObservationDto(payload),
        userId,
      );
      return { entityId: observation?.id, data: observation };
    }

    if (actionType === 'DELETE') {
      const resolvedCultureId =
        cultureId ??
        (await this.observations.requireOwnedObservation(targetId, userId))
          .cultureId;

      await this.observations.remove(resolvedCultureId, targetId, userId);
      return { entityId: targetId };
    }

    throw new Error(`Action non supportée : ${actionType}`);
  }

  private async applyRecolte(
    userId: string,
    actionType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    // La récolte est créée via la culture : la règle métier (passage de la
    // culture à RECOLTEE) est donc appliquée même en mode offline.
    if (actionType === 'CREATE') {
      const cultureId =
        this.readString(payload.cultureId) ?? targetId ?? undefined;

      if (!cultureId) {
        throw new Error('cultureId obligatoire pour créer une récolte');
      }

      const recolte = await this.recoltes.create(
        cultureId,
        this.toRecolteDto(payload),
        userId,
      );
      return { entityId: recolte?.id, data: recolte };
    }

    if (!targetId) {
      throw new Error('entityId obligatoire pour cette action récolte');
    }

    if (actionType === 'UPDATE') {
      await this.recoltes.update(targetId, {}, userId);
      return { entityId: targetId };
    }

    if (actionType === 'DELETE') {
      await this.recoltes.remove(targetId, userId);
      return { entityId: targetId };
    }

    throw new Error(`Action non supportée : ${actionType}`);
  }

  private async applyPointGps(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const parcelleId = this.readString(payload.parcelleId);
    const rawPoints = payload.pointsGPS;

    if (!parcelleId || !Array.isArray(rawPoints)) {
      throw new Error('parcelleId et pointsGPS sont obligatoires');
    }

    const points = rawPoints
      .filter((p): p is Record<string, unknown> => typeof p === 'object')
      .map((p, index) => ({
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        ordre: Number(p.ordre ?? index),
      }));

    const parcelle = await this.parcelles.replacePoints(
      parcelleId,
      points,
      userId,
    );

    return { entityId: parcelle?.id, data: parcelle };
  }

  private async pullChanges(
    userId: string,
    lastSync?: string,
  ): Promise<Record<string, unknown[]>> {
    const since = parseDate(lastSync) ?? new Date(0);
    const manager = this.actions.manager;

    const [parcelles, cultures, interventions, observations, recoltes] =
      await Promise.all([
        manager.query<unknown[]>(
          `SELECT p.*, COALESCE(
             (SELECT json_agg(json_build_object('id', g.id, 'latitude', g.latitude,
                'longitude', g.longitude, 'ordre', g.ordre) ORDER BY g.ordre)
              FROM "PointGPS" g WHERE g."parcelleId" = p.id), '[]') AS "pointsGPS"
           FROM "Parcelle" p
           WHERE p."utilisateurId" = $1 AND p."modifieA" > $2
           ORDER BY p."modifieA" ASC LIMIT 500`,
          [userId, since],
        ),
        manager.query<unknown[]>(
          `SELECT c.*, COALESCE(
             (SELECT json_agg(json_build_object('id', g.id, 'latitude', g.latitude,
                'longitude', g.longitude, 'ordre', g.ordre) ORDER BY g.ordre)
              FROM "PointGPSCulture" g WHERE g."cultureId" = c.id), '[]') AS "pointsGPS"
           FROM "Culture" c
           JOIN "Parcelle" p ON p.id = c."parcelleId"
           WHERE p."utilisateurId" = $1 AND c."modifieA" > $2
           ORDER BY c."modifieA" ASC LIMIT 500`,
          [userId, since],
        ),
        manager.query<unknown[]>(
          `SELECT i.* FROM "Intervention" i
           JOIN "Culture" c ON c.id = i."cultureId"
           JOIN "Parcelle" p ON p.id = c."parcelleId"
           WHERE p."utilisateurId" = $1 AND i."modifieA" > $2
           ORDER BY i."modifieA" ASC LIMIT 500`,
          [userId, since],
        ),
        manager.query<unknown[]>(
          `SELECT o.*, COALESCE(
             (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url,
                'dateAjout', ph."dateAjout") ORDER BY ph."dateAjout" DESC)
              FROM "Photo" ph WHERE ph."observationId" = o.id), '[]') AS photos
           FROM "Observation" o
           JOIN "Culture" c ON c.id = o."cultureId"
           JOIN "Parcelle" p ON p.id = c."parcelleId"
           WHERE p."utilisateurId" = $1 AND o."modifieA" > $2
           ORDER BY o."modifieA" ASC LIMIT 500`,
          [userId, since],
        ),
        manager.query<unknown[]>(
          `SELECT r.*, COALESCE(
             (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url,
                'dateAjout', ph."dateAjout") ORDER BY ph."dateAjout" DESC)
              FROM "PhotoRecolte" ph WHERE ph."recolteId" = r.id), '[]') AS photos
           FROM "Recolte" r
           JOIN "Culture" c ON c.id = r."cultureId"
           JOIN "Parcelle" p ON p.id = c."parcelleId"
           WHERE p."utilisateurId" = $1 AND r."modifieA" > $2
           ORDER BY r."modifieA" ASC LIMIT 500`,
          [userId, since],
        ),
      ]);

    return { parcelles, cultures, interventions, observations, recoltes };
  }

  private toParcelleDto(
    payload: Record<string, unknown>,
    forcedId?: string,
  ): CreateParcelleDto & { id?: string } {
    return {
      ...(forcedId ? { id: forcedId } : {}),
      nom: this.readString(payload.nom) ?? 'Parcelle sans nom',
      ...(this.readString(payload.description) !== undefined && {
        description: this.readString(payload.description)!,
      }),
      ...(this.readNumber(payload.superficie) !== undefined && {
        superficie: this.readNumber(payload.superficie)!,
      }),
      ...(this.readString(payload.typeSol) !== undefined && {
        typeSol: this.readString(payload.typeSol)!,
      }),
      ...(this.readNumber(payload.latitude) !== undefined && {
        latitude: this.readNumber(payload.latitude)!,
      }),
      ...(this.readNumber(payload.longitude) !== undefined && {
        longitude: this.readNumber(payload.longitude)!,
      }),
      ...(Array.isArray(payload.pointsGPS) && {
        pointsGPS: payload.pointsGPS as CreateParcelleDto['pointsGPS'],
      }),
    };
  }

  private toCultureDto(payload: Record<string, unknown>): CreateCultureDto {
    return {
      nom: this.readString(payload.nom) ?? 'Culture sans nom',
      ...(this.readString(payload.type) !== undefined && {
        type: this.readString(payload.type)!,
      }),
      ...(this.readString(payload.variete) !== undefined && {
        variete: this.readString(payload.variete)!,
      }),
      ...(this.readString(payload.datePlantation) !== undefined && {
        datePlantation: this.readString(payload.datePlantation)!,
      }),
      ...(this.readString(payload.datePrevueRecolte) !== undefined && {
        datePrevueRecolte: this.readString(payload.datePrevueRecolte)!,
      }),
      ...(this.readString(payload.description) !== undefined && {
        description: this.readString(payload.description)!,
      }),
      ...(this.readString(payload.stade) !== undefined && {
        stade: this.readString(payload.stade)!,
      }),
      ...(Array.isArray(payload.pointsGPS) && {
        pointsGPS: payload.pointsGPS as CreateCultureDto['pointsGPS'],
      }),
    };
  }

  private toInterventionDto(
    payload: Record<string, unknown>,
  ): CreateInterventionDto {
    return {
      type: this.readString(payload.type) ?? 'AUTRE',
      ...(this.readString(payload.description) !== undefined && {
        description: this.readString(payload.description)!,
      }),
      ...(this.readString(payload.date) !== undefined && {
        date: this.readString(payload.date)!,
      }),
      ...(this.readString(payload.produit) !== undefined && {
        produit: this.readString(payload.produit)!,
      }),
      ...(this.readNumber(payload.quantite) !== undefined && {
        quantite: this.readNumber(payload.quantite)!,
      }),
      ...(this.readString(payload.unite) !== undefined && {
        unite: this.readString(payload.unite)!,
      }),
      ...(this.readNumber(payload.cout) !== undefined && {
        cout: this.readNumber(payload.cout)!,
      }),
    };
  }

  private toObservationDto(
    payload: Record<string, unknown>,
  ): CreateObservationDto {
    return {
      description: this.readString(payload.description) ?? '',
      ...(this.readString(payload.date) !== undefined && {
        date: this.readString(payload.date)!,
      }),
    };
  }

  private toRecolteDto(payload: Record<string, unknown>): CreateRecolteDto {
    return {
      dateRecolte:
        this.readString(payload.dateRecolte) ??
        this.readString(payload.date) ??
        new Date().toISOString(),
      quantite: this.readNumber(payload.quantite) ?? 0,
      unite: this.readString(payload.unite) ?? 'kg',
      ...(this.readString(payload.description) !== undefined && {
        description: this.readString(payload.description)!,
      }),
      ...(this.readNumber(payload.prixVente) !== undefined && {
        prixVente: this.readNumber(payload.prixVente)!,
      }),
      ...(this.readNumber(payload.coutRecolte) !== undefined && {
        coutRecolte: this.readNumber(payload.coutRecolte)!,
      }),
    };
  }

  private readString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number') return String(value);
    return undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Erreur inconnue lors de la synchronisation';
  }
}
