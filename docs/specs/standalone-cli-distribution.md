# Spécification — Distribution autonome CodeTour CLI

**Statut :** prête pour implémentation · **Source :** spécification fournie le
30 octobre 2026, sections 1–3 et 8–14 · **Branche de référence :**
`feature/specs-77-79-80-integration` (PR #82)

## Objectif et baseline

Distribuer CodeTour depuis le même monorepo sous deux formes :

1. une extension VS Code au format `.vsix` ;
2. une application CLI autonome comprenant les lecteurs, le serveur MCP et les
   adaptateurs d’agents.

Le CLI autonome et la commande `codetour mcp` existent déjà en partie. Cette
spécification les complète ; elle ne réimplémente pas le renderer, la
découverte des Tours, les comparaisons Git ni le serveur MCP partagé. Le
comportement existant de lecture HTML/TermDOM reste compatible.

## Expérience d’installation et commandes

L’utilisateur télécharge l’archive de son système, extrait CodeTour dans un
dossier de son choix, puis lance `codetour` depuis ce dossier ou ajoute le
dossier au `PATH`. Il n’a pas à installer Node.js, npm ni les dépendances de
développement. Git reste une dépendance externe pour les fonctions qui
nécessitent un dépôt Git.

Les agents restent indépendants : CodeTour ne les télécharge pas et ne les
installe pas.

Interface publique :

```text
codetour
codetour --agents
codetour --install <agent>
codetour --uninstall <agent>
codetour --doctor
codetour --help
codetour --version
codetour mcp
```

`codetour` ouvre le lecteur existant. Les commandes de lecture et de génération
restent disponibles, notamment :

```text
/codetour
/codetour generate project
/codetour generate changes critical
```

Une erreur réelle renvoie un code de sortie non nul. `--help` documente toutes
les commandes et `--version` affiche la version installée.

Une installation déjà correcte est idempotente et ne réécrit pas les fichiers.
Les installations fonctionnent sans droits administrateur. Les opérations
d’installation et de désinstallation ne modifient que les éléments gérés par
CodeTour.

## Sources métier et packaging partagé

Les distributions compilent les mêmes modules métier. Réutiliser les scripts
et dossiers existants lorsque cela évite des déplacements inutiles. Le serveur
MCP existant reste l’unique implémentation de `create_project_tour` et
`create_changes_tour`.

Les adaptateurs ne dupliquent pas les lecteurs, la génération d’étapes, les
comparaisons Git, la validation MCP, le rendu Markdown/Mermaid ou les
conversations ACP. Il n’existe pas de serveur MCP spécifique à Copilot ou
Codex.

Le bundle autonome conserve une seule entrée du serveur MCP dans `dist/cli.js`,
conformément au contrôle existant de `scripts/package-standalone.js`.

## Paquets et plateformes

Le paquet VSIX conserve le packaging existant et inclut l’extension VS Code, le
serveur MCP intégré et les ressources nécessaires au rendu Mermaid.

Le paquet CLI autonome contient :

- le lanceur `codetour` et un runtime Node embarqué ;
- les lecteurs HTML et TermDOM ;
- le serveur MCP partagé ;
- les ressources Mermaid ;
- le gestionnaire d’intégrations et les adaptateurs Copilot et Codex ;
- les licences nécessaires.

Le CLI fonctionne après extraction, sans Node global ni npm global.

Cibles initiales des distributions :

- Windows x64 ;
- macOS Apple Silicon ;
- macOS Intel.

Chaque cible reçoit les deux types d’artefacts annoncés — VSIX et archive CLI —
et chacun est construit et validé pour son architecture réelle. Le support
Linux comme distribution autonome est différé ; la CI Linux reste obligatoire
pour tester le code partagé.

## Mises à jour et état d’installation

Pour le POC, privilégier un chemin d’installation stable pour le CLI et une
réparation explicite via `codetour --install <agent>`. Remplacer le paquet CLI
ne doit pas imposer de réinstaller manuellement toutes les intégrations.

Un manifest minimal peut enregistrer l’identifiant de l’agent, la version de
l’adaptateur, le chemin du CLI et les fichiers ou entrées de configuration
gérés. Il ne contient pas de secrets. La désinstallation ne supprime aucun
fichier non identifié comme géré par CodeTour.

En cas d’échec d’installation, restaurer autant que possible l’état initial ;
une installation partielle n’est jamais annoncée comme réussie.

## CI et publication

Une seule révision Git construit le renderer, le MCP, l’extension VS Code, le
CLI autonome, le gestionnaire et les adaptateurs. Le pipeline logique est :

```text
Checkout → dépendances → composants partagés → VSIX et CLI → tests
→ tests de mutualisation → packaging → smoke tests des paquets extraits
→ artefacts
```

La CI contrôle automatiquement et de façon bloquante :

- que les distributions utilisent les mêmes sources ;
- qu’un seul serveur MCP est embarqué dans le CLI ;
- que les adaptateurs utilisent la commande MCP partagée ;
- que les fichiers d’adaptateur requis sont présents ;
- que le registre correspond aux adaptateurs réellement inclus ;
- que le CLI fonctionne sans Node global.

Chaque PR publie des artefacts Actions téléchargeables correspondant au commit
testé, avec des noms explicites comprenant la version, le système et
l’architecture. Exemple :

```text
codetour-0.1.2-win32-x64.vsix
codetour-cli-0.1.2-win32-x64.zip
```

Les releases attachent les mêmes fichiers validés, sans reconstruction
différente. Les licences, la version et le commit restent traçables. Un
artefact n’est jamais annoncé comme validé si un contrôle de packaging ou un
test requis échoue.

## Tests d’acceptation

- Le CLI fonctionne après extraction sans Node global.
- `codetour --help` et `--version` fonctionnent.
- La lecture HTML et TermDOM reste disponible.
- `codetour mcp` expose les deux outils MCP existants.
- Les chemins contenant des espaces fonctionnent.
- Le VSIX conserve le packaging existant et `verify-vsix.js` reste fonctionnel.
- Les smoke tests sont exécutés sur les paquets extraits.
- Les fichiers nécessaires aux adaptateurs sont présents dans le CLI.
- Les artefacts de chaque PR sont téléchargeables depuis Actions.
- Les releases publient les mêmes artefacts que ceux qui ont été testés.
- Les licences et l’identification de version sont présentes.

## Documentation utilisateur

Documenter deux parcours courts :

1. installer le VSIX, ouvrir un dépôt et démarrer un Tour ;
2. télécharger et extraire l’archive CLI, exécuter
   `codetour --agents`, puis installer un adaptateur.

Documenter les prérequis Git, les particularités de sécurité Windows/macOS et
le fait que les agents sont installés séparément. La documentation utilisateur
n’exige pas de comprendre le monorepo.
