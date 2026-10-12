import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InterventionsService } from './interventions.service';
import { UsersService } from '../users/users.service';
import { Intervention } from './entities/intervention.entity';
import { Culture } from '../cultures/entities/culture.entity';
import {
  StatutCulture,
  StatutIntervention,
} from '../common/enums/domain.enums';
import { createMockRepo } from '../test-utils/repo.mock';

const cultureEnCours = {
  id: 'c1',
  statut: StatutCulture.EN_COURS,
} as Culture;

describe('InterventionsService', () => {
  let service: InterventionsService;
  let interventions: ReturnType<typeof createMockRepo>;
  let cultures: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    interventions = createMockRepo();
    cultures = createMockRepo();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InterventionsService,
        {
          provide: UsersService,
          useValue: {
            porteeDeConsultation: jest
              .fn()
              .mockImplementation((id: string) => Promise.resolve([id])),
          },
        },
        { provide: getRepositoryToken(Intervention), useValue: interventions },
        { provide: getRepositoryToken(Culture), useValue: cultures },
      ],
    }).compile();

    service = moduleRef.get(InterventionsService);
  });

  it('refuse une culture inexistante', async () => {
    cultures.findOne.mockResolvedValue(null);
    await expect(
      service.create('c1', { type: 'IRRIGATION' }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse une culture terminée (RECOLTEE) ou abandonnée', async () => {
    cultures.findOne.mockResolvedValue({
      ...cultureEnCours,
      statut: StatutCulture.RECOLTEE,
    });

    await expect(
      service.create('c1', { type: 'IRRIGATION' }, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('crée une intervention future avec le statut PLANIFIEE', async () => {
    cultures.findOne.mockResolvedValue({ ...cultureEnCours });

    const result = await service.create(
      'c1',
      { type: 'IRRIGATION', date: '2027-01-01T06:00:00.000Z' },
      'user-1',
    );

    expect(result.statut).toBe(StatutIntervention.PLANIFIEE);
  });

  it('crée une intervention passée avec le statut EN_COURS', async () => {
    cultures.findOne.mockResolvedValue({ ...cultureEnCours });

    const result = await service.create(
      'c1',
      { type: 'FERTILISATION', date: '2020-01-01T06:00:00.000Z' },
      'user-1',
    );

    expect(result.statut).toBe(StatutIntervention.EN_COURS);
  });

  it('ignore un statut fourni par le client et recalcule depuis la date', async () => {
    cultures.findOne.mockResolvedValue({ ...cultureEnCours });

    const result = await service.create(
      'c1',
      {
        type: 'TRAITEMENT',
        date: '2027-01-01T06:00:00.000Z',
        statut: StatutIntervention.EN_COURS,
      } as never,
      'user-1',
    );

    expect(result.statut).toBe(StatutIntervention.PLANIFIEE);
  });

  it('recalcule le statut après modification de la date', async () => {
    cultures.findOne.mockResolvedValue({ ...cultureEnCours });
    interventions.findOne.mockResolvedValue({
      id: 'i1',
      statut: StatutIntervention.PLANIFIEE,
      date: new Date('2027-01-01T06:00:00.000Z'),
    });

    const result = await service.update(
      'c1',
      'i1',
      { date: '2020-01-01T06:00:00.000Z' },
      'user-1',
    );

    expect(result.statut).toBe(StatutIntervention.EN_COURS);
  });

  it('normalise les statuts dépassés lors de la lecture', async () => {
    cultures.findOne.mockResolvedValue({ ...cultureEnCours });
    interventions.find.mockResolvedValue([
      {
        id: 'i1',
        statut: StatutIntervention.PLANIFIEE,
        date: new Date('2020-01-01T06:00:00.000Z'),
        photos: [],
      },
    ]);

    const result = await service.findAll('c1', 'user-1');

    expect(result[0].statut).toBe(StatutIntervention.EN_COURS);
    expect(interventions.save).toHaveBeenCalled();
  });
});
