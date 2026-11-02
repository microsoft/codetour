# Spécification — Diagnostics et instructions Mermaid

**Statut :** spécification fonctionnelle · **Source :** portage sélectif du
30 octobre 2026, lots E et F · **Référence :** PR #63 ; la PR #82 reste la
source de vérité.

## Baseline à préserver

Les diagrammes Mermaid valides continuent d’être rendus comme avant. Les
validateurs et le renderer existants restent partagés entre les consommateurs ;
cette spécification n’autorise ni un second parseur ni une correction
silencieuse du diagramme proposé.

## Changements attendus

Lorsqu’une génération propose un diagramme invalide, le diagnostic MCP indique :

- la localisation du diagramme dans la description ;
- la ligne de légende effectivement reçue, avec ses caractères exacts ;
- la syntaxe correcte de légende ;
- le type de diagramme ou le contenu invalide si cela cause le rejet ;
- explicitement, si la légende est absente.

La syntaxe exposée par les descriptions des outils MCP est exactement :

`**Diagram — Description du diagramme**`

Le tiret cadratin U+2014 est obligatoire. Les instructions et les diagnostics
partagent une définition de grammaire afin que l’agent ne soit pas incité à
produire une forme abrégée invalide.

Adapter les fonctions existantes dans :

- `packages/description-renderer/src/parse.ts`
- `packages/description-renderer/src/index.ts`
- `packages/mcp-server/src/mermaid-validation.ts`

Réutiliser `findCaptionCandidateLine` de la PR #63 si une fonction équivalente
n’existe pas déjà. Le validateur ne réécrit jamais silencieusement le diagramme
fourni.

## Acceptation

- **E1 :** une légende conforme est acceptée.
- **E2 :** un tiret simple est rejeté et la ligne reçue est reproduite
  exactement.
- **E3 :** l’absence de légende produit un diagnostic explicite.
- **E4 :** les espaces et lignes vides précédant le diagramme sont traités
  correctement.
- **F1 :** les deux outils MCP exposent les mêmes règles.
- **F2 :** les types de diagramme non autorisés sont expliqués.
- **F3 :** le rendu des diagrammes valides reste inchangé.
- **F4 :** les tests de sécurité du renderer et du MCP restent verts.

## Dépendances

Aucune dépendance aux autres lots du portage sélectif.
