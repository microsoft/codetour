# Preuves plateforme — specs 77, 79 et 80

Ce dossier regroupe les validations de livraison et les preuves de plateforme
associées aux specs [#77](https://github.com/maurice30120/codetour/issues/77),
[#79](https://github.com/maurice30120/codetour/issues/79) et
[#80](https://github.com/maurice30120/codetour/issues/80). Les critères qui
demandent encore une observation sur une machine ou dans un hôte réel restent
ouverts dans leurs issues.

## Source des résultats CI

La [page des checks de la PR #82](https://github.com/maurice30120/codetour/pull/82/checks)
affiche les résultats du commit de tête courant. Pour la livraison de #82,
les six checks doivent être verts sur ce même commit. Elle fournit aussi la
preuve CI pour les corrections de portabilité référencées ci-dessous.

## Validations locales de l'intégration

Exécutées le 30 octobre 2026 sur macOS arm64, depuis la branche
`feature/specs-77-79-80-integration` :

- `npm run test` — réussi : compilation, tests CLI compilés, renderer,
  serveur MCP et adaptateur Copilot.
- `npm run test:standalone` — 12 tests réussis. Le test a lancé le véritable
  artefact avec son runtime Node 24.18.0; le checksum attendu est vérifié par
  le packager. L'archive officielle déjà en cache a été fournie à l'aide de
  `CODETOUR_NODE_ARCHIVE`, le réseau de cet environnement ne résolvant pas
  `nodejs.org`.
- `npm run package` — réussi : VSIX macOS construit et vérifié par le
  vérificateur du dépôt.

## Correctifs plateforme à vérifier sur la PR

- **#83 — narration macOS :** les deux tests synchronisent chaque action
  clavier sur la fin d'une image TermDOM complète. La course au démarrage est
  ainsi supprimée sans délai arbitraire; les assertions de remplacement à la
  navigation et d'absence de relance après redraw/scroll restent actives.
  Exiger plusieurs exécutions macOS consécutives vertes sur #82.
- **#84 — MCP Windows :** le helper de test construisait les chemins attendus
  avec `path.relative`, donc avec `\\` sous Windows, alors que le contrat
  expose les chemins de workspace avec `/`. Le helper normalise ses entrées;
  les valeurs attendues et l'assertion des deux outils MCP restent inchangées.
- **#86 — scroll Ubuntu :** le test décode les séquences du terminal en écran
  de 80×24 et vérifie que la dernière ligne attendue est visible après le
  défilement, tandis que le début du contenu n'est plus visible.

Les checks macOS, Ubuntu et Windows de la PR #82 constituent les preuves de
plateforme pour ces trois corrections; consulter la page liée ci-dessus pour
le commit évalué et les tentatives des jobs.

## Preuves manuelles encore ouvertes

- **#77 :** le contrôle graphique sur une machine fraîche reste une étape
  d'acceptation manuelle selon la spec. Les tests empaquetés couvrent le
  lancement MCP, le handshake, la création d'un Project Tour, le lecteur et
  l'absence de Node global.
- **#79 :** le moteur de voix Windows réel n'a pas été exercé sur Windows; le
  test automatisé utilise un faux PowerShell. La CI macOS valide les tests de
  narration déterministes, pas l'audition de la voix système.
- **#80 :** la sonde du transfert interactif `session.send` en mode immédiat
  reste à refaire dans le vrai Copilot CLI; le contrat de l'adaptateur et la
  génération réelle précédemment documentée sont couverts par les preuves
  existantes et la suite automatisée.

Conserver les issues #77, #79 et #80 ouvertes jusqu'à l'ajout des preuves
manuelles correspondantes.
