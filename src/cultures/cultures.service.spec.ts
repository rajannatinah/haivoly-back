import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CulturesService } from './cultures.service';
import { UsersService } from '../users/users.service';
import { Culture } from './entities/culture.entity';
import { PointGPSCulture } from './entities/point-gps-culture.entity';
import { Recolte } from '../recoltes/entities/recolte.entity';
import { StatutCulture, StatutParcelle } from '../common/enums/domain.enums';
import { createMockRepo } from '../test-utils/repo.mock';

const culturePlanifiee = {
  id: 'c1',
  nom: 'Riz',
  statut: StatutCulture.PLANIFIEE,
  parcelleId: 'p1',
  datePlantation: null,
  datePrevueRecolte: null,
  parcelle: {
    id: 'p1',
    utilisateurId: 'user-1',
    statut: StatutParcelle.ACTIVE,
  },
} as unknown as Culture;

describe('CulturesService — cycle de vie', () => {
  let service: CulturesService;
  let cultures: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    cultures = createMockRepo();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CulturesService,
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
        { provide: getRepositoryToken(Culture), useValue: cultures },
        {
          provide: getRepositoryToken(PointGPSCulture),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(Recolte), useValue: createMockRepo() },
      ],
    }).compile();

    service = moduleRef.get(CulturesService);
  });

  it('refuse une culture inexistante ou appartenant à un autre utilisateur', async () => {
    cultures.findOne.mockResolvedValue(null);
    await expect(
      service.requireOwnership('c1', 'intrus'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('masque une culture SUPPRIMEE', async () => {
    cultures.findOne.mockResolvedValue({
      ...culturePlanifiee,
      statut: StatutCulture.SUPPRIMEE,
    });
    await expect(
      service.requireOwnership('c1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('autorise PLANIFIEE → EN_COURS', async () => {
    cultures.findOne.mockResolvedValue({ ...culturePlanifiee });
    await expect(
      service.update('p1', 'c1', { statut: StatutCulture.EN_COURS }, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('refuse PLANIFIEE → RECOLTEE (la récolte doit passer par la création d’une récolte)', async () => {
    cultures.findOne.mockResolvedValue({ ...culturePlanifiee });
    await expect(
      service.update('p1', 'c1', { statut: StatutCulture.RECOLTEE }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('interdit de modifier une culture RECOLTEE', async () => {
    cultures.findOne.mockResolvedValue({
      ...culturePlanifiee,
      statut: StatutCulture.RECOLTEE,
    });
    await expect(
      service.update('p1', 'c1', { nom: 'Nouveau nom' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une date de récolte prévue antérieure à la plantation', async () => {
    cultures.findOne.mockResolvedValue({ ...culturePlanifiee });
    await expect(
      service.update(
        'p1',
        'c1',
        { datePlantation: '2026-05-01', datePrevueRecolte: '2026-01-01' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une nouvelle culture sur une parcelle SUPPRIMEE', async () => {
    cultures.manager.findOne.mockResolvedValue({
      id: 'p1',
      utilisateurId: 'user-1',
      statut: StatutParcelle.SUPPRIMEE,
    });

    await expect(
      service.create('p1', { nom: 'Maïs' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marque une culture comme récoltée via markAsRecoltee', async () => {
    const manager = {
      update: jest.fn(),
    };

    await service.markAsRecoltee(manager as never, 'c1');

    expect(manager.update).toHaveBeenCalledWith(
      Culture,
      { id: 'c1' },
      { statut: StatutCulture.RECOLTEE },
    );
  });
});
