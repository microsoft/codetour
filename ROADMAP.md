# Feuille de route

L’objectif est de proposer des Tours générés par une IA pour expliquer un projet ou les changements apportés à son code.

## Bugs connus

- [ ] Redimensionner automatiquement les images des diagrammes Mermaid selon l’espace disponible dans le commentaire ou la surface de prévisualisation, sans débordement ni texte illisible.
- [ ] Le mode critique des Changes Tours, fondé sur le skill `code-review`, ne
  produit pas trois questions suggérées à la création pour chaque Tour Step,
  afin d’approfondir les constats liés à l’étape.

## Priorité 1 — Lecture du Tour

### Choisir la surface de lecture

- [ ] Dans le parcours interactif « Lire », proposer HTML ou terminal avant
  l’ouverture du Tour. Une option `--renderer` explicite continue de choisir
  directement la surface ; sans choix interactif, conserver HTML par défaut.
- [ ] Tester le choix des deux surfaces, l’option explicite et le comportement
  de repli sans interface interactive.

### Quitter le lecteur terminal

- [ ] Faire en sorte que `q` quitte le lecteur et ferme la fenêtre de terminal
  indépendante sur macOS et Windows. Le lecteur reconnaît déjà `q` ; vérifier
  et corriger le cycle de vie des fenêtres lancées, notamment le shell Windows
  qui peut rester ouvert après la fin du lecteur.
- [ ] Vérifier que quitter arrête la narration et les conversations en cours,
  restaure le terminal et ne laisse aucun processus du lecteur actif.

## Priorité 1 — Modes de génération

### Questions de l’agent guidées par le MCP

Guider le Tour Generator pour qu’il précise l’intention du lecteur avant de générer un Tour, en s’appuyant sur les descriptions des outils MCP pour proposer des questions pertinentes.

- [ ] Demander uniquement les informations absentes de la demande ou du contexte du projet, et réutiliser les réponses déjà données.
- [ ] Pour une demande de revue, demander si le lecteur souhaite une explication neutre des changements ou une évaluation avec le skill `code-review` ; distinguer l’explication de remarques existantes de la réalisation d’une nouvelle revue.
- [ ] Préciser le périmètre de la revue : branche ou pull request, référence de base, inclusion des modifications non commitées, remarques de revue ou spécification existantes.
- [ ] Pour la découverte d’un projet, demander le niveau de familiarité du lecteur, son objectif (prise en main, architecture, compréhension d’une fonctionnalité ou préparation d’une contribution) et son domaine d’intérêt.
- [ ] Proposer un parcours centré sur une question : demander à quelle question concrète le Tour doit répondre, par exemple « Comment fonctionne l’authentification ? » ou « Où ajouter ce comportement ? ».
- [ ] Pour préparer une contribution, demander quelle fonctionnalité ou quel comportement le lecteur souhaite modifier, puis relier son point d’entrée, sa logique métier, ses tests et sa configuration dans le Project Tour.
- [ ] Demander le niveau de détail souhaité et le parcours préféré (vue d’ensemble du système, flux d’exécution, concepts métier, tests ou sous-système ciblé).
- [ ] Ne demander un temps de lecture facultatif (par exemple 5 ou 15 minutes)
  que si le lecteur le mentionne ; sinon, adapter le Tour au contexte. Une
  préférence facultative sans réponse signifie « aucune préférence » et ne
  bloque pas la génération.
- [ ] Utiliser les réponses pour sélectionner un Project Tour ou un Changes Tour et adapter son périmètre, l’ordre des Tour Steps, le détail et les diagrammes, en conservant les deux outils MCP spécialisés.
- [ ] Traiter l’absence de préférence facultative comme un choix neutre et
  poursuivre avec le comportement standard ; bloquer uniquement si une donnée
  indispensable manque.
