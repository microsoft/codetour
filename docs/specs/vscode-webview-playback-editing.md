# Spécification — Lecture WebView et édition des Tours dans VS Code

**Statut :** spécification fonctionnelle · **Source :** portage sélectif du
30 octobre 2026, lots A–D · **Référence :** PR #43 ; la PR #82 reste la source
de vérité.

## Baseline à préserver

La WebView de description étendue, les conversations ACP par étape et les
lecteurs autonomes HTML/TermDOM existent déjà dans le périmètre de la PR #82.
Le portage réutilise la WebView et le contrat de conversation existants ; il ne
crée pas un gestionnaire ACP concurrent et ne modifie pas les lecteurs
autonomes.

Les comportements existants sont décrits dans
[`tour-webview-implementation.md`](../tour-webview-implementation.md) et
doivent rester compatibles.

## Lot 2 — Lecture latérale et basculement (A + D)

Ajouter une surface de lecture latérale VS Code sans supprimer les
commentaires intégrés au code, qui restent le comportement par défaut. La
WebView présente :

- le titre du Tour et la progression ;
- le titre et l’ancre de l’étape actuelle ;
- la description Markdown complète ;
- les diagrammes Mermaid, images et tableaux ;
- les commandes de navigation.

Le code source reste accessible dans l’éditeur. Les étapes sans ancre restent
lisibles.

Une commande permet de passer entre `comments` et `webview`. Le changement de
mode conserve le Tour actif, l’étape, le contexte de fichier et les références
Git, la progression de lecture et les conversations d’étape. La préférence
`codetour.playbackMode` utilise la portée de configuration VS Code appropriée.
Le basculement ne relance pas une génération et ne recrée pas inutilement une
session ACP.

Réutiliser `src/player/stepChat.ts` et les interfaces de
`src/agent/stepChatContract.ts`. Une action provenant d’un ancien rendu ne doit
pas agir sur la nouvelle étape.

### Acceptation

- **A1 :** un Tour s’ouvre dans les deux modes.
- **A2 :** une longue description reste lisible dans un panneau étroit.
- **A3 :** Markdown, Mermaid et images s’affichent sans régression.
- **A4 :** une étape de comparaison Git affiche le contexte correct.
- **D1 :** deux basculements ramènent à la même étape.
- **D2 :** les conversations ACP restent associées aux bonnes étapes.
- **D3 :** les thèmes clair/sombre et la navigation clavier fonctionnent.
- **D4 :** une action issue d’un rendu périmé ne modifie pas la nouvelle étape.
- **D5 :** les lecteurs autonomes restent inchangés.

## Lot 3 — Édition et conservation des brouillons (B + C)

Depuis la WebView, l’utilisateur peut ouvrir une description en édition,
modifier son Markdown, prévisualiser le rendu, puis enregistrer ou annuler.

L’enregistrement met à jour le Tour existant sans modifier les autres étapes.
L’édition native utilise un document Markdown suivi par VS Code afin de capter
les changements de texte. La prévisualisation Mermaid réutilise le renderer
partagé.

Les brouillons non enregistrés restent en mémoire pendant la session. Toute
action risquant de quitter l’étape modifiée propose **Save**, **Discard** ou
**Cancel**. Cancel conserve le brouillon et l’étape. Un échec d’écriture ne
supprime pas le texte saisi. Les brouillons survivent au basculement des modes,
à la fermeture/réouverture du panneau dans la session et au changement de thème.

Chaque action d’édition est liée au Tour, à l’étape et à la génération
d’interface qui l’a créée. Une sauvegarde ancienne ne peut écraser une saisie
plus récente ; des demandes de sortie simultanées ne produisent pas de
confirmations incohérentes.

Réutiliser la persistance existante : pas de nouveau format ni de second store
de Tours. Adapter, selon leur compatibilité avec la PR #82, les modules de la
PR #43 :

- `tourWebviewEditing.ts`
- `tourDrafts.ts`
- `tourDraftSaving.ts`
- `tourDraftExit.ts`
- `nativeDraftEditor.ts`

### Acceptation

- **B1 :** une description modifiée est persistée à l’identique.
- **B2 :** annuler ne modifie pas le fichier.
- **B3 :** l’aperçu Mermaid utilise le renderer partagé.
- **C1 :** quitter une étape avec brouillon propose Save/Discard/Cancel.
- **C2 :** Cancel conserve le brouillon et l’étape.
- **C3 :** un échec d’écriture préserve le texte saisi.
- **C4 :** une saisie récente n’est pas écrasée par une ancienne sauvegarde.
- **C5 :** le brouillon reste cohérent après plusieurs basculements.
- **C6 :** une action périmée ne peut modifier une autre étape.
- **C7 :** la création et l’enregistrement traditionnels des Tours fonctionnent
  toujours.

## Dépendances

Le lot 2 doit précéder l’intégration complète du lot 3.
