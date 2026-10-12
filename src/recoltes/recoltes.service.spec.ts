import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RecoltesService } from './recoltes.service';
import { UsersService } from '../users/users.service';
import { Recolte } from './entities/recolte.entity';
import { PhotoRecolte } from '../photos-recoltes/entities/photo-recolte.entity';
import { Culture } from '../cultures/entities/culture.entity';
import { StatutCulture } from '../common/enums/domain.enums';
import { createMockRepo, type MockManager } from '../test-utils/repo.mock';

describe('RecoltesService — règle métier transactionnelle', () => {
  let service: RecoltesService;
  let recoltes: ReturnType<typeof createMockRepo>;
  let cultures: ReturnType<typeof createMockRepo>;
  let manager: MockManager;

  const cultureEnCours = {
    id: 'culture-1',
    statut: StatutCulture.EN_COURS,
    // Colonne PostgreSQL de type `date` → chaîne `YYYY-MM-DD`.
    datePlantation: '2026-01-01',
  } as unknown as Culture;

  beforeEach(async () => {
    cultures = createMockRepo();
    recoltes = createMockRepo();
    manager = recoltes.manager;

    const moduleRef = await Test.createTestingModule({
      providers: [
        RecoltesService,
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
        { provide: getRepositoryToken(Recolte), useValue: recoltes },
        { provide: getRepositoryToken(Culture), useValue: cultures },
        {
          provide: getRepositoryToken(PhotoRecolte),
          useValue: createMockRepo(),
        },
      ],
    }).compile();

    service = moduleRef.get(RecoltesService);
  });

  it('refuse une culture introuvable', async () => {
    cultures.findOne.mockResolvedValue(null);
    await expect(
      service.create(
        'culture-x',
        { dateRecolte: '2026-05-01', quantite: 10, unite: 'kg' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse une culture dont la plantation est encore à venir', async () => {
    cultures.findOne.mockResolvedValue({
      ...cultureEnCours,
      statut: StatutCulture.PLANIFIEE,
      datePlantation: '2099-01-01',
    });
    await expect(
      service.create(
        'culture-1',
        { dateRecolte: '2026-05-01', quantite: 10, unite: 'kg' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une culture abandonnée', async () => {
    cultures.findOne.mockResolvedValue({
      ...cultureEnCours,
      statut: StatutCulture.ABANDONNEE,
      datePlantation: '2020-01-01',
    });
    await expect(
      service.create(
        'culture-1',
        { dateRecolte: '2026-05-01', quantite: 10, unite: 'kg' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepte une culture PLANIFIEE dont la date de plantation est atteinte (statut réconcilié par le serveur)', async () => {
    cultures.findOne.mockResolvedValue({
      ...cultureEnCours,
      statut: StatutCulture.PLANIFIEE,
      datePlantation: '2020-01-01',
    });
    recoltes.findOne.mockResolvedValue(null);

    await service.create(
      'culture-1',
      { dateRecolte: '2026-05-01', quantite: 10, unite: 'kg' },
      'user-1',
    );

    expect(manager.update).toHaveBeenCalledWith(
      Culture,
      { id: 'culture-1' },
      { statut: StatutCulture.RECOLTEE },
    );
  });

  it('refuse une seconde récolte pour la même culture', async () => {
    cultures.findOne.mockResolvedValue(cultureEnCours);
    recoltes.findOne.mockResolvedValue({ id: 'recolte-existante' });
    await expect(
      service.create(
        'culture-1',
        { dateRecolte: '2026-05-01', quantite: 10, unite: 'kg' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse une date de récolte antérieure à la plantation', async () => {
    cultures.findOne.mockResolvedValue(cultureEnCours);
    recoltes.findOne.mockResolvedValue(null);
    await expect(
      service.create(
        'culture-1',
        { dateRecolte: '2025-12-01', quantite: 10, unite: 'kg' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crée la récolte ET passe la culture en RECOLTEE dans la même transaction', async () => {
    cultures.findOne.mockResolvedValue(cultureEnCours);
    recoltes.findOne.mockResolvedValue(null);

    await service.create(
      'culture-1',
      { dateRecolte: '2026-05-18', quantite: 1200, unite: 'kg' },
      'user-1',
    );

    expect(manager.transaction).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(
      Culture,
      { id: 'culture-1' },
      { statut: StatutCulture.RECOLTEE },
    );
  });

  it('refuse la modification d’une récolte (historique conservé)', async () => {
    recoltes.findOne.mockResolvedValue({ id: 'r1', culture: {} });
    await expect(service.update('r1', {}, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuse la suppression d’une récolte (historique conservé)', async () => {
    recoltes.findOne.mockResolvedValue({ id: 'r1', culture: {} });
    await expect(service.remove('r1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuse une récolte appartenant à un autre utilisateur', async () => {
    recoltes.findOne.mockResolvedValue(null);
    await expect(service.remove('r-x', 'intrus')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