- [ ] Pour une revue critique, le client doit lire
  `codetour://review/critical-instructions` avant l’appel MCP. En cas d’échec
  de lecture, arrêter explicitement la génération critique au lieu de produire
  silencieusement un Tour neutre ou de présenter un Tour sans revue comme
  critique. Si aucune source de spécification n’est trouvée, poursuivre avec
  Standards seulement et indiquer exactement :
  `Spec axis not evaluated: no spec source was found.`
- [ ] Valider ce guidage avec des exemples de conversations couvrant une explication neutre des changements, une revue avec un skill, une découverte centrée sur une question et la préparation d’une contribution.

### Project Tour — Découverte du projet

Expliquer le rôle du projet, sa structure et ses principaux parcours d’exécution.

- [ ] Vérifier que les Tour Anchors restent pertinents lorsque le code évolue.
- [ ] Utiliser C4 lorsque le code montre de vraies frontières entre composants
  majeurs ou services ; le seul nombre de répertoires ne suffit pas à le
  justifier.
- [ ] Pour une bibliothèque, une CLI ou un processus unique, préférer une vue
  simple ou un flux d’exécution lorsque cela répond mieux à l’objectif du
  lecteur. Justifier les frontières par le code et signaler les incertitudes.

### Explication d’une revue de code

Présenter les remarques d’une revue de code, leur contexte et les corrections attendues.

- [ ] Utiliser la comparaison locale comme source par défaut ; prendre une Issue
  ou une pull request GitHub uniquement si elle est explicitement liée à la
  revue.
- [ ] Présenter une revue de diff comme une présentation spécialisée du Changes
  Tour, sans créer un mode de lecture distinct.
- [ ] Associer chaque finding à un Tour Anchor valide. Ordonner les findings
  par sévérité puis confiance à l’intérieur de chaque axe, sans fusionner ni
  classer Standards et Spec l’un contre l’autre.
- [ ] Distinguer clairement les problèmes, les suggestions et les points positifs.
- [ ] Si un constat ne peut pas être associé à une ligne valide du head analysé,
  ne pas le présenter comme finding ancré ; signaler séparément sa
  non-inclusion sans inventer d’ancre.

### Changes Tour — Explication des changements

Expliquer l’intention, l’implémentation et les effets des changements depuis la divergence avec la branche de base.

- [ ] En mode critique, générer en français le titre, la description et les
  étapes du Tour. Présenter en français les constats Standards et Spec, tout en
  conservant les citations exactes des règles et exigences dans leur langue
  d’origine.
- [ ] Si la demande ne précise pas de base, sélectionner la branche de suivi
  distante locale de la branche courante, sinon la branche par défaut locale.
  Ne pas effectuer de fetch automatique. Annoncer le ref et le commit résolus
  avant l’analyse ; si aucun ref local fiable n’existe, demander une base.
  Transmettre ensuite un `baseRef` explicite au MCP et préserver son contrat
  de validation et de comparaison. La comparaison résolue reste enregistrée.
