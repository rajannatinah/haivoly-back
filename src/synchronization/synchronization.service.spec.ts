import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SynchronizationService } from './synchronization.service';
import { Action } from '../actions/entities/action.entity';
import { ActionsService } from '../actions/actions.service';
import { ParcellesService } from '../parcelles/parcelles.service';
import { CulturesService } from '../cultures/cultures.service';
import { InterventionsService } from '../interventions/interventions.service';
import { ObservationsService } from '../observations/observations.service';
import { RecoltesService } from '../recoltes/recoltes.service';
import { SyncStatus } from '../common/enums/domain.enums';

describe('SynchronizationService — idempotence & application des actions', () => {
  let service: SynchronizationService;

  const actions = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };

  const parcelles = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const cultures = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    requireOwnership: jest.fn(),
  };
  const interventions = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findOneRaw: jest.fn(),
  };
  const observations = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    requireOwnedObservation: jest.fn(),
  };
  const recoltes = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const actionsService = {
    triggerRecommendationRules: jest.fn().mockResolvedValue(undefined),
    notifierActionProprietaire: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SynchronizationService,
        { provide: getRepositoryToken(Action), useValue: actions },
        { provide: ParcellesService, useValue: parcelles },
        { provide: CulturesService, useValue: cultures },
        { provide: InterventionsService, useValue: interventions },
        { provide: ObservationsService, useValue: observations },
        { provide: RecoltesService, useValue: recoltes },
        { provide: ActionsService, useValue: actionsService },
      ],
    }).compile();

    service = moduleRef.get(SynchronizationService);
  });

  it('applique une action CREATE_PARCELLE et journalise le résultat', async () => {
    actions.findOne.mockResolvedValue(null);
    actions.save.mockImplementation(async (value: { id?: string }) => ({
      ...value,
      id: 'journal-1',
    }));
    parcelles.create.mockResolvedValue({ id: 'parcelle-1', nom: 'Test' });

    const response = await service.synchronize('user-1', {
      actions: [
        {
          clientId: 'client-1',
          actionType: 'CREATE',
          entityType: 'PARCELLE',
          payload: { nom: 'Test' },
        },
      ],
    });

    expect(parcelles.create).toHaveBeenCalledTimes(1);
    expect(response.results[0]).toMatchObject({
      clientId: 'client-1',
      status: 'SYNCED',
      entityId: 'parcelle-1',
    });
    expect(actions.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ syncStatus: SyncStatus.SYNCED }),
    );
  });

  it('renvoie DUPLICATE et n’exécute pas deux fois une action déjà synchronisée', async () => {
    actions.findOne.mockResolvedValue({
      id: 'journal-1',
      clientId: 'client-1',
      syncStatus: SyncStatus.SYNCED,
      entityId: 'parcelle-1',
    });

    const response = await service.synchronize('user-1', {
      actions: [
        {
          clientId: 'client-1',
          actionType: 'CREATE',
          entityType: 'PARCELLE',
          payload: { nom: 'Test' },
        },
      ],
    });

    expect(parcelles.create).not.toHaveBeenCalled();
    expect(response.results[0].status).toBe('DUPLICATE');
    expect(response.summary).toMatchObject({ duplicates: 1, synced: 0 });
  });

  it('marque une action en échec sans casser le lot', async () => {
    actions.findOne.mockResolvedValue(null);
    actions.save.mockImplementation(async (value: { id?: string }) => ({
      ...value,
      id: 'journal-1',
    }));
    parcelles.create.mockRejectedValue(new Error('Culture introuvable'));

    const response = await service.synchronize('user-1', {
      actions: [
        {
          clientId: 'client-ko',
          actionType: 'CREATE',
          entityType: 'PARCELLE',
          payload: { nom: 'KO' },
        },
      ],
    });

    expect(response.results[0]).toMatchObject({
      status: 'FAILED',
      message: 'Culture introuvable',
    });
    expect(response.summary.failed).toBe(1);
  });

  it('propage l’erreur d’ownership : la parcelle d’un autre utilisateur reste inaccessible', async () => {
    actions.findOne.mockResolvedValue(null);
    actions.save.mockImplementation(async (value: { id?: string }) => ({
      ...value,
      id: 'journal-1',
    }));
    parcelles.update.mockRejectedValue(new Error('Parcelle introuvable'));

    const response = await service.synchronize('user-2', {
      actions: [
        {
          clientId: 'client-2',
          actionType: 'UPDATE',
          entityType: 'PARCELLE',
          entityId: 'parcelle-de-user-1',
          payload: { nom: 'Piratage' },
        },
      ],
    });

    expect(response.results[0].status).toBe('FAILED');
    expect(response.results[0].message).toBe('Parcelle introuvable');
  });

  it('applique la règle métier lors d’une récolte créée hors ligne', async () => {
    actions.findOne.mockResolvedValue(null);
    actions.save.mockImplementation(async (value: { id?: string }) => ({
      ...value,
      id: 'journal-1',
    }));
    recoltes.create.mockResolvedValue({ id: 'recolte-1' });

    const response = await service.synchronize('user-1', {
      actions: [
        {
          clientId: 'client-recolte',
          actionType: 'CREATE',
          entityType: 'RECOLTE',
          payload: { cultureId: 'culture-1', quantite: 100, unite: 'kg' },
        },
      ],
    });

    // Le service RecoltesService applique lui-même la transition RECOLTEE.
    expect(recoltes.create).toHaveBeenCalledWith(
      'culture-1',
      expect.objectContaining({ quantite: 100, unite: 'kg' }),
      'user-1',
    );
    expect(response.results[0].status).toBe('SYNCED');
  });
});
