# Spécification — Intégrations d’agents Copilot et Codex

**Statut :** prête pour implémentation · **Sources :** distribution et
portage sélectif fournis le 30 octobre 2026 · **Base :** PR #82 ; les PR #43,
#30 et les adaptateurs existants sont des
références, pas des implémentations à fusionner automatiquement.

## Baseline à préserver

Le serveur MCP partagé fournit `create_project_tour` et `create_changes_tour`.
Les adaptateurs transmettent les demandes à CodeTour et ne génèrent pas
eux-mêmes les étapes. Les conversations ACP restent distinctes de la
configuration du serveur MCP.

Le dépôt contient déjà un adaptateur Copilot CLI expérimental et des commandes
VS Code de configuration Codex. L’intégration CLI complète et la mutualisation
des règles de configuration restent à réaliser ou à vérifier. Le Codex
configuré depuis VS Code et celui installé depuis le CLI sont deux parcours
distincts, même lorsqu’ils réutilisent des fonctions communes.

## Contrat commun des adaptateurs

Chaque adaptateur gère seulement :

- la détection et la compatibilité de l’agent ;
- l’état de l’installation ;
- l’installation et la désinstallation ;
- le diagnostic et la vérification ;
- la traduction des commandes vers les interfaces CodeTour existantes.

Un contrat TypeScript équivalent à celui-ci est attendu :

```typescript
interface AgentIntegration {
  id: string;
  displayName: string;
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(options: InstallOptions): Promise<void>;
  uninstall(): Promise<void>;
  doctor(): Promise<DiagnosticResult>;
}
```

Les résultats distinguent agent absent ou compatible, intégration non
installée, valide ou obsolète, conflit préexistant et erreur d’installation.
Les adaptateurs sont enregistrés dans un registre commun. Une nouvelle
intégration ne modifie pas les lecteurs ni le serveur MCP.

Les confirmations, erreurs et diagnostics sont cohérents entre adaptateurs,
avec des interfaces adaptées à VS Code ou au terminal. Toute configuration
existante différente est préservée jusqu’à une confirmation explicite ; une
installation correcte n’est pas réécrite.

## Copilot CLI

### Réutilisation et distribution

Réutiliser comme référence fonctionnelle les fichiers :

```text
.github/extensions/codetour/extension.mjs
.github/extensions/codetour/adapter.mjs
```

Les embarquer dans la distribution autonome, sans dépendance au dépôt Git ni à
des chemins relatifs au monorepo de développement.

### Installation

`codetour --install copilot` :

1. détecte Copilot CLI et sa compatibilité ;
2. identifie le dossier d’extensions utilisateur ;
3. vérifie les installations existantes ;
4. installe les fichiers de l’adaptateur ;
5. configure le chemin absolu du CLI CodeTour installé ;
6. vérifie les fichiers et leurs chemins ;
7. affiche les instructions de lancement.

L’installation utilisateur globale est privilégiée. Une installation Copilot
personnalisée n’est jamais écrasée sans consentement. Les chemins contenant des
espaces, notamment sous Windows, sont transmis correctement.

### Comportements à préserver

- `/codetour` propose la lecture ou la génération.
- `/codetour generate project` génère un Project Tour via l’agent et le MCP
  partagé.
- `/codetour generate changes neutral` et
  `/codetour generate changes critical` utilisent les modes MCP existants.
- La sélection d’un Tour et les lecteurs HTML/TermDOM restent disponibles.
- La revue critique lit les instructions depuis la ressource MCP
  `codetour://review/critical-instructions` avant l’appel à
  `create_changes_tour`.
- Les demandes sont exécutées via l’agent Copilot ; l’adaptateur n’implémente
  pas sa propre génération.

Conserver la compatibilité avec l’API expérimentale Copilot utilisée par la
branche #82 sans garantir des versions futures non testées.

## Codex CLI et configuration VS Code

### Configuration depuis le CLI

`codetour --install codex` configure le serveur MCP CodeTour depuis
l’installation autonome en utilisant :