- [ ] Mettre en évidence les effets sur les tests, la configuration et les migrations.
- [ ] Proposer un parcours centré sur les impacts, couvrant les consommateurs, les contrats et les comportements concernés au-delà des fichiers modifiés, en justifiant chaque relation par le code et en distinguant les impacts potentiels des effets observés.
- [ ] Ajouter un exemple de Changes Tour à la documentation.
- [ ] Traiter les suites de la revue critique du Changes Tour du 30 octobre :
  ajouter une preuve de smoke test vocal réel sous Windows, exigée par
  [l’issue #79](https://github.com/maurice30120/codetour/issues/79), puis
  actualiser le registre de validation.
- [ ] Évaluer le risque heuristique de duplication entre `fit` et `tail` dans
  `src/cli/terminalLayout.ts` signalé par cette revue ; factoriser seulement
  si une abstraction commune clarifie réellement les deux sens de troncature.
- [ ] Pour chaque Tour Step d’un Changes Tour critique, générer exactement
  trois questions suggérées pendant la création du Tour, liées à son sujet et
  aux constats de revue. Les questions sont conservées dans l’étape ; elles ne
  sont pas régénérées après les réponses dans la conversation ACP.

## Priorité 1 — Portage sélectif WebView, Mermaid et Codex

Porter sélectivement les capacités des PR #43, #63 et #30 sur la base de la
[spécification fonctionnelle consolidée](docs/specs/roadmap-specifications.md)
et de ses spécifications par domaine : [Mermaid](docs/specs/mermaid-diagnostics.md),
[WebView et édition](docs/specs/vscode-webview-playback-editing.md),
[distribution CLI](docs/specs/standalone-cli-distribution.md) et
[intégrations Copilot/Codex](docs/specs/agent-integrations-copilot-codex.md).
La PR #82 reste la source de vérité ; les anciennes PR servent uniquement de
références d’implémentation.

- [ ] **Lot 1 — Mermaid (E + F)** : fournir des diagnostics précis pour les
  légendes et diagrammes invalides ; aligner les instructions MCP et les
  diagnostics sur une grammaire commune, sans second parseur ni correction
  silencieuse.
- [ ] **Lot 2 — WebView et basculement (A + D)** : ajouter la lecture dans un
  panneau latéral VS Code et permettre de basculer entre commentaires et
  WebView sans perdre l’étape, son contexte, sa progression ou ses conversations
  ACP. Réutiliser les interfaces existantes de conversation.
- [ ] **Lot 3 — Édition et brouillons (B + C)** : éditer, prévisualiser,
  enregistrer ou annuler une description ; préserver les brouillons avec les
  choix Save/Discard/Cancel et protéger les écritures contre les courses.
  Dépend du lot 2.
- [ ] **Lot 4 — Configuration Codex (G)** : ajouter la configuration et la
  réparation explicite du serveur MCP pour Codex CLI, sans écrasement silencieux
  de la configuration utilisateur. Peut avancer en parallèle des lots 1 à 3.
- [ ] Valider chaque lot séparément, puis exécuter les tests complets, le build,
  le packaging VSIX et les vérifications de non-régression sur les lecteurs
  autonomes, ACP, MCP, Mermaid, images et Git.

## Distribution CLI et intégrations d’agents — priorité à planifier

Compléter la distribution autonome de CodeTour et l’installation des intégrations
Copilot/Codex selon les [spécifications fonctionnelles consolidées](docs/specs/roadmap-specifications.md).
Le CLI existant, les comportements #82 et le serveur MCP partagé restent la
baseline ; cette initiative n’a pas encore de priorité relative ni de date.

- [ ] Ajouter le registre commun et le contrat des adaptateurs.
- [ ] Ajouter les commandes `--agents`, `--install`, `--uninstall` et
  `--doctor`, sans régression des commandes de lecture ou MCP.
- [ ] Compléter les adaptateurs Copilot et Codex, en préservant les
  configurations utilisateur existantes et en mutualisant leurs règles de
  configuration.
- [ ] Étendre le packaging autonome aux adaptateurs et aux plateformes cibles.
- [ ] Publier et tester les artefacts CLI/VSIX sur les PR et releases.
- [ ] Valider les installations sur des environnements propres et documenter les
  parcours utilisateur.

## Priorité 2 — Qualité des Tours

- [ ] Évaluer les Tours selon l’exactitude, la concision, la progression
  pédagogique et la pertinence des Tour Anchors.
- [ ] Vérifier la génération sur des fixtures déterministes représentant une
  application, une bibliothèque et une CLI, ainsi que sur ce dépôt comme cas
  multi-composants.
- [ ] Compléter la validation sans écriture (`dryRun`) par un aperçu de la
  comparaison, de la destination, du nombre d’étapes et des ancres. Exiger une
  confirmation explicite avant tout remplacement ; ne jamais remplacer après
  une validation échouée.

### Questions suggérées par Tour Step

Pour les Changes Tours critiques, les questions sont préparées lors de la
génération du Tour et restent liées à leur Tour Step. La conversation ACP garde
un contexte évolutif sans générer ni remplacer dynamiquement ces suggestions.

- [ ] Générer trois questions pertinentes par Tour Step à la création d’un
  Changes Tour critique.
- [ ] Vérifier que chaque question concerne l’étape qui la porte et que les
  questions enregistrées restent utilisables dans les surfaces de lecture.
- [ ] Ne pas régénérer les questions après une réponse ACP ; les suggestions
  restent stables pendant la session de lecture.

### Format des images au moment de l’appel MCP

**Priorité : moyenne. Catégorie : navigation et économie d’outils.**

Le format des images locales est déjà décrit dans le guide utilisateur. Le rendre visible au point d’usage doit éviter au Tour Generator d’explorer le renderer ou de supposer une solution en base64 avant de consulter cette référence ciblée.

- [ ] Ajouter aux consignes Markdown partagées par les descriptions des outils, dans [`packages/mcp-server/src/server.ts`](packages/mcp-server/src/server.ts), une indication courte : « Images locales : `![Schéma](./docs/schema.png)`, chemin depuis la racine du workspace. Une étape purement illustrée n’a pas d’ancre de code. »
- [ ] Pointer vers la section [File References du guide utilisateur](docs/user-guide.md#file-references) pour les détails ; conserver le PNG dans le dépôt et une référence courte dans la description du Tour Step.
- [ ] Garder ce renseignement au point d’usage, sans ajouter de règle globale à `AGENTS.md` ni recopier le guide dans un nouveau skill.
- [ ] Avertir sans bloquer lorsqu’une image auteur en `data:` URI dépasse
  2 MiB décodés, en conseillant une référence locale. Cette limite d’avertissement
  est alignée sur la limite des fichiers locaux ; elle ne s’applique pas au
  transport base64 des diagrammes générés par le lecteur.

### Compléments aux tests de l’extension VS Code

- [ ] Poursuivre l’extraction de la logique métier encore couplée à VS Code lorsque cela simplifie les tests ; les tests actuels s’exécutent déjà sans lancer l’éditeur.
- [ ] Réduire les simulations spécifiques aux tests en réutilisant l’hôte VS Code de test existant lorsque cela simplifie leur maintenance.
- [ ] Compléter les tests de résolution des Tour Anchors lors de l’évolution du code, au-delà des cas de fichiers indisponibles et de repli déjà couverts.
- [ ] Exposer une commande `test:unit` dédiée ; les tests de l’extension sont déjà exécutés par `npm test`.
- [ ] Compléter l’exécution existante des tests en intégration continue par un rapport structuré des échecs.
- [ ] Identifier les modules critiques et leurs scénarios contractuels, mesurer
  leur baseline, puis fixer des objectifs par module sur ces résultats. Ne pas
  imposer de pourcentage global artificiel.

## Priorité 3 — Simplification et maintenance

- [ ] Préserver l’ouverture d’un Tour par URL, qui est toujours documentée pour
  les Tours hébergés publiquement ou dans un Gist. Réévaluer sa suppression
  seulement si des éléments concrets montrent qu’elle n’est plus utile.
- [ ] Si une suppression est décidée ultérieurement, nettoyer les commandes,
  dépendances, tests et éléments de documentation devenus inutiles.
- [ ] Documenter les décisions structurantes dans un ADR lorsqu’un choix modifie les contrats existants.

## Plus tard

- [ ] Proposer des Tours à embranchements pour permettre au lecteur de choisir le prochain sujet à explorer selon ses intérêts.
- [ ] Afficher les Tour Steps sur une carte interactive des fichiers et de leurs relations, avec une navigation directe vers chaque étape.
- [ ] Étudier l’historique des Tours sans remettre en cause les fichiers générés stables de la version actuelle.
- [ ] Évaluer les Tours interactifs et conditionnels avec des règles de sécurité explicites.
- [ ] Collecter des métriques locales et anonymes sur les erreurs de génération avant toute éventuelle télémétrie.
