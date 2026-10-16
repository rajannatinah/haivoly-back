# Haivoly — API (NestJS + TypeORM + PostgreSQL)

API REST de la plateforme agricole **Haivoly** : parcelles, cultures,
interventions, observations, récoltes, recommandations et synchronisation
hors-ligne.

Accès aux données par **TypeORM** (repositories, `QueryBuilder`, transactions).

---

## Démarrage

```bash
npm install
cp .env.example .env          # renseigner DATABASE_URL et JWT_SECRET
npm run migration:run         # applique les migrations (non destructives)
npm run start:dev             # http://localhost:3000
```

Vérification rapide :

```bash
curl http://localhost:3000/health
# {"success":true,"data":{"status":"ok","database":"up",...}}
```

Scripts utiles :

```bash
npm run build             # compilation TypeScript → dist/
npm run start:prod        # exécution du build (node dist/main)
npm run lint              # ESLint (+ Prettier)
npm run migration:show    # migrations appliquées / en attente
npm run migration:revert  # annule la dernière migration
npm run migration:generate -- src/database/migrations/Nom
```

---

## Architecture

```
src/
├── auth/            # inscription, connexion, JWT, mot de passe oublié
├── users/           # profil (GET/PATCH /users/me), rattachement propriétaire
├── parcelles/       # CRUD, délimitation GPS, suppression logique
├── points-gps/      # sommets du polygone d'une parcelle
├── cultures/        # CRUD, cycle de vie, délimitation, points GPS
├── interventions/   # CRUD + statut calculé par le serveur
├── observations/    # CRUD + photos
├── recoltes/        # création transactionnelle (culture → RECOLTEE)
├── photos*/         # photos d'observation, d'intervention et de récolte
├── recommendations/ # conseils personnalisés / diffusés
├── actions/         # journal des actions (clé d'idempotence de la sync)
├── synchronization/ # POST /sync (idempotent, par lots)
├── dashboard/       # indicateurs agrégés
├── health/          # /health (état de la base)
├── activite/        # intercepteur des requêtes métier en ligne
├── mail/            # envoi et file d'attente des e-mails (outbox)
├── common/          # filtres, intercepteurs, guards, DTO, utilitaires
│   ├── errors/      # catalogue de codes + ApiException
│   └── validation/  # indexation des champs fautifs + messages français
├── config/          # configuration applicative
├── app.setup.ts     # configuration unique de l'application (CORS, pipes, filtres)
└── database/        # data-source, parsers de types, migrations
```

**Organisation par domaine** : chaque module NestJS (`auth`, `parcelles`,
`cultures`, …) regroupe son contrôleur, son service, ses DTO et ses entités.
Les préoccupations transverses vivent dans `common/` ; les migrations dans
`src/database/migrations/`.

```
db/
└── legacy-prisma-migrations/   # historique Prisma conservé à titre d'audit
```