```text
codetour mcp --workspace-root <workspace>
```

La configuration est utilisateur et résout dynamiquement le workspace courant
si Codex documente cette capacité. Si ce passage dynamique n’est pas supporté,
l’installation configure explicitement le workspace courant ; elle ne fige
jamais silencieusement le premier dépôt utilisé.

Vérifier la configuration existante avant toute modification. L’installation
évite les doublons, préserve les autres serveurs MCP et propose une réparation
explicite en cas de conflit. Elle vérifie que Codex peut retrouver les deux
outils MCP de création.

### Configuration depuis VS Code

Conserver les deux commandes :

- `CodeTour: Configure MCP for Codex`
- `CodeTour: Repair MCP Configuration for Codex`

La configuration correcte n’est pas réécrite. Une configuration différente
n’est pas remplacée silencieusement ; sa réparation exige une action explicite.
Codex absent produit un message compréhensible sans casser l’extension.
L’absence de workspace est expliquée.

Adapter `src/codex.ts` de la PR #30 sans réintroduire l’ancienne architecture
MCP ni écraser le packaging actuel. Utiliser le chemin et la méthode de
lancement MCP fournis par la PR #82. Partager, lorsque c’est pertinent, les
fonctions de détection, comparaison et validation de configuration avec
l’adaptateur CLI ; les interfaces VS Code et CLI restent distinctes. Préserver
les protections desktop-only et la compatibilité de l’extension Web.

## Désinstallation, diagnostic et évolutivité

`codetour --uninstall <agent>` ne retire que les fichiers ou entrées reconnus
comme gérés par cette installation. `codetour --doctor` vérifie le CLI, ses
dépendances et les intégrations.

Le registre permet d’ajouter OpenCode ou d’autres agents sans prétendre qu’ils
sont pris en charge avant implémentation et tests. `--agents` distingue
clairement Disponible, Installé, Absent et Non pris en charge.

Le manifest d’installation ne contient aucun secret et ne marque comme gérés
que les fichiers et entrées dont CodeTour est propriétaire. Un échec
d’installation restaure autant que possible l’état initial et ne produit pas
de succès trompeur.

## Critères d’acceptation

### Gestionnaire et installateur

- Le registre liste le bon état de chaque agent.
- Une installation réussie, répétée, ne crée aucun doublon.
- Une configuration préexistante différente n’est pas remplacée sans
  confirmation.
- Une réparation est explicite et une désinstallation est ciblée.
- Un agent absent ou une erreur d’installation produit un échec clair.

### Copilot

- L’adaptateur est utilisable après extraction, sans dépôt CodeTour.
- `/codetour` est accessible après installation.
- La lecture et la génération de Project Tour et Changes Tour fonctionnent.
- Le mode critique obtient les instructions du MCP avant de générer le Tour.
- L’intégration se connecte au serveur MCP partagé.
- Les chemins contenant des espaces fonctionnent.

### Codex

- **G1 :** la configuration initiale réussit.
- **G2 :** une deuxième configuration correcte ne modifie rien.
- **G3 :** une configuration erronée est détectée et peut être réparée.
- **G4 :** la réparation est impossible sans confirmation explicite.
- **G5 :** un message compréhensible est affiché si Codex est absent.
- **G6 :** l’absence de workspace et les chemins contenant des espaces sont
  correctement gérés.
- **G7 :** les deux outils MCP de création fonctionnent depuis Codex.
- **G8 :** l’intégration ACP Codex de #82 reste fonctionnelle.
- **G9 :** l’installation CLI ne fige pas le premier workspace et préserve les
  autres serveurs MCP.

## Dépendances de livraison

Dans le plan global, le gestionnaire et le registre précèdent les commandes
CLI ; Copilot et Codex dépendent des commandes et peuvent être développés en
parallèle ; le packaging autonome dépend des deux adaptateurs. La configuration
Codex depuis VS Code reste indépendante de cette séquence, sous réserve de
partager les règles métier sans créer de dépendance artificielle.
