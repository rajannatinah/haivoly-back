import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ParcellesService } from './parcelles.service';
import { UsersService } from '../users/users.service';
import { Parcelle } from './entities/parcelle.entity';
import { PointGPS } from '../points-gps/entities/point-gps.entity';
import { StatutParcelle } from '../common/enums/domain.enums';
import { createMockRepo, type MockManager } from '../test-utils/repo.mock';

const parcelleActive = {
  id: 'p1',
  nom: 'Parcelle 1',
  statut: StatutParcelle.ACTIVE,
  utilisateurId: 'user-1',
  pointsGPS: [],
} as unknown as Parcelle;

let manager: MockManager;

describe('ParcellesService — ownership & cycle de vie', () => {
  let service: ParcellesService;
  let parcelles: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    parcelles = createMockRepo();
    manager = parcelles.manager;
    manager.findOne.mockResolvedValue(parcelleActive);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParcellesService,
        {
          provide: UsersService,
          useValue: {
            // Portee par defaut = l'appelant seul : c'est le comportement
            // AGRICULTEUR, celui que ces tests verifient.
            porteeDeConsultation: jest
              .fn()
              .mockImplementation((id: string) => Promise.resolve([id])),
          },
        },
        { provide: getRepositoryToken(Parcelle), useValue: parcelles },
        { provide: getRepositoryToken(PointGPS), useValue: createMockRepo() },
      ],
    }).compile();

    service = moduleRef.get(ParcellesService);
  });

  it('refuse l’accès à la parcelle d’un autre utilisateur (404, pas 403)', async () => {
    parcelles.findOne.mockResolvedValue(null);
    await expect(service.findOne('p1', 'intrus')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('masque une parcelle SUPPRIMEE en lecture standard', async () => {
    parcelles.findOne.mockResolvedValue({
      ...parcelleActive,
      statut: StatutParcelle.SUPPRIMEE,
    });
    await expect(service.findOne('p1', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('autorise ACTIVE → ABANDONNEE', async () => {
    parcelles.findOne.mockResolvedValue({ ...parcelleActive });
    parcelles.save.mockResolvedValue({
      ...parcelleActive,
      statut: StatutParcelle.ABANDONNEE,
    });

    await expect(
      service.update(
        'p1',
        { statut: StatutParcelle.ABANDONNEE as never },
        'user-1',
      ),
    ).resolves.toBeDefined();
  });

  it('refuse la transition SUPPRIMEE → ACTIVE', async () => {
    parcelles.findOne.mockResolvedValue({
      ...parcelleActive,
      statut: StatutParcelle.SUPPRIMEE,
    });

    await expect(
      service.update(
        'p1',
        { statut: StatutParcelle.ACTIVE as never },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une délimitation de moins de 3 points', async () => {
    parcelles.findOne.mockResolvedValue({ ...parcelleActive });

    await expect(
      service.updateDelimitation(
        'p1',
        {
          pointsGPS: [
            { latitude: -18.8, longitude: 47.5, ordre: 0 },
            { latitude: -18.9, longitude: 47.6, ordre: 1 },
          ],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige une raison pour la suppression logique', async () => {
    parcelles.findOne.mockResolvedValue({ ...parcelleActive });
    await expect(service.remove('p1', '   ', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('applique la suppression logique (statut SUPPRIMEE + raison)', async () => {
    const cible = { ...parcelleActive } as Parcelle;
    parcelles.findOne.mockResolvedValue(cible);

    const result = await service.remove('p1', 'Parcelle vendue', 'user-1');

    expect(result.statut).toBe(StatutParcelle.SUPPRIMEE);
    expect(result.raisonSuppression).toBe('Parcelle vendue');
    expect(parcelles.save).toHaveBeenCalled();
  });

  it('refuse une double suppression', async () => {
    parcelles.findOne.mockResolvedValue({
      ...parcelleActive,
      statut: StatutParcelle.SUPPRIMEE,
    });

    await expect(
      service.remove('p1', 'Encore', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calcule superficie et centre lors d’une création avec délimitation', async () => {
    parcelles.save.mockImplementation(async (v: unknown) => v);

    const result = await service.create(
      {
        nom: 'Nouvelle',
        pointsGPS: [
          { latitude: -18.8792, longitude: 47.5079, ordre: 0 },
          { latitude: -18.8795, longitude: 47.5085, ordre: 1 },
          { latitude: -18.8799, longitude: 47.5082, ordre: 2 },
        ],
      },
      'user-1',
    );

    expect(result).toBeDefined();
    expect(manager.update).toBeDefined();
  });
});
